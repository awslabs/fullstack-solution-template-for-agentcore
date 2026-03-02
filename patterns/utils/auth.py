"""
Authentication utilities for agent patterns.

Provides:
- Secure user identity extraction from JWT tokens in the AgentCore Runtime
  RequestContext (prevents impersonation via prompt injection).
- OAuth2 client credentials flow for machine-to-machine Gateway authentication.
"""

import base64
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
            "Ensure the Runtime is configured with a request header allowlist "
            "that includes the Authorization header."
        )

    auth_header = request_headers.get("Authorization")
    if not auth_header:
        raise ValueError(
            "No Authorization header found in request context. "
            "Ensure the Runtime is configured with JWT inbound auth "
            "and the Authorization header is in the request header allowlist."
        )

    # Remove "Bearer " prefix to get the raw JWT token
    token = (
        auth_header.replace("Bearer ", "")
        if auth_header.startswith("Bearer ")
        else auth_header
    )

    # Decode without signature verification — Runtime already validated the token.
    # We use options to skip all verification since this is a trusted, pre-validated token.
    claims = jwt.decode(
        jwt=token,
        options={"verify_signature": False},
        algorithms=["RS256"],
    )

    user_id = claims.get("sub")
    if not user_id:
        raise ValueError(
            "JWT token does not contain a 'sub' claim. "
            "Cannot determine user identity."
        )

    logger.info("Extracted user_id from JWT: %s", user_id)
    return user_id


def get_secret(secret_name: str) -> str:
    """
    Fetch a secret value from AWS Secrets Manager.

    Secrets Manager is designed for storing sensitive information like passwords,
    API keys, and other secrets with automatic rotation capabilities.

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


def get_gateway_access_token() -> str:
    """
    Get an OAuth2 access token using the client credentials flow.
    
    NOTE: This function is used for Docker local testing only. In AgentCore Runtime
    environment, the @requires_access_token decorator is used instead, which provides
    managed token retrieval, automatic refresh, and integration with AgentCore Identity
    OAuth2 Provider and Token Vault. This manual Cognito approach is a fallback for
    environments where the AgentCore Runtime context is not available.

    This implements machine-to-machine authentication where the agent acts as
    a client that needs to authenticate with Cognito to get permission to call
    the Gateway. The client credentials flow is used for server-to-server
    communication without user login.

    Returns:
        str: A valid OAuth2 access token for Gateway authentication.

    Raises:
        KeyError: If the STACK_NAME environment variable is not set.
        Exception: If the token request fails or the response is invalid.
    """
    stack_name = os.environ["STACK_NAME"]
    region = os.environ.get(
        "AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
    )

    logger.info("Getting access token for stack: %s, region: %s", stack_name, region)

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

    data = {
        "grant_type": "client_credentials",
        "scope": f"{stack_name}-gateway/read {stack_name}-gateway/write",
    }

    logger.info("Requesting token from: %s", token_url)
    logger.info("Scopes: %s", data["scope"])

    # Request access token from Cognito
    response = requests.post(url=token_url, headers=headers, data=data, timeout=30)

    if response.status_code != 200:
        logger.error("Token request failed: %s", response.status_code)
        logger.error("Response: %s", response.text)
        raise Exception(
            f"Failed to get access token: {response.status_code} - {response.text}"
        )

    token_data = response.json()
    access_token = token_data.get("access_token")

    if not access_token:
        logger.error("No access_token in response: %s", token_data)
        raise Exception("No access_token in Cognito response")

    logger.info("Successfully got access token: %s...", access_token[:20])
    return access_token
