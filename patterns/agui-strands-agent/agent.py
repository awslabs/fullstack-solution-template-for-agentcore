"""AG-UI Strands agent with Gateway MCP tools, Memory, and Code Interpreter."""

from __future__ import annotations

import logging
import os

from ag_ui.core import RunAgentInput, RunErrorEvent
from ag_ui_strands import StrandsAgent, StrandsAgentConfig
from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from strands import Agent
from strands.models import BedrockModel
from tools.gateway import create_gateway_mcp_client
from utils.auth import extract_user_id_from_context

from tools.code_interpreter import StrandsCodeInterpreterTools

logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()

SYSTEM_PROMPT = (
    "You are a helpful assistant with access to tools via the Gateway and Code Interpreter. "
    "When asked about your tools, list them and explain what they do."
)

REGION = os.environ.get("AWS_REGION", "us-east-1")
MEMORY_ID = os.environ.get("MEMORY_ID")
MODEL = BedrockModel(
    model_id="us.anthropic.claude-sonnet-5-5",
)
CODE_INTERPRETER = StrandsCodeInterpreterTools(REGION).execute_python_securely


def _make_session_manager_provider(actor_id: str):
    """Per-thread AgentCore Memory session-manager factory for the AG-UI adapter.

    ag-ui-strands attaches the returned manager to the agent it runs (keyed by
    actor_id + thread_id). A session_manager on the template Agent is ignored.
    Returns None when MEMORY_ID is unset.
    """

    def provider(run_input: RunAgentInput) -> AgentCoreMemorySessionManager | None:
        if not MEMORY_ID:
            return None
        session_id = run_input.thread_id or actor_id
        return AgentCoreMemorySessionManager(
            AgentCoreMemoryConfig(
                memory_id=MEMORY_ID, session_id=session_id, actor_id=actor_id
            ),
            region_name=REGION,
        )

    return provider


@app.entrypoint
async def invocations(payload: dict, context: RequestContext):
    input_data = RunAgentInput.model_validate(payload)
    actor_id = extract_user_id_from_context(context)

    # session_manager is supplied per-thread via the provider below, not here.
    agent = Agent(
        model=MODEL,
        system_prompt=SYSTEM_PROMPT,
        tools=[create_gateway_mcp_client(actor_id), CODE_INTERPRETER],
    )
    agui_agent = StrandsAgent(
        agent=agent,
        name="agui_strands_agent",
        description="AG-UI Strands agent with Gateway MCP tools and Code Interpreter",
        config=StrandsAgentConfig(
            session_manager_provider=_make_session_manager_provider(actor_id),
            # Disable client-side replay so the session manager owns history.
            replay_history_into_strands=False,
        ),
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
