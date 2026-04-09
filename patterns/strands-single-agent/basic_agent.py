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

# ========================================
# Gateway Authentication: Two Approaches
# ========================================
# APPROACH 1 (Active): Direct Cognito token call with user identity propagation.
#   Use this when the M2M token needs to carry user-specific claims (e.g., department,
#   role) for Cedar policy evaluation at the Gateway. The user_id from the validated
#   JWT is passed as aws_client_metadata to Cognito, where the V3 Pre-Token Lambda
#   reads it and injects claims into the M2M token.
#
# APPROACH 2 (Commented out): @requires_access_token decorator from AgentCore Identity SDK.
#   Use this for pure M2M authentication where no user identity is needed in the token.
#   Simpler setup — the decorator handles token retrieval, caching, and refresh
#   automatically via the Token Vault. However, it does not support passing
#   aws_client_metadata, so the V3 Pre-Token Lambda cannot identify the user.
#
# To switch to Approach 2:
#   1. Uncomment the decorator and _fetch_gateway_token() below
#   2. In create_gateway_mcp_client(), replace get_gateway_access_token(user_id)
#      with _fetch_gateway_token()
#   3. Remove the user_id parameter from create_gateway_mcp_client()
#   4. Ensure GATEWAY_CREDENTIAL_PROVIDER_NAME env var is set in the CDK Runtime config

# --- APPROACH 2: @requires_access_token decorator (commented out) ---
# from bedrock_agentcore.identity.auth import requires_access_token
#
# @requires_access_token(
#     provider_name=os.environ["GATEWAY_CREDENTIAL_PROVIDER_NAME"],
#     auth_flow="M2M",
#     scopes=[]
# )
# def _fetch_gateway_token(access_token: str) -> str:
#     """Fetch OAuth2 token via AgentCore Identity Token Vault (no user context)."""
#     return access_token


def create_gateway_mcp_client(user_id: str) -> MCPClient:
    """
    Create MCP client for AgentCore Gateway with OAuth2 authentication.

    MCP (Model Context Protocol) is how agents communicate with tool providers.
    This creates a client that can talk to the AgentCore Gateway using OAuth2
    authentication. The Gateway then provides access to Lambda-based tools.

    The user_id is passed to get_gateway_access_token() which includes it as
    aws_client_metadata[verified_user_id] in the Cognito token request. The V3
    Pre-Token Lambda reads this to inject user-specific claims into the M2M token.

    The token fetch is called INSIDE the lambda factory to ensure a fresh token
    on every MCP reconnection, preventing stale token errors.

    Args:
        user_id (str): The authenticated user's ID for identity propagation.
    """
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")

    # Validate stack name format to prevent injection
    if not stack_name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid STACK_NAME format")

    print(f"[AGENT] Creating Gateway MCP client for stack: {stack_name}")

    # Fetch Gateway URL from SSM
    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    print(f"[AGENT] Gateway URL from SSM: {gateway_url}")

    # Create MCP client with Bearer token authentication
    # CRITICAL: Call get_gateway_access_token() INSIDE the lambda to get fresh token
    # on reconnection. The user_id is passed through to Cognito as aws_client_metadata
    # so the V3 Pre-Token Lambda can inject user-specific claims into the M2M token.
    gateway_client = MCPClient(
        lambda: streamablehttp_client(
            url=gateway_url,
            headers={"Authorization": f"Bearer {get_gateway_access_token(user_id)}"}
        ),
        prefix="gateway",
    )

    print("[AGENT] Gateway MCP client created successfully")
    return gateway_client


def create_basic_agent(user_id: str, session_id: str) -> Agent:
    """
    Create a basic agent with AgentCore Gateway MCP tools and memory integration.

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

        # Create Gateway MCP client with user identity propagation.
        # The user_id flows from the validated JWT → get_gateway_access_token() →
        # Cognito aws_client_metadata → V3 Pre-Token Lambda → M2M token claims.
        print("[AGENT] Step 1: Creating Gateway MCP client with user identity...")
        gateway_client = create_gateway_mcp_client(user_id)
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

        agent = create_basic_agent(user_id, session_id)

        # Use the agent's stream_async method for true token-level streaming
        async for event in agent.stream_async(user_query):
            yield json.loads(json.dumps(dict(event), default=str))

    except Exception as e:
        print(f"[STREAM ERROR] Error in agent_stream: {e}")
        traceback.print_exc()
        yield {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
