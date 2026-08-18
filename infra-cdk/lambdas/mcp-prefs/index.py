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
import time

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
# Catalog is deploy-time config injected by CDK: [{id, name, description, default_enabled}]
CATALOG: list[dict] = json.loads(os.environ.get("MCP_SERVERS_CATALOG", "[]"))
CATALOG_IDS = {s["id"] for s in CATALOG}

_origins = [o.strip() for o in os.environ.get("CORS_ALLOWED_ORIGINS", "*").split(",") if o.strip()]
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


def _enabled_ids_for(user_id: str) -> set[str]:
    """The user's enabled server ids, falling back to catalog defaults."""
    item = table.get_item(Key={"userId": user_id}).get("Item")
    if item is None:
        return {s["id"] for s in CATALOG if s.get("default_enabled", True)}
    # Intersect with the catalog: servers removed from config are silently ignored.
    return set(item.get("enabled", [])) & CATALOG_IDS


@app.get("/mcp-servers")
def get_servers() -> dict:
    enabled = _enabled_ids_for(_user_id())
    return {
        "servers": [
            {
                "id": s["id"],
                "name": s["name"],
                "description": s.get("description", ""),
                "enabled": s["id"] in enabled,
            }
            for s in CATALOG
        ]
    }


@app.put("/mcp-servers")
def put_servers() -> dict:
    user_id = _user_id()
    body = app.current_event.json_body or {}
    requested = body.get("enabled")
    if not isinstance(requested, list) or not all(isinstance(i, str) for i in requested):
        raise BadRequestError("body.enabled must be a list of server ids")
    enabled = sorted(set(requested) & CATALOG_IDS)
    table.put_item(
        Item={"userId": user_id, "enabled": enabled, "updatedAt": int(time.time())}
    )
    logger.info("Saved MCP preferences", extra={"userId": user_id, "enabled": enabled})
    return {"success": True, "enabled": enabled}


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_REST)
def handler(event: dict, context) -> dict:
    return app.resolve(event, context)
