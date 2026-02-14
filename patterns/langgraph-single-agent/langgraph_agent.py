# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

from langgraph.prebuilt import create_react_agent
from langchain_aws import ChatBedrock
from langchain_mcp_adapters.client import MultiServerMCPClient
import os
import boto3
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
import traceback

# Use official LangGraph AWS integration for memory
from langgraph_checkpoint_aws import AgentCoreMemorySaver

from utils.auth import extract_user_id_from_context, get_gateway_access_token
from utils.ssm import get_ssm_parameter

app = BedrockAgentCoreApp()


async def create_gateway_mcp_client(access_token: str) -> MultiServerMCPClient:
    """
    Create an MCP client connected to the AgentCore Gateway with OAuth2 authentication.
    
    This function creates a MultiServerMCPClient that manages the connection to the
    AgentCore Gateway using MCP (Model Context Protocol). The client handles session
    lifecycle automatically and keeps the connection alive as long as the client exists.
    """
    stack_name = os.environ.get('STACK_NAME')
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")
    
    # Validate stack name format to prevent injection
    if not stack_name.replace('-', '').replace('_', '').isalnum():
        raise ValueError("Invalid STACK_NAME format")
    
    print(f"[AGENT] Creating Gateway MCP client for stack: {stack_name}")
    
    # Fetch Gateway URL from SSM
    gateway_url = get_ssm_parameter(f'/{stack_name}/gateway_url')
    print(f"[AGENT] Gateway URL from SSM: {gateway_url}")
    
    # Create MultiServerMCPClient with Gateway configuration
    gateway_client = MultiServerMCPClient({
        "gateway": {
            "transport": "streamable_http",
            "url": gateway_url,
            "headers": {
                "Authorization": f"Bearer {access_token}"
            }
        }
    })
    
    print(f"[AGENT] Gateway MCP client created successfully")
    return gateway_client


async def create_langgraph_agent(user_id: str, session_id: str, tools: list):
    """
    Create a LangGraph agent with Gateway MCP tools and memory integration.
    
    This function sets up a LangGraph StateGraph that can access tools through
    the AgentCore Gateway and maintains conversation memory.
    """
    system_prompt = """You are a helpful assistant with access to tools via the Gateway.
    When asked about your tools, list them and explain what they do."""

    # Create Bedrock model
    bedrock_model = ChatBedrock(
        model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        temperature=0.1,
        streaming=True
    )

    # Get and validate Memory ID
    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")
    
    # Configure AgentCore Memory using official LangGraph AWS integration
    checkpointer = AgentCoreMemorySaver(
        memory_id=memory_id,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    )

    try:
        print("[AGENT] Creating LangGraph agent with Gateway tools...")
        
        graph = create_react_agent(
            model=bedrock_model,
            tools=tools,
            checkpointer=checkpointer,
            prompt=system_prompt
        )
        
        print("[AGENT] Agent created successfully with Gateway tools")
        return graph
        
    except Exception as e:
        print(f"[AGENT ERROR] Error creating LangGraph agent: {e}")
        print(f"[AGENT ERROR] Exception type: {type(e).__name__}")
        print(f"[AGENT ERROR] Traceback:")
        traceback.print_exc()
        raise


@app.entrypoint
async def agent_stream(payload, context: RequestContext):
    """
    Main entrypoint for the LangGraph agent using streaming with Gateway integration.
    
    This is the function that AgentCore Runtime calls when the agent receives a request.
    It extracts the user's query from the payload, securely obtains the user ID from
    the validated JWT token in the request context, creates a LangGraph agent with Gateway
    tools and memory, and streams the response back. This function handles the complete
    request lifecycle with token-level streaming. The user ID is extracted from the 
    JWT token (via RequestContext).
    """
    user_query = payload.get("prompt")
    session_id = payload.get("runtimeSessionId")
    
    if not all([user_query, session_id]):
        yield {
            "status": "error",
            "error": "Missing required fields: prompt or runtimeSessionId"
        }
        return
    
    try:
        # Extract user ID securely from the validated JWT token
        # instead of trusting the payload body (which could be manipulated)
        user_id = extract_user_id_from_context(context)

        print(f"[STREAM] Starting streaming invocation for user: {user_id}, session: {session_id}")
        print(f"[STREAM] Query: {user_query}")
        
        # Get OAuth2 access token for Gateway
        print("[STREAM] Getting OAuth2 access token...")
        access_token = get_gateway_access_token()
        print(f"[STREAM] Got access token: {access_token[:20]}...")
        
        # Create MCP client for Gateway
        print("[STREAM] Creating Gateway MCP client...")
        mcp_client = await create_gateway_mcp_client(access_token)
        
        # Load tools from Gateway - client manages session lifecycle automatically
        print("[STREAM] Loading Gateway tools...")
        tools = await mcp_client.get_tools()
        print(f"[STREAM] Loaded {len(tools)} tools from Gateway")
        
        # Create agent with the loaded tools
        graph = await create_langgraph_agent(user_id, session_id, tools)
        
        # Configure streaming with actor_id and thread_id for memory
        config = {
            "configurable": {
                "thread_id": session_id,
                "actor_id": user_id
            }
        }
        
        # Stream messages using LangGraph's astream with stream_mode="messages"
        async for event in graph.astream(
            {"messages": [("user", user_query)]},
            config=config,
            stream_mode="messages"
        ):
            # event is a tuple: (message_chunk, metadata)
            message_chunk, metadata = event
            yield message_chunk.model_dump()
        
        print("[STREAM] Streaming completed successfully")
            
    except Exception as e:
        error_msg = str(e) if str(e) else f"{type(e).__name__}: {repr(e)}"
        print(f"[STREAM ERROR] Error in agent_stream: {error_msg}")
        print(f"[STREAM ERROR] Exception type: {type(e).__name__}")
        traceback.print_exc()
        yield {
            "status": "error",
            "error": error_msg
        }


if __name__ == "__main__":
    app.run()
