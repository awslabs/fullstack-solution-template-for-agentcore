"""
Pre-Token Generation Lambda (V3) for M2M flows.

Injects CUSTOM claims into M2M access tokens for AgentCore Policy
enforcement. This Lambda fires on BOTH user login and M2M token generation.
Only M2M flows (Client Credentials grant) are processed; user login flows
are passed through unchanged.

Custom claims injected (application-defined, not standard JWT/OIDC claims):
  - user_id:    The authenticated user's stable Cognito sub (a UUID)
  - department: The user's department (e.g., "finance")
  - role:       The user's role (e.g., "admin")

These claim names are arbitrary — you can define any names you need.
Just ensure the names match between this Lambda's output and the Cedar
policy's principal.getTag() references.

Two values are read from clientMetadata, both passed via the
aws_client_metadata parameter in the direct Cognito /oauth2/token call
(see patterns/utils/auth.py — get_gateway_access_token):
  - verified_user_id: the Cognito sub (UUID), a stable opaque identifier
  - verified_email:   the user's email, resolved from the sub server-side

Group assignment below is keyed off the EMAIL (verified_email), not the sub.
The JWT sub claim is an opaque UUID and never contains a substring like
"fastprojectadmin", so matching against the sub would assign every user to
the default "guest" group. The email is resolved from the sub in
get_gateway_access_token (the access token sent to the Runtime carries no
email claim) and passed here as verified_email.

Group assignment is hardcoded for demo purposes:
  - fastprojectadmin@* → department: "finance", role: "admin"
  - fastuser@*         → department: "engineering", role: "developer"
  - others (including the email registered in config.yaml) → department: "guest", role: "viewer"

The user registered via config.yaml will be assigned "guest/viewer"
by default. To customize, replace the hardcoded logic with a DynamoDB
lookup, directory service query, or other identity provider. Update the
Cedar policy (gateway/policies/policy.cedar) to match the new claim values.

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

    # Read identity values from clientMetadata. Both are passed via
    # aws_client_metadata in the direct Cognito /oauth2/token call.
    #   verified_user_id: the Cognito sub (UUID), a stable opaque identifier
    #   verified_email:   the user's email, used for the demo group mapping
    meta = event["request"].get("clientMetadata", {})
    user_id = meta.get("verified_user_id", "")
    user_email = meta.get("verified_email", "")

    if user_id:
        print("[PRE-TOKEN] Processing M2M token - verified_user_id received")
    else:
        print("[PRE-TOKEN] Processing M2M token - no verified_user_id in metadata")
    if not user_email:
        print(
            "[PRE-TOKEN] No verified_email in metadata - "
            "group assignment will fall back to the default group"
        )

    # Demo identity assignment for Cedar policy evaluation.
    # Replace this logic with a DynamoDB lookup, directory service query,
    # or other identity provider for real deployments.
    #
    # NOTE: assignment is keyed off the EMAIL, not the sub. The sub is an opaque
    # UUID and never contains "fastprojectadmin"/"fastuser", so matching against
    # it would send everyone to the default "guest" group.
    #
    # The Cedar policy (gateway/policies/policy.cedar) has two versions:
    #   V1: permits all departments including "guest"
    #   V2: permits only "finance" and "engineering" (guest is denied)
    #
    # To test different access levels, change the assignment logic below
    # and update the Cedar policy to match.
    if "fastprojectadmin" in user_email.lower():
        department = "finance"
        role = "admin"
        print("[PRE-TOKEN] Assigned: department=finance, role=admin")
    elif "fastuser" in user_email.lower():
        department = "engineering"
        role = "developer"
        print("[PRE-TOKEN] Assigned: department=engineering, role=developer")
    else:
        # Default assignment for all other users.
        # See gateway/policies/policy.cedar (V1 vs V2) to determine
        # whether "guest" is permitted or denied.
        department = "guest"
        role = "viewer"
        print("[PRE-TOKEN] Assigned: department=guest, role=viewer")

    # Inject CUSTOM claims into the M2M Access Token.
    # These are application-defined claims
    # added via Cognito V3 Pre-Token Generation trigger (claimsToAddOrOverride).
    #
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
