"""AG-UI Pydantic AI agent with Gateway MCP tools and Code Interpreter."""

from __future__ import annotations

import logging
import os

from ag_ui.core import RunAgentInput, RunErrorEvent
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from pydantic_ai import Agent
from pydantic_ai.models.bedrock import BedrockConverseModel
from pydantic_ai.providers.bedrock import BedrockProvider
from pydantic_ai.ui.ag_ui import AGUIAdapter
from tools.gateway import create_gateway_toolset
from utils.auth import extract_user_id_from_context

from tools.code_interpreter import PydanticAICodeInterpreterTools

logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()

SYSTEM_PROMPT = (
    "You are a helpful assistant with access to tools via the Gateway and Code Interpreter. "
    "When asked about your tools, list them and explain what they do."
)

REGION = os.environ.get("AWS_REGION", "us-east-1")
MODEL = BedrockConverseModel(
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    provider=BedrockProvider(region_name=REGION),
    settings={"temperature": 0.1},
)
CODE_INTERPRETER = PydanticAICodeInterpreterTools(REGION).tool


@app.entrypoint
async def invocations(payload: dict, context: RequestContext):
    input_data = RunAgentInput.model_validate(payload)
    actor_id = extract_user_id_from_context(context)

    # Conversation history arrives in the AG-UI payload (input_data.messages), so no
    # session manager is needed: Pydantic AI replays it into the model on every run.
    agent = Agent(
        model=MODEL,
        instructions=SYSTEM_PROMPT,
        tools=[CODE_INTERPRETER],
        toolsets=[create_gateway_toolset(actor_id)],
    )
    adapter = AGUIAdapter(agent=agent, run_input=input_data)

    try:
        async for event in adapter.run_stream():
            yield event.model_dump(mode="json", by_alias=True, exclude_none=True)
    except Exception as exc:
        logger.exception("Agent run failed")
        yield RunErrorEvent(
            message=str(exc) or type(exc).__name__,
            code=type(exc).__name__,
        ).model_dump(mode="json", by_alias=True, exclude_none=True)


if __name__ == "__main__":
    app.run()
