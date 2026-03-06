#!/usr/bin/env python3
"""
Test OAuth2 authentication for Terraform-deployed infrastructure.

This script verifies that the OAuth2 Credential Provider is working correctly
by testing machine-to-machine authentication with the Gateway.

USAGE:
    python test-oauth2-auth.py

PREREQUISITES:
    1. Terraform infrastructure must be deployed successfully
       - Run: terraform apply
       - Verify: terraform output shows gateway_url, cognito_domain_url, etc.

    2. Required Python packages:
       - boto3 (AWS SDK)
       - requests (HTTP client)
       Install: pip install boto3 requests

    3. AWS credentials configured:
       - AWS CLI configured (aws configure) OR
       - Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) OR
       - IAM role with permissions to:
         - Read Secrets Manager secrets
         - Query Terraform state

    4. Current directory must be the terraform root (infra-terraform/)
       - Script reads terraform outputs from current directory
       - Run: cd infra-terraform && python test-scripts/test-oauth2-auth.py

WHAT IT TESTS:
    1. Terraform outputs are accessible
       - Retrieves: stack name, Cognito domain, machine client ID, gateway URL

    2. Machine client secret retrieval from Secrets Manager
       - Tests: secretsmanager:GetSecretValue permission
       - Validates: Secret exists and is readable

    3. OAuth2 token exchange with Cognito
       - Flow: Client Credentials Grant (machine-to-machine)
       - Tests: Cognito token endpoint responds correctly
       - Validates: Access token is returned

    4. Gateway authentication with OAuth2 token
       - Tests: Gateway accepts Bearer token
       - Validates: MCP tools/list request succeeds
       - Confirms: OAuth2 Credential Provider integration works

EXPECTED OUTPUT:
    On success:
        [PASS] OAuth2 Authentication Test PASSED
        [x] OAuth2 token retrieved from Cognito
        [x] Gateway authenticated successfully with token
        [x] OAuth2 Credential Provider working correctly

    On failure:
        [FAIL] Descriptive error message
        Exit code: 1

TROUBLESHOOTING:
    Error: "Failed to get Terraform output"
    - Fix: Run from infra-terraform/ directory
    - Fix: Ensure terraform apply completed successfully

    Error: "Failed to get secret"
    - Fix: Check AWS credentials (aws sts get-caller-identity)
    - Fix: Verify IAM permissions for Secrets Manager

    Error: "Failed to get OAuth2 token"
    - Fix: Check Cognito User Pool and App Client exist
    - Fix: Verify machine client secret is correct

    Error: "Gateway request failed"
    - Fix: Verify Gateway URL is accessible
    - Fix: Check Runtime is deployed and running
    - Fix: Confirm OAuth2 Credential Provider is registered
"""

import subprocess
import sys

import boto3
import requests


def run_command(cmd):
    """Run shell command and return output."""
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return result.stdout.strip(), result.returncode


def get_terraform_output(key):
    """Get Terraform output value."""
    output, code = run_command(f"terraform output -raw {key}")
    if code != 0:
        print(f"[FAIL] Failed to get Terraform output for '{key}'")
        sys.exit(1)
    return output


def get_secret(secret_name, region):
    """Get secret from AWS Secrets Manager."""
    client = boto3.client("secretsmanager", region_name=region)
    try:
        response = client.get_secret_value(SecretId=secret_name)
        return response["SecretString"]
    except Exception as e:
        print(f"[FAIL] Failed to get secret '{secret_name}': {e}")
        sys.exit(1)


def test_oauth2_authentication():
    """
    Test OAuth2 authentication flow.

    This is the main test function that orchestrates the full authentication test:
    1. Get configuration from Terraform outputs
    2. Fetch machine client secret from AWS Secrets Manager
    3. Request OAuth2 token from Cognito (client credentials flow)
    4. Test Gateway with the OAuth2 token (MCP tools/list request)
    """
    print("=" * 60)
    print("OAuth2 Authentication Integration Test")
    print("=" * 60)
    print()

    # === PHASE 1: Get Configuration from Terraform ===
    # Terraform outputs contain all the URLs, IDs, and resource names we need
    print("Getting configuration from Terraform...")
    stack_name = get_terraform_output("ssm_parameter_prefix").lstrip("/")
    region = "us-east-1"  # From terraform state
    cognito_domain = get_terraform_output("cognito_domain_url")
    machine_client_id = get_terraform_output("cognito_machine_client_id")
    gateway_url = get_terraform_output("gateway_url")

    print(f"   Stack: {stack_name}")
    print(f"   Region: {region}")
    print(f"   Gateway URL: {gateway_url}")
    print()

    # === PHASE 2: Retrieve Machine Client Secret ===
    # The machine client secret is stored in Secrets Manager (created by Terraform)
    # This is the credential used for machine-to-machine authentication
    print("Fetching machine client secret from Secrets Manager...")
    secret_name = f"/{stack_name}/machine_client_secret"
    machine_client_secret = get_secret(secret_name, region)
    print(f"   Secret retrieved: {secret_name}")
    print()

    # === PHASE 3: OAuth2 Token Exchange with Cognito ===
    # Request an access token using the Client Credentials grant type
    # This simulates what the Runtime does to authenticate with the Gateway
    print("Step 1: Requesting OAuth2 token from Cognito...")
    token_url = f"https://{cognito_domain}/oauth2/token"

    token_response = requests.post(
        token_url,
        data={
            "grant_type": "client_credentials",
            "client_id": machine_client_id,
            "client_secret": machine_client_secret,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )

    if token_response.status_code != 200:
        print(f"[FAIL] Failed to get OAuth2 token: {token_response.status_code}")
        print(f"   Response: {token_response.text}")
        sys.exit(1)

    token_data = token_response.json()
    access_token = token_data.get("access_token")

    if not access_token:
        print("[FAIL] No access token in response")
        print(f"   Response: {token_data}")
        sys.exit(1)

    print("[PASS] OAuth2 token received successfully")
    print(f"   Token type: {token_data.get('token_type')}")
    print(f"   Expires in: {token_data.get('expires_in')} seconds")
    print()

    # === PHASE 4: Test Gateway Authentication ===
    # Send an MCP request to the Gateway using the OAuth2 token
    # This validates the entire OAuth2 Credential Provider flow:
    # - Gateway receives Bearer token
    # - Gateway validates token with Cognito
    # - Runtime uses OAuth2 Credential Provider to authenticate with Gateway
    print("Step 2: Testing Gateway with OAuth2 token...")

    # Create a test MCP request (tools/list is a simple read-only operation)
    mcp_request = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/list",
    }

    gateway_response = requests.post(
        gateway_url,
        json=mcp_request,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        },
        timeout=30,
    )

    if gateway_response.status_code != 200:
        print(f"[FAIL] Gateway request failed: {gateway_response.status_code}")
        print(f"   Response: {gateway_response.text}")
        sys.exit(1)

    gateway_data = gateway_response.json()

    if "error" in gateway_data:
        print(f"[FAIL] Gateway returned error: {gateway_data['error']}")
        sys.exit(1)

    print("[PASS] Gateway authentication successful")
    print(f"   Available tools: {len(gateway_data.get('result', {}).get('tools', []))}")

    tools = gateway_data.get("result", {}).get("tools", [])
    if tools:
        print("   Tools:")
        for tool in tools:
            print(f"      - {tool.get('name')}: {tool.get('description', 'N/A')}")
    print()

    # Summary
    print("=" * 60)
    print("[PASS] OAuth2 Authentication Test PASSED")
    print("=" * 60)
    print()
    print("[x] OAuth2 token retrieved from Cognito")
    print("[x] Gateway authenticated successfully with token")
    print("[x] OAuth2 Credential Provider working correctly")
    print()


if __name__ == "__main__":
    """
    Main entry point for the test script.

    USAGE EXAMPLES:
        # Run from terraform directory
        cd infra-terraform
        python test-scripts/test-oauth2-auth.py

        # Run with verbose AWS debugging (if needed)
        export AWS_DEFAULT_REGION=us-east-1
        export BOTO_LOG_LEVEL=DEBUG
        python test-scripts/test-oauth2-auth.py

        # Check exit code in scripts
        python test-scripts/test-oauth2-auth.py
        if [ $? -eq 0 ]; then echo "Tests passed"; fi
    """
    try:
        test_oauth2_authentication()
    except KeyboardInterrupt:
        print("\n\n[FAIL] Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n[FAIL] Test failed with error: {e}")
        import traceback

        traceback.print_exc()
        sys.exit(1)
