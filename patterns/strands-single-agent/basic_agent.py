"""Docent Agent — Strands agent with Firestore tools, Gateway, Memory, and Code Interpreter."""

import json
import logging
import os

from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import (
    AgentCoreMemorySessionManager,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from strands import Agent
from strands.models import BedrockModel
from tools.gateway import create_gateway_mcp_client
from tools.code_interpreter import StrandsCodeInterpreterTools
from tools.docent_firestore import ALL_TOOLS as FIRESTORE_TOOLS
from tools.docent_journal import ALL_TOOLS as JOURNAL_TOOLS
from tools.docent_exhibits import ALL_TOOLS as EXHIBIT_TOOLS
from tools.docent_media import ALL_TOOLS as MEDIA_TOOLS
from utils.auth import extract_user_id_from_context

logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()

SYSTEM_PROMPT = """You are the Docent operations agent. You manage a social museum and gallery guide platform.

IMPORTANT RULES:
- Use ONE tool call per question when possible. Do NOT chain multiple tools for the same query.
- activity_summary(days=N) already returns day-by-day data. Just format and present it. Do NOT re-query or re-analyze.
- get_stats returns all platform totals. Just present them. Do NOT call list_documents after.
- Do NOT use execute_python_securely or code interpreter unless the user explicitly asks for code execution.
- Present results immediately after the first tool call returns.

Available collections: museums, galleries, exhibits, tours, reviews, users, journalEntries
Firebase project: docent-76d5a"""


def _create_session_manager(user_id: str, session_id: str) -> AgentCoreMemorySessionManager:
    memory_id = os.environ.get("MEMORY_ID")
    if not memory_id:
        raise ValueError("MEMORY_ID environment variable is required")
    config = AgentCoreMemoryConfig(memory_id=memory_id, session_id=session_id, actor_id=user_id)
    return AgentCoreMemorySessionManager(
        agentcore_memory_config=config,
        region_name=os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    )


def create_docent_agent(user_id: str, session_id: str) -> Agent:
    bedrock_model = BedrockModel(
        model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0", temperature=0.1
    )
    session_manager = _create_session_manager(user_id, session_id)
    region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    code_tools = StrandsCodeInterpreterTools(region)
    gateway_client = create_gateway_mcp_client()

    all_tools = [
        gateway_client,
        code_tools.execute_python_securely,
        *FIRESTORE_TOOLS,
        *JOURNAL_TOOLS,
        *EXHIBIT_TOOLS,
        *MEDIA_TOOLS,
    ]

    return Agent(
        name="docent_agent",
        system_prompt=SYSTEM_PROMPT,
        tools=all_tools,
        model=bedrock_model,
        session_manager=session_manager,
        trace_attributes={"user.id": user_id, "session.id": session_id},
    )


@app.entrypoint
async def invocations(payload, context: RequestContext):
    user_query = payload.get("prompt")
    session_id = payload.get("runtimeSessionId")

    if not all([user_query, session_id]):
        yield {"status": "error", "error": "Missing required fields: prompt or runtimeSessionId"}
        return

    try:
        user_id = extract_user_id_from_context(context)
        agent = create_docent_agent(user_id, session_id)
        async for event in agent.stream_async(user_query):
            yield json.loads(json.dumps(dict(event), default=str))
    except Exception as e:
        logger.exception("Agent run failed")
        yield {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
