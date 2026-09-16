"""Per-user MCP server preferences API.

GET /mcp-servers
    Returns the deploy-time MCP server catalog merged with the calling user's
    enabled/disabled toggles. Users with no saved preferences get the catalog
    defaults (default_enabled).

    Response 200: {"servers": [{"id", "name", "description", "enabled"}]}

PUT /mcp-servers
    Saves the calling user's enabled-servers list. Ids not present in the
    catalog are silently dropped (catalog is authoritative; stale entries are
    ignored per the requirements).

    Request body: {"enabled": ["server-id", ...]}
    Response 200: {"success": true, "enabled": ["server-id", ...]}

The user is always identified from the validated Cognito JWT claims provided
by the API Gateway Cognito authorizer — never from the request body.
"""

import json
import os
import re
import time
from functools import lru_cache

import boto3
from aws_lambda_powertools import Logger
from aws_lambda_powertools.event_handler import APIGatewayRestResolver, CORSConfig
from aws_lambda_powertools.event_handler.exceptions import (
    BadRequestError,
    UnauthorizedError,
)
from aws_lambda_powertools.logging import correlation_paths

logger = Logger(service="mcp-prefs")

TABLE_NAME = os.environ["TABLE_NAME"]
# Config catalog is deploy-time config injected by CDK: [{id, name, description, default_enabled}]
CONFIG_CATALOG: list[dict] = [
    dict(s, source="config") for s in json.loads(os.environ.get("MCP_SERVERS_CATALOG", "[]"))
]

# Registry discovery filter (matches tools/mcp_registry.py in the agent runtime).
_MCP_RECORD_TYPE = "MCP"
_MAX_PREFIX_SLUG_LEN = 24


def _safe_prefix(name: str) -> str:
    """Registry catalog id, identical to the runtime client prefix so per-user
    toggles line up: ``registry_<slug>`` from the record's human-readable name."""
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_").lower()
    slug = slug[:_MAX_PREFIX_SLUG_LEN].strip("_")
    return f"registry_{slug or 'server'}"


@lru_cache(maxsize=1)
def _registry_catalog() -> tuple[dict, ...]:
    """Approved MCP records from the AWS Agent Registry, as catalog entries.

    Cached for the life of the warm container. Fail-open: any registry error
    yields an empty list so the settings API still returns the config catalog.
    """
    if os.environ.get("MCP_REGISTRY_DISCOVERY_ENABLED", "false").lower() != "true":
        return ()
    registry_id = os.environ.get("MCP_REGISTRY_ID", "").strip()
    if not registry_id:
        return ()
    default_enabled = os.environ.get("MCP_REGISTRY_DEFAULT_ENABLED", "false").lower() == "true"
    try:
        client = boto3.client("agent-registry")
        record_ids: list[str] = []
        paginator = client.get_paginator("list_discoverable_registry_records")
        for page in paginator.paginate(
            registryId=registry_id,
            filters=[{"name": "recordType", "values": [_MCP_RECORD_TYPE]}],
        ):
            for r in page.get("registryRecords", []):
                rid = r.get("recordId") or r.get("recordArn")
                if rid:
                    record_ids.append(rid)
        servers: dict[str, dict] = {}
        for i in range(0, len(record_ids), 100):
            resp = client.batch_get_discoverable_registry_record(
                entries=[{"registryId": registry_id, "recordIds": record_ids[i : i + 100]}]
            )
            for r in resp.get("registryRecords", []):
                name = r.get("displayName") or r.get("name") or r.get("recordId") or "server"
                sid = _safe_prefix(name)
                servers[sid] = {
                    "id": sid,
                    "name": name,
                    "description": r.get("description", ""),
                    "default_enabled": default_enabled,
                    "source": "registry",
                }
        return tuple(servers.values())
    except Exception:
        logger.warning("Registry discovery failed; returning config catalog only", exc_info=True)
        return ()


def _catalog() -> list[dict]:
    """Config catalog + registry discovery, deduped by id (config wins)."""
    config_ids = {s["id"] for s in CONFIG_CATALOG}
    return CONFIG_CATALOG + [s for s in _registry_catalog() if s["id"] not in config_ids]


def _catalog_ids() -> set[str]:
    return {s["id"] for s in _catalog()}

_origins = [
    o.strip()
    for o in os.environ.get("CORS_ALLOWED_ORIGINS", "*").split(",")
    if o.strip()
]
cors_config = CORSConfig(
    allow_origin=_origins[0],
    extra_origins=_origins[1:],
    allow_headers=["Content-Type", "Authorization"],
    allow_credentials=True,
)

app = APIGatewayRestResolver(cors=cors_config)
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)


def _user_id() -> str:
    authorizer = app.current_event.request_context.authorizer
    claims = authorizer.get("claims", {}) if authorizer else {}
    user_id = claims.get("sub")
    if not user_id:
        raise UnauthorizedError("Missing user identity")
    return user_id


def _enabled_ids_for(user_id: str, catalog: list[dict]) -> set[str]:
    """The user's enabled server ids, falling back to catalog defaults."""
    item = table.get_item(Key={"userId": user_id}).get("Item")
    if item is None:
        return {s["id"] for s in catalog if s.get("default_enabled", True)}
    # Intersect with the catalog: servers removed from config/registry are ignored.
    return set(item.get("enabled", [])) & {s["id"] for s in catalog}


@app.get("/mcp-servers")
def get_servers() -> dict:
    catalog = _catalog()
    enabled = _enabled_ids_for(_user_id(), catalog)
    return {
        "servers": [
            {
                "id": s["id"],
                "name": s["name"],
                "description": s.get("description", ""),
                "source": s.get("source", "config"),
                "enabled": s["id"] in enabled,
            }
            for s in catalog
        ]
    }


@app.put("/mcp-servers")
def put_servers() -> dict:
    user_id = _user_id()
    body = app.current_event.json_body or {}
    requested = body.get("enabled")
    if not isinstance(requested, list) or not all(
        isinstance(i, str) for i in requested
    ):
        raise BadRequestError("body.enabled must be a list of server ids")
    enabled = sorted(set(requested) & _catalog_ids())
    table.put_item(
        Item={"userId": user_id, "enabled": enabled, "updatedAt": int(time.time())}
    )
    logger.info("Saved MCP preferences", extra={"userId": user_id, "enabled": enabled})
    return {"success": True, "enabled": enabled}


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_REST)
def handler(event: dict, context) -> dict:
    return app.resolve(event, context)
