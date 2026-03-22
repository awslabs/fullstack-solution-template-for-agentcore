"""AgentCore Gateway MCP client with OAuth2 authentication (async, for LangGraph)."""

import logging
import os

from bedrock_agentcore.identity.auth import requires_access_token
from langchain_mcp_adapters.client import MultiServerMCPClient
from utils.ssm import get_ssm_parameter

logger = logging.getLogger(__name__)


# OAuth2 Credential Provider decorator from AgentCore Identity SDK.
# Automatically retrieves OAuth2 access tokens from the Token Vault (with caching)
# or fetches fresh tokens from the configured OAuth2 provider when expired.
# The provider_name references an OAuth2 Credential Provider registered in AgentCore Identity.
@requires_access_token(
    provider_name=os.environ["GATEWAY_CREDENTIAL_PROVIDER_NAME"],
    auth_flow="M2M",
    scopes=[],
)
async def _fetch_gateway_token(access_token: str) -> str:
    """Fetch OAuth2 token for Gateway authentication.

    The @requires_access_token decorator handles token retrieval and refresh:
    1. Token Retrieval: Calls GetResourceOauth2Token API to fetch token from Token Vault
    2. Automatic Refresh: Uses refresh tokens to renew expired access tokens
    3. Error Orchestration: Handles missing tokens and OAuth flow management

    For M2M (Machine-to-Machine) flows, the decorator uses Client Credentials grant type.
    The provider_name must match the Name field in the CDK OAuth2CredentialProvider resource.

    Async because it's awaited in create_gateway_mcp_client().
    """
    return access_token


async def create_gateway_mcp_client() -> MultiServerMCPClient:
    """Create MCP client for AgentCore Gateway with OAuth2 authentication.

    MCP (Model Context Protocol) is how agents communicate with tool providers.
    This creates a client that can talk to the AgentCore Gateway using OAuth2
    authentication. The Gateway then provides access to Lambda-based tools.

    Avoids the "closure trap" by calling _fetch_gateway_token() on every invocation
    of create_gateway_mcp_client(). Since this function is called per-request,
    it ensures fresh tokens for each request, preventing stale token errors.
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
