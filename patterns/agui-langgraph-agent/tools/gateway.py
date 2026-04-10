"""AgentCore Gateway MCP client with OAuth2 authentication (async, for LangGraph)."""

import logging
import os

from bedrock_agentcore.identity.auth import requires_access_token
from langchain_mcp_adapters.client import MultiServerMCPClient
from utils.ssm import get_ssm_parameter

logger = logging.getLogger(__name__)


@requires_access_token(
    provider_name=os.environ["GATEWAY_CREDENTIAL_PROVIDER_NAME"],
    auth_flow="M2M",
    scopes=[],
)
async def _fetch_gateway_token(access_token: str) -> str:
    """Fetch OAuth2 token for Gateway authentication.

    The @requires_access_token decorator handles token retrieval and refresh.
    Async because it's awaited in create_gateway_mcp_client().
    """
    return access_token


async def create_gateway_mcp_client() -> MultiServerMCPClient:
    """Create MCP client for AgentCore Gateway with OAuth2 authentication.

    Fetches a fresh token per call (called per-request in agent entrypoint).
    """
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")
    if not stack_name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid STACK_NAME format")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    logger.info("[GATEWAY] URL: %s", gateway_url)

    fresh_token = await _fetch_gateway_token()

    return MultiServerMCPClient(
        {
            "gateway": {
                "transport": "streamable_http",
                "url": gateway_url,
                "headers": {"Authorization": f"Bearer {fresh_token}"},
            }
        }
    )
