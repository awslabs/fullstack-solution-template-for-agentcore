"""
Pre-Token Generation Lambda (V3) for M2M flows.

Injects CUSTOM claims into M2M access tokens for AgentCore Policy
enforcement. This Lambda fires on BOTH user login and M2M token generation.
Only M2M flows (Client Credentials grant) are processed; user login flows
are passed through unchanged.

Custom claims injected (application-defined, not standard JWT/OIDC claims):
  - user_id:    The authenticated user's Cognito sub (a UUID)
  - department: The user's department (e.g., "finance")
  - role:       The user's role (e.g., "admin")

These claim names are arbitrary — you can define any names you need.
Just ensure the names match between this Lambda's output and the Cedar
policy's principal.getTag() references.

The verified_user_id (Cognito sub) is read from clientMetadata, which is
passed via the aws_client_metadata parameter in the direct Cognito
/oauth2/token call (see patterns/utils/auth.py — get_gateway_access_token).
The Cognito sub is an opaque, immutable UUID assigned to each user at
creation time (e.g., "a1b2c3d4-5678-90ab-cdef-1234567890ab").
See docs/IDENTITY_POLICY.md for setup instructions.

GROUP ASSIGNMENT SETUP (two-step deployment):
  1. Deploy the stack once (all users will be assigned "guest/viewer")
  2. Look up user UUIDs: aws cognito-idp list-users --user-pool-id <pool-id>
  3. Replace the placeholder UUIDs below with actual user subs
  4. Redeploy (cdk deploy) to apply the updated mapping

ALTERNATIVE (email-based matching without two-step deploy):
  If you prefer email-based matching that works on first deploy without
  UUID lookup, see docs/IDENTITY_POLICY.md for instructions on adding
  email resolution via Cognito ListUsers API in this Lambda.

To use dynamic group assignment, replace the hardcoded mapping below with a
DynamoDB table keyed by the user's sub (UUID). See docs/IDENTITY_POLICY.md.
"""

# ============================================================================
# USER-TO-GROUP MAPPING
# ============================================================================
# Replace the placeholder UUIDs below with actual Cognito user subs after
# first deploy. Run: aws cognito-idp list-users --user-pool-id <pool-id>
# The sub is found in each user's Attributes list under Name="sub".
#
# Format: "<cognito-sub-uuid>": {"department": "...", "role": "..."}
#
# The UUID must be wrapped in quotes as a string key.
# ============================================================================
USER_ROLE_MAP = {
    "<fastprojectadmin-user-sub-uuid>": {"department": "finance", "role": "admin"},
    "<fastuser-user-sub-uuid>": {"department": "engineering", "role": "developer"},
}

# Default assignment when user is not in the map.
# With Cedar policy V1: guest is permitted.
# With Cedar policy V2: guest is denied (gateway target tool hidden from agent).
DEFAULT_GROUP = {"department": "guest", "role": "viewer"}


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

    # Read the verified user_id (Cognito sub / UUID) from clientMetadata.
    # This is passed via aws_client_metadata in the direct Cognito /oauth2/token call.
    meta = event["request"].get("clientMetadata", {})
    user_id = meta.get("verified_user_id", "")

    if not user_id:
        print("[PRE-TOKEN] No verified_user_id in metadata")
        return event

    print("[PRE-TOKEN] Processing M2M token - verified_user_id received")

    # Look up department/role from the UUID mapping.
    # If the user's sub is not in the map, they get the default group (guest/viewer).
    # To assign yourself to a non-default group, replace the placeholder UUIDs
    # above with your actual Cognito sub. See docs/IDENTITY_POLICY.md.
    group = USER_ROLE_MAP.get(user_id, DEFAULT_GROUP)
    department = group["department"]
    role = group["role"]
    print(f"[PRE-TOKEN] Assigned: department={department}, role={role}")

    # Inject CUSTOM claims into the M2M Access Token.
    # At the AgentCore Gateway, the JWT Authorizer maps ALL token claims
    # (both standard and custom) to Cedar principal tags:
    #   Custom claim "user_id"    → principal.getTag("user_id")
    #   Custom claim "department" → principal.getTag("department")
    #   Custom claim "role"       → principal.getTag("role")
    #
    # Standard claims (sub, iss, client_id, exp, etc.) are also available as tags
    # but are managed automatically by Cognito and cannot be overridden here.
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
