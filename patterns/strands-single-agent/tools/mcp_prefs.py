"""Per-user MCP server tool filtering.

The CDK stack attaches every configured MCP server to the AgentCore Gateway as
a target named ``mcp-{server_id}``, and the Gateway exposes each
upstream tool as ``{target_name}___{tool_name}``. This module reads the calling
user's enabled-servers preference from DynamoDB (written by the /mcp-servers
API) and produces a Strands ``tool_filters`` rejection callback that hides
tools belonging to servers the user has disabled.

Environment (set by CDK only when backend.mcp_servers is configured):
    MCP_PREFS_TABLE      — DynamoDB table keyed by userId
    MCP_SERVERS_CATALOG  — JSON list of {id, name, description, default_enabled}

Fail-open by design: on any error (table unreachable, malformed item) the
filter falls back to the catalog's default-enabled set so the agent keeps
responding instead of failing the request.
"""

import json
import logging
import os

import boto3

logger = logging.getLogger(__name__)


def _catalog() -> list[dict]:
    return json.loads(os.environ.get("MCP_SERVERS_CATALOG", "[]"))


def _default_enabled_ids(catalog: list[dict]) -> set[str]:
    return {s["id"] for s in catalog if s.get("default_enabled", True)}


def get_disabled_server_ids(user_id: str) -> set[str]:
    """Ids of catalog MCP servers the user has disabled (empty when feature off)."""
    catalog = _catalog()
    if not catalog:
        return set()

    all_ids = {s["id"] for s in catalog}
    table_name = os.environ.get("MCP_PREFS_TABLE")
    enabled = _default_enabled_ids(catalog)
    if table_name:
        try:
            table = boto3.resource("dynamodb").Table(table_name)
            item = table.get_item(Key={"userId": user_id}).get("Item")
            if item is not None:
                # Catalog is authoritative: prefs for removed servers are ignored.
                enabled = set(item.get("enabled", [])) & all_ids
        except Exception:
            logger.exception("Failed to read MCP preferences; using catalog defaults")

    disabled = all_ids - enabled
    if disabled:
        logger.info("[MCP] Disabled servers for user: %s", sorted(disabled))
    return disabled


def build_gateway_tool_filters(user_id: str) -> dict | None:
    """Strands ToolFilters rejecting tools from servers the user disabled.

    Returns None when nothing needs filtering so MCPClient takes its fast path.
    """
    disabled = get_disabled_server_ids(user_id)
    if not disabled:
        return None

    # Gateway tool names contain "mcp-{id}___"; match on that marker so
    # the check is unaffected by any client-side prefix Strands adds.
    markers = [f"mcp-{server_id}___" for server_id in disabled]

    def _rejected(tool, **_kwargs) -> bool:
        return any(marker in tool.tool_name for marker in markers)

    return {"rejected": [_rejected]}
