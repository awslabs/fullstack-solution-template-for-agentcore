# Identity Propagation & Cedar Policy Guide

This document describes how FAST propagates user identity from the frontend through to AgentCore Gateway Cedar policies, enabling fine-grained, user-level access control on Gateway tools.

## Overview

AgentCore Gateway authenticates requests using OAuth2 tokens validated by a CUSTOM_JWT authorizer. By default, the Runtime obtains M2M tokens via the Client Credentials flow, and all requests carry the same machine identity. This means the Gateway cannot distinguish between individual users.

This feature adds **identity propagation** on top of the existing M2M flow: the authenticated user's identity is embedded into the M2M token using Cognito's `aws_client_metadata` parameter and V3 Pre-Token Lambda trigger. The enriched token is then evaluated by Cedar policies at the Gateway, enabling access control rules like "only users in the finance department can access the billing tool."

**Use this when:** Gateway tools need user-level access control based on attributes like department, role, or user ID.

> **Scope of this demo:** This implementation demonstrates user-to-tool access control (e.g., "guest users cannot use the text_analysis_tool from the AgentCore Gateway"). AgentCore Policy supports additional capabilities — including input validation, conditional access based on request parameters, and multi-tool policies — which are documented in [Cedar Policy Capabilities](CEDAR_POLICY_GUIDE.md#cedar-policy-capabilities).

## What is AgentCore Policy?

AgentCore Policy is a service that controls what your AI agents are allowed to do. Think of it as a security guard sitting between your agent and its tools — every time the agent tries to use a tool, the guard checks the rules and decides: allow or deny.

**The simple version:**
- You write rules (Cedar policies) that say who can use which tools, and under what conditions
- The Policy Engine enforces those rules automatically on every single tool call
- If no rule explicitly allows an action, it's denied (deny-by-default)
- Enforcement is deterministic — unlike prompt engineering, policies cannot be bypassed by clever phrasing

**What it can control:**

| Capability | Example Rule | Demonstrated in This Demo? |
|-----------|-------------|---------------------------|
| User-to-tool access | "Only finance users can access the billing tool" | Yes |
| Input validation | "Refund amount cannot exceed $1000" | No (see [Cedar Policy Guide](CEDAR_POLICY_GUIDE.md#cedar-policy-capabilities)) |
| Multi-tool policies | "Developers can use read tools but not write tools" | No (see [Cedar Policy Guide](CEDAR_POLICY_GUIDE.md#cedar-policy-capabilities)) |
| Environment isolation | "Only production runtime can access production tools" | No (see [Runtime-Level Access Control](#runtime-level-access-control)) |
| Conditional access | "Allow tool only when query targets a specific account" | No (see [Cedar Policy Guide](CEDAR_POLICY_GUIDE.md#cedar-policy-capabilities)) |

**This demo implements** user-to-tool access control based on custom `department` claims. The other capabilities use the same infrastructure (Policy Engine + Cedar + Gateway) with different policy conditions. See [Cedar Policy Capabilities](CEDAR_POLICY_GUIDE.md#cedar-policy-capabilities) for the full syntax reference with examples of each capability.

**Key concepts:**
- **Policy Engine** — The evaluation engine that processes Cedar policies. One engine attaches to one Gateway.
- **Cedar Policy** — A declarative rule written in [Cedar](https://www.cedarpolicy.com/), AWS's open-source policy language. Deterministic, not probabilistic.
- **CUSTOM_JWT Authorizer** — The Gateway component that validates tokens and maps JWT claims to Cedar principal tags.
- **Deny-by-default** — If no `permit` statement matches, the request is denied. No explicit `forbid` needed.
- **Tool filtering** — Denied tools are hidden from the agent at discovery time (`tools/list`), not just blocked at execution time. See [Tool Discovery vs Execution](CEDAR_POLICY_GUIDE.md#tool-discovery-vs-execution).

## Architecture / Flow

The identity propagation flow has seven steps:

```
1. User logs in → Frontend gets JWT from Cognito
2. Frontend sends request → Runtime validates JWT, extracts user_id (sub claim)
3. Runtime resolves the user's email from the sub (Cognito ListUsers), since the access token carries no email claim
4. Runtime calls Cognito /oauth2/token with aws_client_metadata containing user_id (sub) and email
5. Cognito V3 Pre-Token Lambda fires → reads email → injects department/role claims into M2M token
6. Runtime calls Gateway tool with the enriched M2M token
7. Gateway's CUSTOM_JWT Authorizer maps token claims to Cedar principal tags → Policy Engine evaluates Cedar policy → allow or deny
```

Key security property: the `user_id` comes from the validated JWT in the Runtime's Session Context (`sub` claim), not from the LLM or request payload. This ensures the identity chain is cryptographically secure end-to-end. The email used for group assignment is resolved server-side from that same `sub` (never taken from the payload), so it inherits the same integrity guarantee.

> **Why resolve the email separately?** The `sub` claim is an opaque UUID, so it can never contain a substring like `fastprojectadmin`. The Cognito **access token** sent to the Runtime does not include an `email` claim either. To drive email-based group assignment, the Runtime looks the email up from the `sub` via the Cognito `ListUsers` API (see `get_user_email` in `patterns/utils/auth.py`) and propagates it as `verified_email`.

## Components

### Cognito ESSENTIALS Tier

**File:** `infra-cdk/lib/cognito-stack.ts`

The Cognito User Pool is configured with `featurePlan: ESSENTIALS`. This is required because V3 Pre-Token Generation Lambda triggers only fire on Client Credentials (M2M) grants when the ESSENTIALS tier is enabled. Without it, the Pre-Token Lambda would not be invoked during M2M token generation.

### V3 Pre-Token Lambda

**File:** `infra-cdk/lambdas/pretoken-v3/index.py`

This Lambda fires on every token generation event (both user login and M2M). It only processes M2M flows (`TokenGeneration_ClientCredentials`) and skips user login flows.

For M2M flows, it reads `verified_email` from `clientMetadata` and assigns department/role claims based on the email (the `verified_user_id` sub is also available as a stable identifier):

| User Email Contains | Department | Role |
|---------------------|------------|------|
| `fastprojectadmin` | finance | admin |
| `fastuser` | engineering | developer |
| (anything else, including the email registered in config.yaml) | guest | viewer |

These claims are injected into the M2M access token via `claimsToAddOrOverride`:
- `user_id` — the authenticated user's ID
- `department` — the user's department
- `role` — the user's role

> **Note:** These claim names (`user_id`, `department`, `role`) are custom, application-defined claims — not standard JWT/OIDC claims. You can define any claim names you need. See [Understanding Claims](CEDAR_POLICY_GUIDE.md#understanding-claims-custom-vs-standard) for details.

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

The Gateway uses a `CUSTOM_JWT` authorizer configured with the Cognito OIDC discovery URL and the machine client ID. The authorizer validates M2M tokens and maps JWT claims to Cedar principal tags:

| JWT Claim | Cedar Principal Tag | Claim Type |
|-----------|-------------------|------------|
| `department` | `principal.getTag("department")` | Custom (injected by Pre-Token Lambda) |
| `role` | `principal.getTag("role")` | Custom (injected by Pre-Token Lambda) |
| `user_id` | `principal.getTag("user_id")` | Custom (injected by Pre-Token Lambda) |

## Cedar Policy Guide

For the full Cedar policy reference — including claims, action format, schema constraints, tool discovery vs execution, and policy capabilities — see [Cedar Policy Guide](CEDAR_POLICY_GUIDE.md).

## Two Authentication Approaches

FAST provides two approaches for Gateway authentication in each pattern's `tools/gateway.py`:

> **Replacing Cognito?** For swapping Cognito with another Identity Provider (Okta, Auth0, Entra ID, etc.) or using Gateway Interceptors for dynamic access control, see [Replacing Cognito](REPLACING_COGNITO.md).

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

### Runtime-Level Access Control

By default, all requests through a Gateway share the same machine client identity. If you deploy multiple AgentCore Runtimes and need to control which runtime can access which tools, you can use the Cognito `clientId` as a cryptographically verified runtime identity.

**Why not use `context.runtime.arn` in Cedar?**
The Cedar schema only supports `context.input` (tool parameters) — there is no `context.runtime.arn` or similar field. Attempting to reference unsupported context fields will cause policy creation to fail.

**Why not use Cognito Groups?**
Cognito User Pool Groups only apply to user identities, not app clients. In `client_credentials` (M2M) flows, there is no user, so the `cognito:groups` claim is never present in the token.

**Solution: One Cognito App Client Per Runtime**

Since each CDK stack creates both the Cognito app client and the AgentCore Runtime, the `clientId` serves as the runtime identity — verified cryptographically via the `client_secret`. The Pre-Token Lambda maps the `clientId` to a `runtime_env` claim without any self-reporting.

**Architecture:**

```
Runtime A (production) → authenticates with Client A (client_secret_A)
                          → Cognito verifies clientId = "abc123"
                          → Pre-Token Lambda maps "abc123" → runtime_env: "production"
                          → Cedar policy checks principal.getTag("runtime_env")

Runtime B (staging)    → authenticates with Client B (client_secret_B)
                          → Cognito verifies clientId = "def456"
                          → Pre-Token Lambda maps "def456" → runtime_env: "staging"
                          → Cedar policy checks principal.getTag("runtime_env")
```

**Step 1: Create separate machine clients in CDK**

```typescript
// Create one machine client per runtime environment
const machineClientProd = new cognito.UserPoolClient(this, 'MachineClientProd', {
  userPool: this.userPool,
  generateSecret: true,
  oAuth: {
    flows: { clientCredentials: true },
    // Use the same resource server scopes as the existing machine client
    scopes: [
      cognito.OAuthScope.resourceServer(resourceServer,
        new cognito.ResourceServerScope({ scopeName: 'read', scopeDescription: 'Read access' })),
      cognito.OAuthScope.resourceServer(resourceServer,
        new cognito.ResourceServerScope({ scopeName: 'write', scopeDescription: 'Write access' })),
    ],
  },
});

const machineClientStaging = new cognito.UserPoolClient(this, 'MachineClientStaging', {
  userPool: this.userPool,
  generateSecret: true,
  oAuth: {
    flows: { clientCredentials: true },
    scopes: [
      cognito.OAuthScope.resourceServer(resourceServer,
        new cognito.ResourceServerScope({ scopeName: 'read', scopeDescription: 'Read access' })),
      cognito.OAuthScope.resourceServer(resourceServer,
        new cognito.ResourceServerScope({ scopeName: 'write', scopeDescription: 'Write access' })),
    ],
  },
});

// Pass the mapping to the Pre-Token Lambda as an environment variable
preTokenLambda.addEnvironment('CLIENT_RUNTIME_MAP', JSON.stringify({
  [machineClientProd.userPoolClientId]: 'production',
  [machineClientStaging.userPoolClientId]: 'staging',
}));
```

**Step 2: Map clientId → runtime_env in the Pre-Token Lambda**

```python
import os, json

def lambda_handler(event, context):
    if event["triggerSource"] != "TokenGeneration_ClientCredentials":
        return event

    # clientId is Cognito-verified
    client_id = event["callerContext"]["clientId"]

    # Mapping set at deploy time by CDK
    client_runtime_map = json.loads(os.environ.get("CLIENT_RUNTIME_MAP", "{}"))
    runtime_env = client_runtime_map.get(client_id, "unknown")

    # Existing user identity logic (unchanged)
    meta = event["request"].get("clientMetadata", {})
    user_id = meta.get("verified_user_id", "")  # Cognito sub (UUID)
    user_email = meta.get("verified_email", "")  # resolved from sub server-side

    if "fastprojectadmin" in user_email.lower():
        department, role = "finance", "admin"
    elif "fastuser" in user_email.lower():
        department, role = "engineering", "developer"
    else:
        department, role = "guest", "viewer"

    event["response"]["claimsAndScopeOverrideDetails"] = {
        "accessTokenGeneration": {
            "claimsToAddOrOverride": {
                "user_id": user_id,
                "department": department,
                "role": role,
                "runtime_env": runtime_env,
            }
        }
    }
    return event
```

**Step 3: Add runtime_env to Cedar policy**

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"sample-tool-target___text_analysis_tool",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("runtime_env") &&
  principal.getTag("runtime_env") == "production" &&
  principal.hasTag("department") &&
  (principal.getTag("department") == "finance" ||
   principal.getTag("department") == "engineering")
};
```

**Security model — two-layer identity:**

| Layer | Claim | Source | Trust Level |
|-------|-------|--------|-------------|
| Runtime identity | `runtime_env` | `callerContext.clientId` (Cognito-verified) | Cryptographic — requires `client_secret` |
| User identity | `user_id`, `department`, `role` | `clientMetadata.verified_user_id` (from validated JWT `sub` claim) | JWT-verified — extracted server-side by Runtime from Cognito-validated token |

Both layers are secured by Cognito: the `clientId` is verified through the client secret exchange, and the `user_id` originates from the validated JWT `sub` claim extracted by `extract_user_id_from_context()` in the Runtime.

> **Note:** This section documents the architecture pattern for runtime-level access control. The current FAST implementation uses a single machine client. To implement this pattern, create additional machine clients in `cognito-stack.ts` and update the Pre-Token Lambda with the mapping logic above.

## Verifying the Deployed Policy

To check which Cedar policy is currently active on the Gateway:

1. Go to **AWS Console → Bedrock AgentCore → Policy**
2. Click on your Policy Engine (e.g., `FAST_stack_policy_engine`) from the Policy engines section
3. In the **Policies** section, click on your policy (e.g., `FAST_stack_policy_engine_cp_<timestamp>`)
4. The **Definition** section shows the policy breakdown:
    - **Effect**: `permit` or `forbid`
    - **Scope: Principal**: `AgentCore::OAuthUser`
    - **Scope: Actions**: the tool action name (e.g., `sample-tool-target___text_analysis_tool`)
    - **Scope: Resource**: the Gateway name
    - **Conditions**: the `when` clause logic
5. The **Cedar** section shows the full Cedar policy statement as deployed

Use this to confirm that a `cdk deploy` applied the expected policy version.

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
