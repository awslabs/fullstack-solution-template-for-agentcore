# Identity Propagation & Cedar Policy Guide

This document describes how FAST propagates user identity from the frontend through to AgentCore Gateway Cedar policies, enabling fine-grained, user-level access control on Gateway tools.

## Overview

AgentCore Gateway authenticates requests using OAuth2 tokens validated by a CUSTOM_JWT authorizer. By default, the Runtime obtains M2M tokens via the Client Credentials flow, and all requests carry the same machine identity. This means the Gateway cannot distinguish between individual users.

This feature adds **identity propagation** on top of the existing M2M flow: the authenticated user's identity is embedded into the M2M token using Cognito's `aws_client_metadata` parameter and V3 Pre-Token Lambda trigger. The enriched token is then evaluated by Cedar policies at the Gateway, enabling access control rules like "only users in the finance department can access the billing tool."

**Use this when:** Gateway tools need user-level access control based on attributes like department, role, or user ID.

## Architecture / Flow

The identity propagation flow has six steps:

```
1. User logs in → Frontend gets JWT from Cognito
2. Frontend sends request → Runtime validates JWT, extracts user_id (sub claim)
3. Runtime calls Cognito /oauth2/token with aws_client_metadata containing user_id
4. Cognito V3 Pre-Token Lambda fires → reads user_id → injects department/role claims into M2M token
5. Runtime calls Gateway tool with the enriched M2M token
6. Gateway's CUSTOM_JWT Authorizer maps token claims to Cedar principal tags → Policy Engine evaluates Cedar policy → allow or deny
```

Key security property: the `user_id` comes from the validated JWT in the Runtime's Session Context (`sub` claim), not from the LLM or request payload. This ensures the identity chain is cryptographically secure end-to-end.

## Components

### Cognito ESSENTIALS Tier

**File:** `infra-cdk/lib/cognito-stack.ts`

The Cognito User Pool is configured with `featurePlan: ESSENTIALS`. This is required because V3 Pre-Token Generation Lambda triggers only fire on Client Credentials (M2M) grants when the ESSENTIALS tier is enabled. Without it, the Pre-Token Lambda would not be invoked during M2M token generation.

### V3 Pre-Token Lambda

**File:** `infra-cdk/lambdas/pretoken-v3/index.py`

This Lambda fires on every token generation event (both user login and M2M). It only processes M2M flows (`TokenGeneration_ClientCredentials`) and skips user login flows.

For M2M flows, it reads `verified_user_id` from `clientMetadata` and assigns department/role claims based on the user's identity:

| User Email Contains | Department | Role |
|---------------------|------------|------|
| `alice` | finance | admin |
| `bob` | engineering | developer |
| (anything else) | guest | viewer |

These claims are injected into the M2M access token via `claimsToAddOrOverride`:
- `user_id` — the authenticated user's ID
- `department` — the user's department
- `role` — the user's role

To use dynamic group assignment, replace the hardcoded logic in the Pre-Token Lambda with a DynamoDB lookup, directory service query, or other identity provider.

### Cedar Policy File

**File:** `gateway/policies/policy.cedar`

The Cedar policy defines access control rules for Gateway tools. It is loaded by CDK at deploy time, with `//` comment lines stripped and the `{{GATEWAY_ARN}}` placeholder replaced with the actual Gateway ARN.

Two policy versions are provided:

**Version 1 (Active by default):** All departments — including guest — can access the tool.

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"sample-tool-target___text_analysis_tool",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("department") &&
  (principal.getTag("department") == "finance" ||
   principal.getTag("department") == "engineering" ||
   principal.getTag("department") == "guest")
};
```

**Version 2 (Commented out):** Only finance and engineering can access the tool. Guests are denied automatically because Cedar is deny-by-default.

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"sample-tool-target___text_analysis_tool",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("department") &&
  (principal.getTag("department") == "finance" ||
   principal.getTag("department") == "engineering")
};
```

To switch versions: edit `gateway/policies/policy.cedar` (comment out one version, uncomment the other), then run `cdk deploy`.

### Policy Engine Custom Resource

**Files:**
- `infra-cdk/lambdas/cedar-policy/index.py` — Custom Resource Lambda
- `infra-cdk/lib/backend-stack.ts` — CDK resource definition

A CloudFormation Custom Resource manages the full Policy Engine lifecycle because no L1/L2 CDK construct exists for AgentCore Policy. The Lambda handles three CloudFormation events:

- **Create:** Creates Policy Engine → creates Cedar Policy → attaches Policy Engine to Gateway
- **Update:** Deletes existing policies → creates new policy with updated document → verifies engine is still attached to Gateway
- **Delete:** Detaches Policy Engine from Gateway → deletes all policies → deletes Policy Engine

All operations use official boto3 waiters (`policy_engine_active`, `policy_engine_deleted`, `policy_active`, `policy_deleted`). Gateway status changes use a custom polling loop as no official waiter exists.

### Gateway Authorizer

**File:** `infra-cdk/lib/backend-stack.ts`

The Gateway uses a `CUSTOM_JWT` authorizer configured with the Cognito OIDC discovery URL and the machine client ID. The authorizer validates M2M tokens and automatically maps all JWT claims to Cedar principal tags:

| JWT Claim | Cedar Principal Tag |
|-----------|-------------------|
| `department` | `principal.getTag("department")` |
| `role` | `principal.getTag("role")` |
| `user_id` | `principal.getTag("user_id")` |

## Cedar Policy Guide

### Policy File Location

`gateway/policies/policy.cedar` — edit this file and run `cdk deploy` to apply changes. The Custom Resource Lambda detects the change and updates the policy in-place without recreating the Policy Engine.

### Action Name Format

Cedar action names follow the format: `<TargetName>___<tool_name>` (triple underscore).

- **TargetName** comes from the `CfnGatewayTarget` name in `backend-stack.ts` (e.g., `sample-tool-target`)
- **tool_name** comes from `tool_spec.json` (e.g., `text_analysis_tool`)
- Combined: `sample-tool-target___text_analysis_tool`

These are case-sensitive. A mismatch silently denies all requests even when the policy logic looks correct.

### Deny-by-Default

Cedar is deny-by-default: if no `permit` statement matches a request, it is automatically denied. An explicit `forbid` statement is not needed to block access — simply omit the department from the permit's conditions.

For example, to deny guests, remove `"guest"` from the department list. No `forbid` statement is required.

### Adding New Tools

When adding a new Gateway target and tool:

1. Create the new Lambda tool and `CfnGatewayTarget` in `backend-stack.ts`
2. Add a new `permit` statement to `policy.cedar` with the correct action name
3. Run `cdk deploy`

Each `create_policy` call creates one policy containing one Cedar statement. The Custom Resource currently creates a single policy per deploy. To add multiple policies (e.g., separate permit and forbid statements), update the Custom Resource Lambda to call `create_policy()` once per statement.

## Two Authentication Approaches

FAST provides two approaches for Gateway authentication in each pattern's `tools/gateway.py`:

### Approach 1 (Active): Direct Cognito Call

Calls the Cognito `/oauth2/token` endpoint directly with `aws_client_metadata` containing the user's identity. The V3 Pre-Token Lambda reads this metadata and injects user-specific claims into the M2M token.

**Use when:** The M2M token needs to carry user-specific claims for Cedar policy evaluation.

**Trade-off:** Requires outbound HTTPS access to the Cognito hosted domain (NAT Gateway needed in VPC mode).

### Approach 2 (Commented Out): @requires_access_token Decorator

Uses the AgentCore Identity SDK decorator for automatic token retrieval, caching, and refresh via the Token Vault. Simpler setup, but does not support `aws_client_metadata`, so the Pre-Token Lambda cannot identify the user.

**Use when:** Pure M2M authentication is sufficient and no user identity is needed in the token.

### Switching from Approach 1 to Approach 2

Each pattern's `tools/gateway.py` contains both approaches with switching instructions:

1. Uncomment the decorator-based `_fetch_gateway_token()` function
2. Comment out the Approach 1 `create_gateway_mcp_client(user_id)`
3. Uncomment the Approach 2 `create_gateway_mcp_client()` (no `user_id` param)
4. Update callers to not pass `user_id`
5. Verify `GATEWAY_CREDENTIAL_PROVIDER_NAME` env var is set in the CDK Runtime config (already configured in `backend-stack.ts`)

## Customization

### Changing Group Assignment

Edit `infra-cdk/lambdas/pretoken-v3/index.py` to replace the hardcoded email-based logic with your own identity resolution. For example:

- Query a DynamoDB table mapping user IDs to departments
- Call an external directory service (LDAP, Active Directory)
- Call the Cognito API (`AdminGetUser`) to read user attributes or group membership for the `user_id` received in `clientMetadata`

### Adding New Claims

To add new claims to the M2M token:

1. Add the claim to `claimsToAddOrOverride` in the Pre-Token Lambda
2. Reference the claim in Cedar policy using `principal.getTag("claim_name")`
3. No Gateway configuration change is needed — the CUSTOM_JWT authorizer maps all JWT claims to Cedar tags automatically

### VPC Mode

When deploying in VPC mode, Approach 1 (direct Cognito call) requires a **NAT Gateway** because the Cognito `/oauth2/token` hosted domain is a public HTTPS endpoint with no VPC endpoint available.

Approach 2 (`@requires_access_token` decorator) does not require a NAT Gateway — the AgentCore Identity service handles the Cognito token exchange server-side within AWS, reachable through the `bedrock-agentcore` VPC endpoint.

See `docs/DEPLOYMENT.md` for full VPC configuration details.

## Verifying Policy Decisions via Tracing

To verify Cedar policy allow/deny decisions in CloudWatch logs:

1. Go to **AWS Console → Bedrock AgentCore → Runtimes**
2. Click on your runtime (e.g., `FAST_stack_FASTAgent`) from the Runtime resources section
3. Scroll down to **Tracing**, click **Edit**, and toggle **Enable tracing** to Enable
4. Go to **Bedrock AgentCore → Gateways**
5. Click on your gateway (e.g., `FAST-stack-gateway`), scroll down to **Tracing**, click **Edit**, and toggle **Enable tracing** to Enable
6. Run a query from the frontend that triggers a tool call
7. Go to **CloudWatch Console → Log Management → Log groups**
8. Find and click on the `aws/spans` log group, then click on the default log stream
9. In the **Filter events** search box, type `policy`
10. Look for the `AgentCore.Policy.PartiallyAuthorizeActions` span — it contains:
    - `aws.agentcore.policy.allowed_tools`: tools the user is permitted to use
    - `aws.agentcore.policy.denied_tools`: tools the user is denied access to
    - `aws.agentcore.gateway.policy.mode`: should show `ENFORCE`
