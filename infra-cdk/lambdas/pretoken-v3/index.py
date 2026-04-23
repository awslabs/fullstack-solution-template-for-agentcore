"""
Pre-Token Generation Lambda (V3) for M2M flows.

Injects user identity claims into M2M access tokens for AgentCore Policy
enforcement. This Lambda fires on BOTH user login and M2M token generation.
Only M2M flows (Client Credentials grant) are processed; user login flows
are passed through unchanged.

Claims injected:
  - user_id:    The authenticated user's ID (e.g., "alice@example.com")
  - department: The user's department (e.g., "finance")
  - role:       The user's role (e.g., "admin")

The verified_user_id is read from clientMetadata, which is passed via the
aws_client_metadata parameter in the direct Cognito /oauth2/token call
(see patterns/utils/auth.py — get_gateway_access_token).

Group assignment is hardcoded for demo purposes:
  - alice@* → department: "finance", role: "admin"
  - bob@*   → department: "engineering", role: "developer"
  - others  → department: "guest", role: "viewer"

To use dynamic group assignment, replace the hardcoded logic with a
DynamoDB lookup, directory service query, or other identity provider.
"""


def lambda_handler(event: dict, context: dict) -> dict:
    """
    Cognito V3 Pre-Token Generation trigger handler.

    Args:
        event: Cognito trigger event containing triggerSource and request metadata.
        context: Lambda context object.

    Returns:
        Modified event with user identity claims injected into the M2M access token.
    """
    print(f"[PRE-TOKEN] Trigger source: {event.get('triggerSource')}")

    # Only process M2M flows (Client Credentials grant)
    if event["triggerSource"] != "TokenGeneration_ClientCredentials":
        print("[PRE-TOKEN] Not a Client Credentials flow - skipping")
        return event

    # Get verified user_id from clientMetadata
    # This is passed via aws_client_metadata in the direct Cognito /oauth2/token call
    meta = event["request"].get("clientMetadata", {})
    user_id = meta.get("verified_user_id", "")

    if user_id:
        print("[PRE-TOKEN] Processing M2M token - verified_user_id received")
    else:
        print("[PRE-TOKEN] Processing M2M token - no verified_user_id in metadata")

    # Mock group assignment based on user_id (hardcoded for demo)
    # To use dynamic assignment, replace with a DynamoDB or directory service lookup
    if "alice" in user_id.lower():
        department = "finance"
        role = "admin"
        print("[PRE-TOKEN] Assigned: department=finance, role=admin")
    elif "bob" in user_id.lower():
        department = "engineering"
        role = "developer"
        print("[PRE-TOKEN] Assigned: department=engineering, role=developer")
    else:
        department = "guest"
        role = "viewer"
        print("[PRE-TOKEN] Assigned: department=guest, role=viewer")

    # Inject claims into the M2M Access Token
    # These claims will be available to Cedar policies at the Gateway
    event["response"]["claimsAndScopeOverrideDetails"] = {
        "accessTokenGeneration": {
            "claimsToAddOrOverride": {
                "user_id": user_id,
                "department": department,
                "role": role,
            }
        }
    }

    print("[PRE-TOKEN] Claims injected successfully")
    return event
