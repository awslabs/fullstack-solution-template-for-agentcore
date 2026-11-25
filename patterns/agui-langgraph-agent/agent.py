"""AG-UI LangGraph agent with Gateway MCP tools, Memory, and Code Interpreter."""

from __future__ import annotations

import logging
import os

from ag_ui.core import RunAgentInput, RunErrorEvent
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from copilotkit import CopilotKitMiddleware, LangGraphAGUIAgent
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

REGION = os.environ.get("AWS_REGION", "us-east-1")
MEMORY_ID = os.environ.get("MEMORY_ID")
MODEL = ChatBedrock(
    model_id="us.anthropic.claude-sonnet-5-5",
    streaming=True,
    beta_use_converse_api=True,
)
CODE_INTERPRETER = LangGraphCodeInterpreterTools(REGION).execute_python_securely


def get_memory_saver() -> AgentCoreMemorySaver | None:
    """Return an AgentCore Memory checkpointer, or None when MEMORY_ID is unset."""
    if not MEMORY_ID:
        return None
    return AgentCoreMemorySaver(memory_id=MEMORY_ID, region_name=REGION)


async def build_graph(actor_id: str):
    """Build a LangGraph compiled graph with Gateway tools and Memory."""
    mcp_client = await create_gateway_mcp_client(actor_id)
    tools = await mcp_client.get_tools()
    tools.append(CODE_INTERPRETER)

    return create_agent(
        model=MODEL,
        tools=tools,
        checkpointer=get_memory_saver(),
        middleware=[CopilotKitMiddleware()],
        system_prompt=SYSTEM_PROMPT,
    )


@app.entrypoint
async def invocations(payload: dict, context: RequestContext):
    input_data = RunAgentInput.model_validate(payload)
    actor_id = extract_user_id_from_context(context)

    graph = await build_graph(actor_id)
    agui_agent = LangGraphAGUIAgent(
        name="agui_langgraph_agent",
        description="AG-UI LangGraph agent with Gateway MCP tools and Memory",
        graph=graph,
        config={"configurable": {"actor_id": actor_id}},
    )

    try:
        async for event in agui_agent.run(input_data):
            if event is not None:
                yield event.model_dump(mode="json", by_alias=True, exclude_none=True)
    except Exception as exc:
        logger.exception("Agent run failed")
        yield RunErrorEvent(
            message=str(exc) or type(exc).__name__,
            code=type(exc).__name__,
        ).model_dump(mode="json", by_alias=True, exclude_none=True)


if __name__ == "__main__":
    app.run()
