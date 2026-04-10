"""AgentCore Gateway MCP client with OAuth2 authentication."""

import logging
import os

from bedrock_agentcore.identity.auth import requires_access_token
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient
from utils.ssm import get_ssm_parameter

logger = logging.getLogger(__name__)


@requires_access_token(
    provider_name=os.environ["GATEWAY_CREDENTIAL_PROVIDER_NAME"],
    auth_flow="M2M",
    scopes=[],
)
def _fetch_gateway_token(access_token: str) -> str:
    """Fetch OAuth2 token for Gateway authentication.

    The @requires_access_token decorator handles token retrieval and refresh.
    Must be synchronous — called inside the MCPClient lambda factory.
    """
    return access_token


def create_gateway_mcp_client() -> MCPClient:
    """Create MCP client for AgentCore Gateway with OAuth2 authentication.

    Calls _fetch_gateway_token() inside the lambda factory so a fresh token
    is fetched on every MCP reconnection (avoids stale token errors).
    """
    stack_name = os.environ.get("STACK_NAME")
    if not stack_name:
        raise ValueError("STACK_NAME environment variable is required")
    if not stack_name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Invalid STACK_NAME format")

    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
    logger.info("[GATEWAY] URL: %s", gateway_url)

    return MCPClient(
        lambda: streamablehttp_client(
            url=gateway_url,
            headers={"Authorization": f"Bearer {_fetch_gateway_token()}"},
        ),
        prefix="gateway",
    )
