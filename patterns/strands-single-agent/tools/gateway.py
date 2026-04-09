"""AgentCore Gateway MCP client with OAuth2 authentication.

Provides two authentication approaches for Gateway access:

APPROACH 1 (Active): Direct Cognito token call with user identity propagation.
  Use this when the M2M token needs to carry user-specific claims (e.g., department,
  role) for Cedar policy evaluation at the Gateway. The user_id from the validated
  JWT is passed as aws_client_metadata to Cognito, where the V3 Pre-Token Lambda
  reads it and injects claims into the M2M token.

APPROACH 2 (Commented out): @requires_access_token decorator from AgentCore Identity SDK.
  Use this for pure M2M authentication where no user identity is needed in the token.
  Simpler setup — the decorator handles token retrieval, caching, and refresh
  automatically via the Token Vault. However, it does not support passing
  aws_client_metadata, so the V3 Pre-Token Lambda cannot identify the user.

To switch to Approach 2:
  1. Uncomment the decorator-based _fetch_gateway_token() below
  2. Comment out the Approach 1 create_gateway_mcp_client(user_id)
  3. Uncomment the Approach 2 create_gateway_mcp_client() (no user_id param)
  4. Update callers to not pass user_id
  5. Ensure GATEWAY_CREDENTIAL_PROVIDER_NAME env var is set in the CDK Runtime config
"""

import logging
import os

from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp import MCPClient
from utils.auth import get_gateway_access_token
from utils.ssm import get_ssm_parameter

logger = logging.getLogger(__name__)


# ========================================
# APPROACH 1 (Active): Direct Cognito call with user identity
# ========================================
def create_gateway_mcp_client(user_id: str) -> MCPClient:
    """Create MCP client for AgentCore Gateway with user identity propagation.

    The user_id is passed to get_gateway_access_token() which includes it as
    aws_client_metadata[verified_user_id] in the Cognito token request. The V3
    Pre-Token Lambda reads this to inject user-specific claims into the M2M token,
    enabling Cedar policy evaluation at the Gateway.

    The token fetch is called INSIDE the lambda factory to ensure a fresh token
    on every MCP reconnection, preventing stale token errors.

    Args:
        user_id (str): The authenticated user's ID for identity propagation.
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
            headers={"Authorization": f"Bearer {get_gateway_access_token(user_id)}"},
        ),
        prefix="gateway",
    )


# ========================================
# APPROACH 2 (Commented out): @requires_access_token decorator
# ========================================
# from bedrock_agentcore.identity.auth import requires_access_token
#
# @requires_access_token(
#     provider_name=os.environ["GATEWAY_CREDENTIAL_PROVIDER_NAME"],
#     auth_flow="M2M",
#     scopes=[],
# )
# def _fetch_gateway_token(access_token: str) -> str:
#     """Fetch OAuth2 token for Gateway authentication via Token Vault (no user context).
#
#     The @requires_access_token decorator handles token retrieval and refresh:
#     1. Token Retrieval: Calls GetResourceOauth2Token API to fetch token from Token Vault
#     2. Automatic Refresh: Uses refresh tokens to renew expired access tokens
#     3. Error Orchestration: Handles missing tokens and OAuth flow management
#
#     For M2M (Machine-to-Machine) flows, the decorator uses Client Credentials grant type.
#     The provider_name must match the Name field in the CDK OAuth2CredentialProvider resource.
#
#     Must be synchronous — called inside the MCPClient lambda factory.
#     """
#     return access_token
#
#
# def create_gateway_mcp_client() -> MCPClient:
#     """Create MCP client for AgentCore Gateway with pure M2M authentication.
#
#     No user identity propagation — the M2M token carries only machine credentials.
#     Uses the @requires_access_token decorator for automatic token management.
#     """
#     stack_name = os.environ.get("STACK_NAME")
#     if not stack_name:
#         raise ValueError("STACK_NAME environment variable is required")
#     if not stack_name.replace("-", "").replace("_", "").isalnum():
#         raise ValueError("Invalid STACK_NAME format")
#
#     gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url")
#     logger.info("[GATEWAY] URL: %s", gateway_url)
#
#     return MCPClient(
#         lambda: streamablehttp_client(
#             url=gateway_url,
#             headers={"Authorization": f"Bearer {_fetch_gateway_token()}"},
#         ),
#         prefix="gateway",
#     )
