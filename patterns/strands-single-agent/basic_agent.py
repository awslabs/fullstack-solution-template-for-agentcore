"""Docent Agent — Orchestrator with sub-agent routing, self-learning, and automated tools."""

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
from tools.subagents import SUBAGENTS, classify_intent
from tools.self_learning import ALL_TOOLS as LEARNING_TOOLS
from tools.automations import ALL_TOOLS as AUTOMATION_TOOLS
from tools.data_pipeline import ALL_TOOLS as PIPELINE_TOOLS
from utils.auth import extract_user_id_from_context

logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()

ORCHESTRATOR_PROMPT = """You are the Docent operations orchestrator. You manage a social museum and gallery guide platform.

EFFICIENCY RULES (critical):
- ALWAYS prefer batch tools over loops. Never call get_document or update_document in a loop.
- For audits: use audit_and_fix, audit_missing_fields, or audit_stale_exhibits — one call does the whole job.
- For bulk changes: use batch_update_field or find_and_clear_field — one call updates all matching docs.
- For removing fields (e.g. copyrighted images): use find_and_clear_field with the right condition.
- ONE tool call per task when possible. Present results immediately after.
- Do NOT use execute_python_securely unless the user explicitly asks for code execution.

Tool priority (use the first one that fits):
1. validate_before_write — ALWAYS run before creating/updating venues or exhibits
2. audit_and_fix — scan + optional fix in one call
3. find_and_clear_field — find matching docs and clear a field
4. batch_update_field — update a field across many docs by filter or ID list
5. audit_* tools — read-only scans
6. list_documents / query_documents — general queries
7. get_document / update_document — single doc operations (last resort)

DATA PIPELINE (mandatory for venues/exhibits):
Before writing ANY museum, gallery, or exhibit data, run validate_before_write first.
If result is "reject" → do NOT write, explain what's wrong.
If result is "review" → flag for manual audit, do not write automatically.
If result is "approve" → proceed with the write.
For NEW VENUES: run find_venue_image to get a working Wikimedia Commons image. Verify it returns 200.
For EXHIBITS: NEVER add imageUrl. Leave it empty.
ALWAYS populate keywords (map of term → definition) for venues and exhibits.
After ANY venue/exhibit write, update the Notion Docent Venues database (collection://31109839-2434-489d-9f02-f0f4b1e4798e) to reflect the change. This is the single source of truth for tracking all venue/exhibit data changes.

USER REPORT TRIAGE (data-quality reports from the iOS app):
When asked to triage user reports or asked "what reports need review":
1. Use count_pending_work to see how much is waiting
2. Use list_pending_reports to see the pending queue
3. For each report, use get_report_context to see the current venue/exhibit data
4. Write a structured edit proposal with write_triage_proposal

Rules when proposing edits:
- Only propose edits when you're reasonably sure the report is accurate
- Preserve existing data formats (e.g. hours strings like "Tue–Sat 10am–6pm")
- NEVER propose imageUrl edits (copyright policy)
- For "closed" category: propose {"hidden": true}
- For uncertain reports: pass empty edits {} and explain in reasoning
- Confidence levels: high=specific+verifiable, medium=plausible, low=vague

Proposals go to /reportTriage for human approval — they're not auto-published.
The human approves via the admin portal which calls the publishDraft Cloud Function.

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


def create_docent_agent(user_id: str, session_id: str, query: str = "") -> Agent:
    """Create agent with tools scoped to the detected intent."""
    bedrock_model = BedrockModel(
        model_id="us.anthropic.claude-sonnet-4-5-20250929-v1:0", temperature=0.1
    )
    session_manager = _create_session_manager(user_id, session_id)
    region = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    code_tools = StrandsCodeInterpreterTools(region)
    gateway_client = create_gateway_mcp_client()

    # Classify intent and get sub-agent config
    intent = classify_intent(query) if query else "dev"
    subagent = SUBAGENTS.get(intent, SUBAGENTS["dev"])
    logger.info(f"Routed to sub-agent: {subagent['name']} (intent={intent})")

    # Build system prompt with sub-agent context + lessons
    system_prompt = ORCHESTRATOR_PROMPT + f"\n\nActive mode: {subagent['name']}\n{subagent['system_prompt']}"

    # Combine sub-agent tools with shared tools
    all_tools = [
        gateway_client,
        code_tools.execute_python_securely,
        *subagent["tools"],
        *LEARNING_TOOLS,
        *AUTOMATION_TOOLS,
        *PIPELINE_TOOLS,
        *TRIAGE_TOOLS,
    ]

    return Agent(
        name="docent_orchestrator",
        system_prompt=system_prompt,
        tools=all_tools,
        model=bedrock_model,
        session_manager=session_manager,
        trace_attributes={"user.id": user_id, "session.id": session_id, "intent": intent},
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
        agent = create_docent_agent(user_id, session_id, user_query)
        async for event in agent.stream_async(user_query):
            yield json.loads(json.dumps(dict(event), default=str))
    except Exception as e:
        logger.exception("Agent run failed")
        yield {"status": "error", "error": str(e)}


if __name__ == "__main__":
    app.run()
