"""LangGraph agent with Gateway MCP tools, Memory, and Code Interpreter."""

import logging
import os

from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from langchain.agents import create_agent
from langchain_aws import ChatBedrock
from langgraph_checkpoint_aws import AgentCoreMemorySaver
from tools.gateway import create_gateway_mcp_client
from utils.auth import extract_user_id_from_context

from tools.code_interpreter import LangGraphCodeInterpreterTools

logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()

SYSTEM_PROMPT = (
    "You are a helpful assistant with access to tools via the Gateway and Code Interpreter. "
    "When asked about your tools, list them and explain what they do."
)


def _build_model() -> ChatBedrock:
    return ChatBedrock(
        model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0",
        temperature=0.1,
        streaming=True,
        beta_use_converse_api=True,
    )


def _create_checkpointer() -> AgentCoreMemorySaver:
    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")
    return AgentCoreMemorySaver(
        memory_id=memory_id,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    )


async def create_langgraph_agent():
    """Create a LangGraph agent with Gateway tools, Memory, and Code Interpreter."""
    mcp_client = await create_gateway_mcp_client()
    tools = await mcp_client.get_tools()

    region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    code_tools = LangGraphCodeInterpreterTools(region)
    tools.append(code_tools.execute_python_securely)

    return create_agent(
        model=_build_model(),
        tools=tools,
        checkpointer=_create_checkpointer(),
        system_prompt=SYSTEM_PROMPT,
    )


@app.entrypoint
async def invocations(payload, context: RequestContext):
    """Main entrypoint — called by AgentCore Runtime on each request."""
    user_query = payload.get("prompt")
    session_id = payload.get("runtimeSessionId")

    if not all([user_query, session_id]):
        yield {
            "status": "error",
            "error": "Missing required fields: prompt or runtimeSessionId",
        }
        return

    try:
        user_id = extract_user_id_from_context(context)

        graph = await create_langgraph_agent()

        config = {"configurable": {"thread_id": session_id, "actor_id": user_id}}

        async for event in graph.astream(
            {"messages": [("user", user_query)]},
            config=config,
            stream_mode="messages",
        ):
            message_chunk, metadata = event
            yield message_chunk.model_dump()

    except Exception as e:
        error_msg = str(e) if str(e) else f"{type(e).__name__}: {repr(e)}"
        logger.exception("Agent run failed")
        yield {"status": "error", "error": error_msg}


if __name__ == "__main__":
    app.run()
