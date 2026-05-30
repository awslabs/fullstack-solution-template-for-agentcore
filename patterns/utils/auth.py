"""
Authentication utilities for agent patterns.

Provides:
- Secure user identity extraction from JWT tokens in the AgentCore Runtime
  RequestContext (prevents impersonation via prompt injection).
- OAuth2 client credentials flow for machine-to-machine Gateway authentication,
  with user identity propagation via aws_client_metadata for Cognito V3
  Pre-Token Lambda enrichment.
"""

import base64
import json
import logging
import os

import boto3
import jwt
import requests
from bedrock_agentcore.runtime import RequestContext

from utils.ssm import get_ssm_parameter

logger = logging.getLogger(__name__)


def extract_user_id_from_context(context: RequestContext) -> str:
    """
    Securely extract the user ID from the JWT token in the request context.

    AgentCore Runtime validates the JWT token before passing it to the agent,
    so we can safely skip signature verification here. The user ID is taken
    from the token's 'sub' claim rather than from the request payload, which
    prevents impersonation via prompt injection.

    Args:
        context (RequestContext): The request context provided by AgentCore
            Runtime, containing validated request headers including the
            Authorization JWT.

    Returns:
        str: The user ID (sub claim) extracted from the validated JWT token.

    Raises:
        ValueError: If the Authorization header is missing or the JWT does
            not contain a 'sub' claim.
    """
    request_headers = context.request_headers
    if not request_headers:
        raise ValueError(
            "No request headers found in context. "
            "Ensure the AgentCore Runtime is configured with a request header allowlist "
            "that includes the Authorization header."
        )

    auth_header = request_headers.get("Authorization")
    if not auth_header:
        raise ValueError(
            "No Authorization header found in request context. "
            "Ensure the AgentCore Runtime is configured with JWT inbound auth "
            "and the Authorization header is in the request header allowlist."
        )

    # Remove "Bearer " prefix to get the raw JWT token
    token = (
        auth_header.replace("Bearer ", "")
        if auth_header.startswith("Bearer ")
        else auth_header
    )

    # Decode without signature verification — AgentCore Runtime already validated the token.
    # We use options to skip all verification since this is a trusted, pre-validated token.
    claims = jwt.decode(  # nosec B105
        jwt=token,
        # nosemgrep: python.jwt.security.unverified-jwt-decode.unverified-jwt-decode — signature verification intentionally skipped; AgentCore Runtime already validated the JWT
        options={"verify_signature": False},
        algorithms=["RS256"],
    )

    user_id = claims.get("sub")
    if not user_id:
        raise ValueError(
            "JWT token does not contain a 'sub' claim. Cannot determine user identity."
        )

    logger.info("Extracted user_id from JWT: %s", user_id)
    return user_id


def get_user_email(user_id: str) -> str:
    """
    Resolve a user's email address from their Cognito ``sub`` (user ID).

    The JWT ``sub`` claim is an opaque UUID, not the email address. When group
    assignment in the Pre-Token Lambda is driven by the email (e.g. the demo
    mapping ``fastprojectadmin`` -> finance), the email must be looked up
    separately. The access token sent to the Runtime does not carry an ``email``
    claim, so this resolves it via the Cognito ``ListUsers`` API filtered by
    ``sub``.

    Args:
        user_id (str): The authenticated user's ID (``sub`` claim from the
            validated JWT).

    Returns:
        str: The user's email address, or an empty string if it cannot be
            resolved (so callers can fall back to the ``sub`` without failing
            the request).
    """
    stack_name = os.environ["STACK_NAME"]
    region = os.environ.get(
        "AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    )

    try:
        user_pool_id = get_ssm_parameter(f"/{stack_name}/cognito-user-pool-id")
        cognito = boto3.client("cognito-idp", region_name=region)
        # ListUsers with a sub filter is the documented way to find a user by
        # their immutable sub. AdminGetUser requires the username, which for a
        # pool with email as the username attribute is itself the sub-derived
        # UUID, so ListUsers keeps this robust across pool configurations.
        response = cognito.list_users(
            UserPoolId=user_pool_id,
            Filter=f'sub = "{user_id}"',
            Limit=1,
        )
        users = response.get("Users", [])
        if not users:
            logger.warning("No Cognito user found for sub: %s", user_id)
            return ""
        for attr in users[0].get("Attributes", []):
            if attr["Name"] == "email":
                return attr["Value"]
        logger.warning("Cognito user %s has no email attribute", user_id)
        return ""
    except Exception as e:
        # Email resolution is best-effort: never fail the request just because
        # the lookup failed. Callers fall back to the sub (which yields the
        # default group in the Pre-Token Lambda).
        logger.warning("Failed to resolve email for sub %s: %s", user_id, e)
        return ""


def get_secret(secret_name: str) -> str:
    """
    Fetch a secret value from AWS Secrets Manager.

    Args:
        secret_name (str): The name or ARN of the secret to retrieve.

    Returns:
        str: The secret value as a string.

    Raises:
        ValueError: If the secret is not found or cannot be accessed.
        RuntimeError: If there's an AWS service error.
    """
    region = os.environ.get(
        "AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    )
    secrets_client = boto3.client("secretsmanager", region_name=region)

    try:
        response = secrets_client.get_secret_value(SecretId=secret_name)
        return response["SecretString"]
    except secrets_client.exceptions.ResourceNotFoundException:
        raise ValueError(f"Secret not found: {secret_name}")
    except secrets_client.exceptions.InvalidParameterException:
        raise ValueError(f"Invalid secret parameter: {secret_name}")
    except secrets_client.exceptions.InvalidRequestException:
        raise ValueError(f"Invalid request for secret: {secret_name}")
    except secrets_client.exceptions.DecryptionFailureException:
        raise RuntimeError(f"Failed to decrypt secret: {secret_name}")
    except secrets_client.exceptions.InternalServiceErrorException:
        raise RuntimeError(
            f"AWS Secrets Manager service error for secret: {secret_name}"
        )
    except Exception as e:
        raise RuntimeError(
            f"Unexpected error retrieving secret {secret_name}: {str(e)}"
        )


def get_gateway_access_token(user_id: str) -> str:
    """
    Get an OAuth2 access token using the client credentials flow, with user
    identity propagated via aws_client_metadata.

    This calls the Cognito /oauth2/token endpoint directly (instead of using the
    @requires_access_token decorator) so that the verified user_id can be passed
    as aws_client_metadata. The Cognito V3 Pre-Token Lambda reads this metadata
    to inject user-specific claims (department, role) into the M2M access token,
    enabling Cedar policy evaluation at the AgentCore Gateway.

    The user_id comes from the validated JWT in the Runtime's Session Context
    (extracted by extract_user_id_from_context). This ensures the identity chain
    is cryptographically secure end-to-end.

    The user_id is the opaque Cognito ``sub`` (a UUID), so it is unsuitable for
    email-based group assignment on its own. The user's email is resolved from
    the ``sub`` (see get_user_email) and propagated as ``verified_email`` so the
    Pre-Token Lambda can assign department/role from the email. The ``sub`` is
    still propagated as ``verified_user_id`` for use as a stable identifier.

    Args:
        user_id (str): The authenticated user's ID (sub claim from validated JWT).

    Returns:
        str: A valid OAuth2 access token for Gateway authentication, enriched
            with user identity claims by the V3 Pre-Token Lambda.

    Raises:
        KeyError: If the STACK_NAME environment variable is not set.
        Exception: If the token request fails or the response is invalid.
    """
    stack_name = os.environ["STACK_NAME"]
    region = os.environ.get(
        "AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    )

    logger.info(
        "Getting access token for stack: %s, region: %s", stack_name, region
    )  # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure

    # Get Cognito configuration from SSM and Secrets Manager
    cognito_domain = get_ssm_parameter(f"/{stack_name}/cognito_provider")
    client_id = get_ssm_parameter(f"/{stack_name}/machine_client_id")
    client_secret = get_secret(f"/{stack_name}/machine_client_secret")

    logger.info("Cognito domain: %s", cognito_domain)
    logger.info("Client ID: %s...", client_id[:10])

    # Prepare OAuth2 token request
    token_url = f"https://{cognito_domain}/oauth2/token"

    # Create Basic Auth header (base64-encoded client_id:client_secret)
    credentials = f"{client_id}:{client_secret}"
    b64_credentials = base64.b64encode(credentials.encode()).decode()

    headers = {
        "Authorization": f"Basic {b64_credentials}",
        "Content-Type": "application/x-www-form-urlencoded",
    }

    # Resolve the user's email from the sub. The access token carries no email
    # claim, and the sub is a UUID, so email-based group assignment in the
    # Pre-Token Lambda needs this explicit lookup.
    user_email = get_user_email(user_id)
    # Avoid logging the email itself (PII); log only whether it was resolved.
    logger.info("Email resolved for group assignment: %s", bool(user_email))

    # Include aws_client_metadata so the Cognito V3 Pre-Token Lambda can read it
    # and inject user-specific claims into the M2M access token. This is the
    # bridge between user auth and M2M auth.
    #   verified_user_id: the stable Cognito sub (UUID)
    #   verified_email:   the email, used for the demo's email-based group mapping
    client_metadata = json.dumps(
        {"verified_user_id": user_id, "verified_email": user_email}
    )

    data = {
        "grant_type": "client_credentials",
        "scope": f"{stack_name}-gateway/read {stack_name}-gateway/write",
        "aws_client_metadata": client_metadata,
    }

    logger.info(
        "Requesting token from: %s", token_url
    )  # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
    logger.info("Scopes: %s", data["scope"])

    # Request access token from Cognito
    response = requests.post(url=token_url, headers=headers, data=data, timeout=30)

    if response.status_code != 200:
        logger.error(
            "Token request failed: %s", response.status_code
        )  # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
        logger.error("Response: %s", response.text)
        raise Exception(
            f"Failed to get access token: {response.status_code} - {response.text}"
        )

    token_data = response.json()
    access_token = token_data.get("access_token")

    if not access_token:
        logger.error("No access_token in response")
        raise Exception("No access_token in Cognito response")

    logger.info("Successfully got access token")
    return access_token
