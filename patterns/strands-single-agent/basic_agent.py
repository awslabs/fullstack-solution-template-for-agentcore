import json
import os
import traceback

import boto3
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from mcp.client.streamable_http import streamablehttp_client
from strands import Agent
from strands.models import BedrockModel
from strands.tools.mcp import MCPClient
from strands_code_interpreter import StrandsCodeInterpreterTools

from utils.auth import extract_user_id_from_context, get_gateway_access_token
from utils.ssm import get_ssm_parameter

app = BedrockAgentCoreApp()

# Phrase in the exception message raised by the MCP SDK when the HTTP session
# has been closed (e.g. due to inactivity or token expiry).
# Matches mcp.client (as of mcp SDK ~1.x).
# If retries stop working after an SDK upgrade, verify this message still matches.
_MCP_SESSION_ERROR = "client session is not running"
# Total number of attempts agent_stream will make before surfacing a session-lost
# error to the caller.  With a value of 2, one retry is performed.
# Note: this is attempts, not retries (retries = attempts - 1).
_MAX_MCP_ATTEMPTS = 2


def create_gateway_mcp_client() -> MCPClient:
    """
    Create MCP client for AgentCore Gateway with OAuth2 authentication.

    MCP (Model Context Protocol) is how agents communicate with tool providers.
    This creates a client that can talk to the AgentCore Gateway using a fresh
    OAuth2 access token fetched on each connection attempt. Fetching the token
    inside the factory lambda ensures that reconnections (e.g. after a session
    timeout) always use a valid, non-expired token.
    """
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")

    # Validate stack name format to prevent injection
    if not stack_name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid STACK_NAME format")

    print(f"[AGENT] Creating Gateway MCP client for stack: {stack_name}")

    # Fetch Gateway URL from SSM once (URL does not change between reconnects)
    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    print(f"[AGENT] Gateway URL from SSM: {gateway_url}")

    # The factory lambda is called by MCPClient each time it (re)establishes the
    # underlying transport.  Calling get_gateway_access_token() inside the lambda
    # rather than closing over a pre-fetched token means every new connection uses
    # a fresh OAuth2 token, which prevents failures caused by token expiry.
    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            url=gateway_url,
            headers={"Authorization": f"Bearer {get_gateway_access_token()}"},
        ),
        prefix="gateway",
    )

    print("[AGENT] Gateway MCP client created successfully")
    return gateway_client


def create_basic_agent(user_id: str, session_id: str) -> Agent:
    """
    Create a basic agent with Gateway MCP tools and memory integration.

    This function sets up an agent that can access tools through the AgentCore Gateway
    and maintains conversation memory. It handles authentication, creates the MCP client
    connection, and configures the agent with access to all tools available through
    the Gateway. If Gateway connection fails, it falls back to an agent without tools.
    """
    system_prompt = """You are a helpful assistant with access to tools via the Gateway and Code Interpreter.
    When asked about your tools, list them and explain what they do."""

    bedrock_model = BedrockModel(
        model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0", temperature=0.1
    )

    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")

    # Configure AgentCore Memory
    agentcore_memory_config = AgentCoreMemoryConfig(
        memory_id=memory_id, session_id=session_id, actor_id=user_id
    )

    session_manager = AgentCoreMemorySessionManager(
        agentcore_memory_config=agentcore_memory_config,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    )

    # Initialize Code Interpreter tools with boto3 session
    region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    session = boto3.Session(region_name=region)
    code_tools = StrandsCodeInterpreterTools(region)

    try:
        print("[AGENT] Starting agent creation with Gateway tools...")

        # Create Gateway MCP client; the factory lambda inside fetches a fresh
        # OAuth2 token on every (re)connection so tokens never go stale.
        print("[AGENT] Step 1: Creating Gateway MCP client...")
        gateway_client = create_gateway_mcp_client()
        print("[AGENT] Gateway MCP client created successfully")

        print(
            "[AGENT] Step 2: Creating Agent with Gateway tools and Code Interpreter..."
        )
        agent = Agent(
            name="BasicAgent",
            system_prompt=system_prompt,
            tools=[gateway_client, code_tools.execute_python_securely],
            model=bedrock_model,
            session_manager=session_manager,
            trace_attributes={
                "user.id": user_id,
                "session.id": session_id,
            },
        )
        print(
            "[AGENT] Agent created successfully with Gateway tools and Code Interpreter"
        )
        return agent

    except Exception as e:
        print(f"[AGENT ERROR] Error creating Gateway client: {e}")
        print(f"[AGENT ERROR] Exception type: {type(e).__name__}")
        print("[AGENT ERROR] Traceback:")
        traceback.print_exc()
        print(
            "[AGENT] Gateway connection failed - raising exception instead of fallback"
        )
        raise


@app.entrypoint
async def agent_stream(payload, context: RequestContext):
    """
    Main entrypoint for the agent using streaming with Gateway integration.

    This is the function that AgentCore Runtime calls when the agent receives a request.
    It extracts the user's query from the payload, securely obtains the user ID from
    the validated JWT token in the request context, creates an agent with Gateway tools
    and memory, and streams the response back. This function handles the complete
    request lifecycle with token-level streaming. The user ID is extracted from the 
    JWT token (via RequestContext).
    """
    user_query = payload.get("prompt")
    session_id = payload.get("runtimeSessionId")

    if not all([user_query, session_id]):
        yield {
            "status": "error",
            "error": "Missing required fields: prompt or runtimeSessionId",
        }
        return

    try:
        # Extract user ID securely from the validated JWT token
        # instead of trusting the payload body (which could be manipulated)
        user_id = extract_user_id_from_context(context)

        print(
            f"[STREAM] Starting streaming invocation for user: {user_id}, session: {session_id}"
        )
        print(f"[STREAM] Query: {user_query}")

        # Retry loop: if the MCP client session is lost (e.g. due to an HTTP
        # connection timeout or an expired OAuth token), recreate the agent and
        # MCP client then retry.  The factory lambda inside create_gateway_mcp_client
        # always fetches a fresh token, so each attempt uses valid credentials.
        #
        # KNOWN BEHAVIOR: if the session error fires after some events have already
        # been yielded to the SSE client, the retry starts a fresh stream_async()
        # call from the beginning.  The client may receive duplicate events in that
        # scenario.  Resuming mid-stream requires a cursor/offset mechanism.
        for attempt in range(1, _MAX_MCP_ATTEMPTS + 1):
            try:
                agent = create_basic_agent(user_id, session_id)

                # Use the agent's stream_async method for true token-level streaming
                async for event in agent.stream_async(user_query):
                    yield json.loads(json.dumps(dict(event), default=str))
                break  # streaming completed successfully; exit the retry loop

            except Exception as e:
                # Matches the literal raised by mcp.client when the HTTP session is closed.
                # If retries stop working after an SDK upgrade, verify this message still matches.
                if _MCP_SESSION_ERROR in str(e) and attempt < _MAX_MCP_ATTEMPTS:
                    print(
                        f"[STREAM] MCP client session lost (attempt {attempt}/{_MAX_MCP_ATTEMPTS}), "
                        "reconnecting with fresh token..."
                    )
                    continue
                raise

    except Exception as e:
        print(f"[STREAM ERROR] Error in agent_stream: {e}")
        traceback.print_exc()
        yield {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
