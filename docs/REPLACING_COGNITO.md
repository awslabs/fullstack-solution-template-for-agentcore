# Replacing Cognito: Identity Provider Swap & Gateway Interceptors Guide

This document explains how to replace Amazon Cognito with another Identity Provider (IdP) in the FAST AgentCore architecture, and how to use Gateway Interceptors as an alternative or complement to Cedar Policy for access control.

---

## 1. Overview

### Current Architecture Summary

The FAST demo uses Amazon Cognito as the Identity Provider with the following flow:

```
User JWT → Runtime (validates user) → Runtime gets M2M token from Cognito → Pre-Token Lambda injects user claims into M2M token → Gateway authorizer validates M2M token → Cedar Policy Engine evaluates user claims → allows/denies tool access → Target Lambda receives tool input only
```

**This document addresses two questions:** how the Gateway identifies the user for access control enforcement, and how to achieve this with a different IdP.

### Two Approaches

| Approach | When to Use |
|----------|-------------|
| **Approach A: Swap IdP, Keep Cedar Policy** | The new IdP supports token enrichment (injecting custom claims into M2M tokens at issuance time) |
| **Approach B: Gateway Interceptors** | The new IdP does NOT support token enrichment, OR fully dynamic access control is needed |

---

## 2. Approach A — Swap IdP, Keep Cedar Policy

**For:** IdPs that support token enrichment — Okta (Token Inline Hooks), Auth0 (Actions), Entra ID (Claims Mapping Policies), or similar.

### 2a. How It Works

The architecture remains the same as the current Cognito flow. Cognito-specific components are replaced with equivalents from the new IdP:

```
User JWT → Runtime (validates user via new IdP's OIDC) → Runtime gets M2M token from new IdP's token endpoint → IdP's token enrichment hook injects user claims (replaces Pre-Token Lambda) → Gateway authorizer validates M2M token (via new IdP's OIDC discovery URL) → Cedar Policy Engine evaluates user claims → allows/denies (UNCHANGED) → Target Lambda receives tool input only (UNCHANGED)
```

**Key insight:** The AgentCore Gateway's CUSTOM_JWT authorizer is **IdP-agnostic**. The official AWS documentation states:

> "The inbound authorizer is Identity Provider (IdP) agnostic and works with any OAuth 2.0 compatible identity provider."

Only a valid OIDC discovery URL is needed, and the Gateway will validate tokens from any issuer.

### 2b. What Needs to Change (Component Mapping)

| Component | Current (Cognito) | New (Third-Party IdP) |
|-----------|---|---|
| Gateway authorizer discovery URL | `https://cognito-idp.{region}.amazonaws.com/{pool_id}/.well-known/openid-configuration` | `https://{your-idp}/.well-known/openid-configuration` |
| Token endpoint | `POST https://{cognito_domain}/oauth2/token` | IdP's token endpoint (e.g., `https://{okta_domain}/oauth2/v1/token`) |
| Identity propagation to token enrichment | `aws_client_metadata: {"verified_user_id": "..."}` (Cognito-specific) | IdP-specific mechanism (see below) |
| Token enrichment mechanism | Pre-Token Lambda (V3, Cognito trigger) | IdP's native hook (see below) |
| Cedar Policy | **Unchanged** — still reads `principal.getTag("department")` etc. | **Unchanged** |
| Target Lambda | **Unchanged** — receives tool input only | **Unchanged** |

### IdP-Specific Token Enrichment Mechanisms

| IdP | Token Enrichment Feature | How Identity Is Propagated |
|-----|---|---|
| **Okta** | Token Inline Hooks | Hook receives client context; can enrich based on custom parameters passed in the token request |
| **Auth0** | Actions (post-client-credentials) | Actions can read metadata attached to the M2M application or use a custom `audience` parameter |
| **Entra ID** | Claims Mapping Policies | Application roles + claims mapping; can include group memberships directly in the token |
| **Cognito** | Pre-Token Lambda (V3) | `aws_client_metadata` passes user_id to the Lambda |

### 2c. Common Concerns

**Q: Does the LLM ever see the token?**

No. Tokens live in the HTTP transport layer managed by the Python agent code and the MCP client library. The LLM only interacts with tool schemas and tool results — it has no access to HTTP headers or tokens.

**Q: What if the IdP doesn't support injecting arbitrary claims into M2M tokens?**

Use Approach B (Gateway Interceptors) described in the next section.

---

## 3. Approach B — Gateway Interceptors (No Token Enrichment Needed)

**For:** Any OIDC-compliant IdP, even those without token enrichment hooks. Also useful when fully dynamic access control is needed (e.g., permissions stored in a database that change at runtime).

### 3a. How It Works

Instead of enriching the M2M token with user claims, the Runtime passes user identity as a **separate custom header**. The Gateway Interceptor Lambda reads this header and makes access control decisions.

There are two options for how the Runtime passes user identity to the Gateway:

#### Option 1: Pass User ID Only

The Runtime extracts the user_id from the validated user JWT and passes it as a plain string header:

```
User JWT → Runtime (validates user JWT via any IdP's OIDC)
  → Runtime extracts user_id from validated JWT
  → Runtime gets a plain M2M token from IdP (no user claims needed)
  → Runtime sends to Gateway:
    - Authorization: Bearer <M2M_token>        ← proves machine trust
    - X-User-Id: <user-sub-uuid>               ← carries user identity (plain string)
  → Gateway authorizer validates M2M token only (machine trust)
  → Request Interceptor Lambda fires:
    - Reads X-User-Id from custom header
    - Looks up user's permissions (from IdP groups, DB, YAML, etc.)
    - Allows or denies the tools/call request
  → Response Interceptor Lambda fires (for tools/list):
    - Same permission lookup
    - Filters the tool list to only show permitted tools
  → Target receives tool input only (no tokens, no headers)
```

**Runtime code:**

```python
# In the agent code (runs in AgentCore Runtime)
user_id = extract_user_id_from_context(context)  # from validated user JWT
m2m_token = await get_m2m_token()  # plain M2M, no user claims

mcp_client = MCPClient(
    gateway_url=GATEWAY_URL,
    headers={
        "Authorization": f"Bearer {m2m_token}",  # machine trust
        "X-User-Id": user_id,                     # user identity (plain string)
    }
)
```

**Interceptor reads it:**

```python
def lambda_handler(event, context):
    """Request interceptor: reads user identity from plain string header."""
    gateway_request = event['mcp']['gatewayRequest']
    headers = gateway_request.get('headers', {})
    
    # Simple string extraction — no JWT decoding needed
    user_id = headers.get('X-User-Id', '')
    
    # Look up permissions for this user (from DB, YAML, IdP API, etc.)
    permissions = get_user_permissions(user_id)
    # ... allow or deny based on permissions
```

| Pros | Cons |
|------|------|
| Simple — no JWT decoding in interceptor | Relies on trust in the Gateway boundary |
| Low latency — no signature verification | Interceptor must call an external source (DB, IdP API) to get user attributes |
| Minimal data exposure | Cannot verify the user_id is authentic within the interceptor itself |

**When to use:** When the Gateway boundary is the trust boundary and only a legitimate Runtime (validated by the M2M token) can set this header.

---

#### Option 2: Pass Full User JWT

The Runtime passes the original user JWT as a separate header. The interceptor can then **verify the JWT signature** to prove it hasn't been tampered with, and extract all user claims directly from it.

```
User JWT → Runtime (validates user JWT via any IdP's OIDC)
  → Runtime keeps the original user JWT
  → Runtime gets a plain M2M token from IdP (no user claims needed)
  → Runtime sends to Gateway:
    - Authorization: Bearer <M2M_token>        ← proves machine trust
    - X-User-Token: <original_user_JWT>        ← carries full user identity (verifiable)
  → Gateway authorizer validates M2M token only (machine trust)
  → Request Interceptor Lambda fires:
    - Reads X-User-Token from custom header
    - Verifies the JWT signature (using IdP's public keys from JWKS endpoint)
    - Extracts claims: user_id, email, groups, department, etc.
    - Decides allow/deny based on claims
  → Response Interceptor Lambda fires (for tools/list):
    - Same JWT verification and claim extraction
    - Filters the tool list based on user's claims
  → Target receives tool input only (no tokens, no headers)
```

**Runtime code:**

```python
# In the agent code (runs in AgentCore Runtime)
user_jwt = get_user_jwt_from_request(context)  # the original user JWT (already validated by Runtime's authorizer)
m2m_token = await get_m2m_token()  # plain M2M, no user claims

mcp_client = MCPClient(
    gateway_url=GATEWAY_URL,
    headers={
        "Authorization": f"Bearer {m2m_token}",    # machine trust
        "X-User-Token": user_jwt,                   # full user JWT (verifiable)
    }
)
```

**Interceptor reads and verifies it:**

```python
import jwt
import requests
from functools import lru_cache

# Cache the JWKS (public keys) from the IdP
@lru_cache(maxsize=1)
def get_jwks(jwks_url):
    """Fetch and cache JWKS public keys from the IdP."""
    response = requests.get(jwks_url)
    return response.json()

def lambda_handler(event, context):
    """Request interceptor: verifies user JWT and extracts claims."""
    gateway_request = event['mcp']['gatewayRequest']
    headers = gateway_request.get('headers', {})
    
    # Extract the full user JWT
    user_token = headers.get('X-User-Token', '')
    
    if not user_token:
        return deny_request("No user token provided")
    
    # Verify JWT signature and extract claims
    try:
        # Get public keys from the IdP's JWKS endpoint
        jwks = get_jwks(IDP_JWKS_URL)  # e.g., https://the-idp/.well-known/jwks.json
        
        # Decode and verify the JWT
        claims = jwt.decode(
            user_token,
            jwks,
            algorithms=["RS256"],
            audience=EXPECTED_AUDIENCE,
            issuer=EXPECTED_ISSUER
        )
    except jwt.ExpiredSignatureError:
        return deny_request("User token expired")
    except jwt.InvalidTokenError as e:
        return deny_request(f"Invalid user token: {e}")
    
    # Extract user attributes directly from verified claims
    user_id = claims.get('sub', '')
    department = claims.get('department', '')
    groups = claims.get('groups', [])  # or 'cognito:groups' for Cognito
    role = claims.get('role', 'viewer')
    
    # Make access control decision based on verified claims
    tool_name = gateway_request['body'].get('params', {}).get('name', '')
    
    if not is_authorized(user_id, department, groups, role, tool_name):
        return deny_request(f"User {user_id} ({department}) not authorized for {tool_name}")
    
    # Authorized — pass through
    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {
            "transformedGatewayRequest": gateway_request
        }
    }
```

| Pros | Cons |
|------|------|
| Cryptographically verifiable — interceptor can prove the JWT is authentic | More complex — requires JWT library and JWKS fetching in the interceptor |
| All user claims available directly (no external lookup needed) | Slightly higher latency (signature verification + JWKS cache) |
| Defense-in-depth — even if M2M token is compromised, user JWT must also be valid | Larger header size (full JWT vs. simple string) |
| Works even when the Runtime boundary is not fully trusted | Must handle token expiry (user JWT may expire before M2M token) |

**When to use:** When defense-in-depth is needed (two independent verifications), when multiple user claims are needed in the interceptor without calling an external service, or when security requirements demand cryptographic proof of user identity at the Gateway level.

---

#### Comparison: Option 1 vs. Option 2

| Aspect | Option 1: X-User-Id (string) | Option 2: X-User-Token (full JWT) |
|--------|---|---|
| **Security model** | Trust the Gateway boundary (M2M token proves caller is legitimate) | Verify independently (JWT signature proves user identity) |
| **What interceptor receives** | Plain user_id string | Full JWT with all claims |
| **Interceptor complexity** | Simple — just read header, look up permissions | More complex — verify JWT, extract claims |
| **External lookups needed** | Yes — must query DB/IdP for user attributes | No — claims are in the JWT |
| **Latency** | Lower (no crypto) + lookup time | Higher (crypto verification) but no lookup needed |
| **Token expiry concern** | None (it's just a string) | Must handle — user JWT may expire |
| **Spoofing risk** | Low (only valid Runtimes can reach Gateway) | None (JWT signature is cryptographic proof) |
| **Best for** | Internal systems with trusted Runtime boundary | High-security environments, zero-trust architectures |

---

**Key insight (applies to both options):** The M2M token and user identity are **separate concerns**:
- **M2M token** (in `Authorization` header) → proves the Runtime is a legitimate caller → validated by Gateway authorizer
- **User identity** (in `X-User-Id` or `X-User-Token` header) → tells the interceptor WHO the request is for → used for access control decisions

The interceptor replaces BOTH the Pre-Token Lambda AND the Cedar Policy Engine's role in checking user identity. The Gateway authorizer still validates the M2M token (to ensure the call is legitimate), but the access control decision moves from Cedar Policy to the Interceptor Lambda.

> **Note:** In both options, the LLM never has access to either token or header. They exist only in the HTTP transport layer managed by the agent's Python code and MCP client library. The LLM only interacts with tool schemas and tool results.

### 3b. Request Interceptor (Controls `tools/call`)

The request interceptor fires **BEFORE** the target Lambda executes. It decides whether to allow or deny the tool invocation.

**Flow:**
```
Agent calls tools/call → Gateway → Request Interceptor Lambda → (if allowed) → Target
```

**What it does:**
1. Extracts the user identity from the custom header (e.g., `X-User-Id`)
2. Identifies which tool is being invoked
3. Checks if the user has permission (via scopes, DB lookup, YAML, etc.)
4. **If authorized** → passes request through to the target
5. **If unauthorized** → returns a structured MCP error, target never executes

**Example code:**

```python
def lambda_handler(event, context):
    """Request interceptor: controls tools/call access."""
    gateway_request = event['mcp']['gatewayRequest']
    
    # Extract user identity from custom header
    headers = gateway_request.get('headers', {})
    user_id = headers.get('X-User-Id', '')
    
    # Identify which tool is being called
    tool_name = gateway_request['body'].get('params', {}).get('name', '')
    target = gateway_request.get('target', '')
    
    # Look up permissions (from DB, YAML, IdP groups, etc.)
    if not check_tool_authorization(user_id, tool_name, target):
        return {
            "interceptorOutputVersion": "1.0",
            "mcp": {
                "transformedGatewayRequest": {
                    "statusCode": 403,
                    "body": {
                        "error": {
                            "code": "UNAUTHORIZED",
                            "message": f"User {user_id} is not authorized to call {tool_name}"
                        }
                    }
                }
            }
        }
    
    # Authorized — pass through to target
    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {
            "transformedGatewayRequest": gateway_request
        }
    }


def check_tool_authorization(user_id, tool, target):
    """Check if user has permission to call this tool.

    This can query a database, read a YAML config, call an IdP API, etc.
    """
    user_scopes = get_user_scopes(user_id)  # from DB or IdP
    if target in user_scopes:
        return True
    return f"{target}:{tool}" in user_scopes
```

### 3c. Response Interceptor (Controls `tools/list`)

The response interceptor fires **AFTER** the target responds. It filters the tool list so the agent only sees tools the user is authorized to use.

**Flow:**
```
Agent calls tools/list → Gateway → Target returns ALL tools → Response Interceptor → Filtered list
```

**What it does:**
1. Receives the full tool list from the target
2. Extracts user identity from the response payload headers
3. For each tool, checks if the user is authorized
4. Returns a transformed response with only permitted tools

**Example code:**

```python
def lambda_handler(event, context):
    """Response interceptor: filters tools/list results."""
    # Extract gateway response and authorization header
    gateway_response = event['mcp']['gatewayResponse']
    auth_header = gateway_response['headers'].get('Authorization', '')
    
    # Extract user identity (from custom header passed through)
    user_id = gateway_response['headers'].get('X-User-Id', '')
    
    # Get tools from gateway response
    tools = gateway_response['body']['result'].get('tools', [])
    # Also check structuredContent (for semantic search responses)
    if not tools:
        tools = gateway_response['body']['result'].get('structuredContent', {}).get('tools', [])
    
    # Look up user permissions and filter tools
    user_scopes = get_user_scopes(user_id)  # from DB, YAML, IdP, etc.
    filtered_tools = filter_tools_by_scope(tools, user_scopes)
    
    # Return transformed response with filtered tools
    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {
            "transformedGatewayResponse": {
                "statusCode": 200,
                "headers": {"Authorization": auth_header},
                "body": {
                    "result": {"tools": filtered_tools}
                }
            }
        }
    }


def filter_tools_by_scope(tools, allowed_scopes):
    """Filter tools based on user's allowed scopes."""
    filtered_tools = []
    for tool in tools:
        target, action = tool['name'].split('___')
        # Check if user has full target access or specific tool access
        if target in allowed_scopes or f"{target}:{action}" in allowed_scopes:
            filtered_tools.append(tool)
    return filtered_tools
```

### 3d. CDK Configuration

```typescript
import { LambdaInterceptor } from '@aws-cdk/aws-bedrock-agentcore-alpha';

// Request interceptor — fires BEFORE target
const requestInterceptor = LambdaInterceptor.forRequest(requestInterceptorLambda, {
  passRequestHeaders: true  // Required: enables reading custom headers (X-User-Id, etc.)
});

// Response interceptor — fires AFTER target responds
const responseInterceptor = LambdaInterceptor.forResponse(responseInterceptorLambda, {
  passRequestHeaders: true  // Required: enables reading headers in the response payload
});

// Attach to Gateway
const gateway = new Gateway(this, 'MyGateway', {
  // ... other config
  interceptors: [requestInterceptor, responseInterceptor],
});
```

**Important:** `passRequestHeaders: true` is required. By default, headers are NOT forwarded to interceptors for security reasons (headers may contain sensitive credentials). This must be explicitly opted in.

### 3e. Security & Common Concerns

**Q: Does the LLM ever touch the user token?**

No. The token and user identity live entirely in the HTTP transport layer:

```
┌─────────────────────────────────────────────────────────┐
│ AgentCore Runtime                                        │
│                                                          │
│  ┌──────────────────┐    ┌───────────────────────────┐  │
│  │ Agent Code       │    │ LLM (Bedrock)             │  │
│  │ (Python)         │◄──►│                           │  │
│  │                  │    │ Only sees:                │  │
│  │ Has access to:   │    │ - Tool schemas            │  │
│  │ - User JWT       │    │ - Tool results            │  │
│  │ - M2M token      │    │ - Conversation text       │  │
│  │ - HTTP headers   │    │                           │  │
│  └────────┬─────────┘    └───────────────────────────┘  │
│           │                                              │
│           ▼                                              │
│  ┌──────────────────┐                                   │
│  │ MCP Client       │ ← handles HTTP transport          │
│  │ (tokens, headers │   (invisible to LLM)              │
│  │  live here)      │                                   │
│  └──────────────────┘                                   │
└─────────────────────────────────────────────────────────┘
```

The LLM only says "call tool X with input Y" — the MCP client handles all HTTP communication including tokens and headers.

**Q: Who validates what?**

| Component | What It Validates | Purpose |
|-----------|-------------------|---------|
| Gateway Authorizer (CUSTOM_JWT) | M2M token from IdP | "Is this a legitimate Runtime calling me?" (machine trust) |
| Request Interceptor Lambda | User identity from X-User-Id header | "Is THIS USER allowed to use THIS TOOL?" (access control) |

They work in sequence:
1. Authorizer fires first → if M2M token is invalid, request is rejected (401)
2. Interceptor fires second → if user doesn't have permission, request is denied (403)
3. Target fires last → only receives tool input (no tokens, no user context)

**Q: Can interceptors and Cedar Policy coexist?**

Yes. They serve complementary purposes:
- **Cedar Policy** handles static, declarative rules (e.g., "finance department can access financial tools")
- **Interceptors** handle dynamic cases (e.g., permissions from a database that change at runtime)

When both are active, the evaluation order is:
1. Gateway authorizer validates the token
2. Cedar Policy Engine evaluates (if configured)
3. Interceptors fire (request before target, response after target)

A request must pass ALL checks to succeed.

---

## 4. Cedar Policy vs. Interceptors — When to Use Which

| Feature | Cedar Policy | Gateway Interceptors |
|---------|-------------|---------------------|
| Where filtering happens | Policy Engine (built-in, managed) | Lambda code |
| What it checks | JWT claims (tags) + context.input | User identity (from header) + any external source (DB, YAML, IdP API) |
| Dynamic? | Static rules (redeploy policy to change) | Fully dynamic (Lambda can query anything at runtime) |
| Tool filtering (tools/list) | Automatic via PartiallyAuthorizeActions | Implemented in response interceptor |
| Tool execution (tools/call) | Automatic via AuthorizeAction | Implemented in request interceptor |
| Requires token enrichment? | Yes — claims must be in the JWT | No — can read headers, query external sources |
| Input validation | Yes — `context.input.amount < 1000` | Yes — Lambda has access to the full request payload |
| Schema translation / PII redaction | No | Yes — interceptor can transform request/response |
| Multi-tenant isolation | Limited (claim-based only) | Full flexibility (can query tenant DB) |
| No code needed | Yes — declarative Cedar policies | No — requires Lambda code |

### Guidance

- **Use Cedar Policy when:** Access rules are based on user attributes (department, role) that don't change frequently, and simple, auditable, declarative policies are preferred without writing code.
- **Use Interceptors when:** Permissions are dynamic (stored in a DB), external services need to be called for authorization decisions, schema translation or PII redaction is needed, or the IdP doesn't support token enrichment.
- **Use both when:** Cedar handles the base rules (e.g., "only finance can access financial tools"), and interceptors handle edge cases (e.g., "but not during maintenance windows" or "only for specific tenants").

---

## 5. Using Cognito User Groups with Cedar Policy

For teams staying with Cognito who want to leverage native Cognito groups instead of hardcoded mappings.

### 5a. What Are Cognito User Groups?

Cognito User Groups are a built-in feature for organizing users into logical groups (e.g., finance, engineering, admin). They provide:
- A way to categorize users by role, department, or access level
- Automatic inclusion of group names in user authentication tokens (`cognito:groups` claim)
- IAM role association per group (for AWS resource access)

**How users get assigned to groups:**

| Method | When It Happens | Use Case |
|--------|-----------------|----------|
| AWS Console | Manual admin action | Ad-hoc group management |
| AdminAddUserToGroup API | Programmatic (e.g., in a Lambda) | Automated assignment during registration |
| Post-Confirmation Lambda Trigger | Automatically after user confirms email | Default group assignment for new users |
| Admin SDK / CLI | Batch operations | Bulk user management |

**Example: Auto-assign group on registration (Post-Confirmation Lambda):**

```python
import boto3

cognito = boto3.client('cognito-idp')

def lambda_handler(event, context):
    """Post-Confirmation trigger: assign new users to a default group."""
    user_pool_id = event['userPoolId']
    username = event['userName']
    
    # Assign to default group based on email domain or other logic
    email = event['request']['userAttributes'].get('email', '')
    
    if email.endswith('@finance.company.com'):
        group = 'finance'
    elif email.endswith('@eng.company.com'):
        group = 'engineering'
    else:
        group = 'general'
    
    cognito.admin_add_user_to_group(
        UserPoolId=user_pool_id,
        Username=username,
        GroupName=group
    )
    
    return event
```

### 5b. The Problem: Groups Aren't in M2M Tokens

The `cognito:groups` claim is automatically included in user authentication tokens (Authorization Code flow). However, it is NOT included in M2M tokens (Client Credentials flow).

Since the Gateway receives M2M tokens in the current architecture, Cedar Policy never sees the user's groups natively.

```
User Auth Token (has groups):     M2M Token (NO groups):
{                                 {
  "sub": "<user-sub-uuid>",                   "sub": "machine-client-id",
  "cognito:groups": [               "scope": "gateway/read gateway/write",
    "finance",                      "token_use": "access"
    "admin"                         // No user context!
  ]                               }
}
```

### 5c. The Solution: Pre-Token Lambda Reads Groups

The Pre-Token Lambda can call the Cognito `AdminListGroupsForUser` API to fetch the user's actual group memberships and inject them as custom claims in the M2M token.

This replaces the hardcoded demo mapping (UUID-to-group map) with real, dynamic group-based logic.

```python
import boto3
import os
import logging

logger = logging.getLogger()
cognito = boto3.client('cognito-idp')

USER_POOL_ID = os.environ.get('USER_POOL_ID')

def lambda_handler(event, context):
    """V3 Pre-Token Lambda: injects real Cognito group info into M2M token."""
    trigger_source = event.get("triggerSource", "")
    
    # Only process M2M (Client Credentials) flows
    if trigger_source != "TokenGeneration_ClientCredentials":
        return event
    
    # Get the verified user_id passed from the Runtime
    client_metadata = event.get("request", {}).get("clientMetadata", {})
    verified_user_id = client_metadata.get("verified_user_id", "")
    
    if not verified_user_id:
        logger.warning("No verified_user_id in clientMetadata")
        return event
    
    # --- REPLACES UUID-BASED USER_ROLE_MAP ---
    # Fetch user's ACTUAL Cognito groups.
    # Note: verified_user_id is the Cognito sub (UUID). AdminListGroupsForUser
    # requires the Cognito username (which is the email in FAST). Resolve the
    # UUID to username via ListUsers first, then call AdminListGroupsForUser.
    user_groups = get_user_groups(verified_user_id)
    
    # Determine department and role from groups
    department = resolve_department(user_groups)
    role = resolve_role(user_groups)
    
    # Inject into M2M access token
    event["response"]["claimsAndScopeOverrideDetails"] = {
        "accessTokenGeneration": {
            "claimsToAddOrOverride": {
                "user_id": verified_user_id,
                "department": department,
                "role": role,
                "user_groups": ",".join(user_groups),  # e.g., "finance,admin"
            }
        }
    }
    
    return event


def get_user_groups(user_id):
    """Fetch user's Cognito groups via Admin API.

    Note: AdminListGroupsForUser requires the Cognito username, not the sub.
    In FAST, the username is the user's email. The sub (UUID) must be resolved
    to the username via ListUsers before calling AdminListGroupsForUser.
    """
    try:
        # Resolve UUID to username (AdminListGroupsForUser requires username)
        users = cognito.list_users(
            UserPoolId=USER_POOL_ID,
            Filter=f'sub = "{user_id}"',
            Limit=1,
        )
        if not users.get("Users"):
            return []
        username = users["Users"][0]["Username"]

        response = cognito.admin_list_groups_for_user(
            UserPoolId=USER_POOL_ID,
            Username=username,
        )
        return [group['GroupName'] for group in response.get('Groups', [])]
    except Exception as e:
        logger.error("Failed to fetch groups for user %s: %s", user_id, str(e))
        return []


def resolve_department(groups):
    """Resolve department from group membership."""
    if 'finance' in groups:
        return 'finance'
    elif 'engineering' in groups:
        return 'engineering'
    return 'guest'


def resolve_role(groups):
    """Resolve role from group membership."""
    if 'admin' in groups:
        return 'admin'
    elif 'developer' in groups:
        return 'developer'
    return 'viewer'
```

### 5d. Cedar Policy Examples Using Groups

Once group information is injected as claims, Cedar can use them for access control:

**Option 1: Check department (resolved from groups)**

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"finance-target___generate_report",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("department") &&
  principal.getTag("department") == "finance"
};
```

**Option 2: Check role (resolved from groups)**

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"admin-target___delete_records",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("role") &&
  principal.getTag("role") == "admin"
};
```

**Option 3: Check raw group membership using `like`**

```cedar
// user_groups claim contains: "finance,admin,reporting"
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"finance-target___view_reports",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("user_groups") &&
  principal.getTag("user_groups") like "*finance*"
};
```

> **Caution with `like` on comma-separated groups:** The pattern `like "*finance*"` would also match a group named "refinance". For precise matching, use patterns like `like "finance,*"` or `like "*,finance,*"` or `like "*,finance"` — or better yet, pre-resolve to a boolean in the Lambda (see Option 4).

**Option 4: Pre-resolved boolean (Recommended for complex group logic)**

In the Pre-Token Lambda, resolve group membership to simple boolean claims:

```python
claims["is_finance_team"] = "true" if "finance" in user_groups else "false"
claims["is_admin"] = "true" if "admin" in user_groups else "false"
claims["can_delete"] = "true" if "admin" in user_groups and "finance" in user_groups else "false"
```

Then in Cedar:

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"admin-target___delete_records",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("is_admin") &&
  principal.getTag("is_admin") == "true"
};
```

This approach keeps complex group logic in the Lambda, while Cedar policies remain simple and readable.

---

## 6. Evolution Paths

A summary of the three paths from the current demo architecture:

```
Current Demo (Cognito + hardcoded user mapping in Pre-Token Lambda)
    │
    ├── Path 1: Keep Cognito, use real groups
    │   ├── Replace hardcoded mapping with AdminListGroupsForUser
    │   ├── Cedar Policy checks group-based claims
    │   └── See: Section 5
    │
    ├── Path 2: Swap IdP that supports token enrichment
    │   ├── Replace Cognito with Okta/Auth0/Entra
    │   ├── Use IdP's native token hook (replaces Pre-Token Lambda)
    │   ├── Cedar Policy remains unchanged
    │   └── See: Section 2
    │
    └── Path 3: Swap to any IdP + Gateway Interceptors
        ├── No token enrichment needed
        ├── Interceptors handle all access control dynamically
        ├── Works with ANY OIDC-compliant IdP
        └── See: Section 3
```

---

## 7. FAQ / Quick Reference

**Q1: Can any IdP be used with AgentCore Gateway?**

Yes. The Gateway's CUSTOM_JWT authorizer works with any OAuth 2.0 / OIDC-compliant identity provider. Only a valid OIDC discovery URL (`.well-known/openid-configuration`) is needed. The Gateway uses this to dynamically fetch public keys and validate tokens.

**Q2: What's the minimum change to swap IdPs?**

If the new IdP supports token enrichment:
1. Change the Gateway authorizer's discovery URL
2. Change the Runtime's token endpoint call
3. Replace the Pre-Token Lambda with the IdP's native token hook
4. Everything else (Cedar Policy, targets) stays the same

**Q3: Do interceptors replace Cedar Policy?**

They can, but they don't have to. Interceptors and Cedar Policy serve complementary purposes:
- **Cedar Policy** = static, declarative, no-code rules based on JWT claims
- **Interceptors** = dynamic, code-based logic that can query external sources

Either can be used alone, or both together for defense-in-depth.

**Q4: How to choose between Approach A and B?**

- **Choose Approach A** if the IdP supports token enrichment and access rules are relatively static (based on user attributes like department/role)
- **Choose Approach B** if the IdP doesn't support token enrichment, OR if dynamic permissions, schema translation, PII redaction, or multi-tenant isolation is needed

**Q5: Can both Cedar Policy and interceptors be used together?**

Yes. When both are active:
1. Gateway authorizer validates the token first
2. Cedar Policy Engine evaluates next (if configured)
3. Interceptors fire (request before target, response after target)

A request must pass ALL checks. This provides defense-in-depth.

**Q6: What about Cognito user groups — can Cedar use them?**

Not directly in M2M tokens. The `cognito:groups` claim only appears in user authentication tokens. For M2M flows, the Pre-Token Lambda must call `AdminListGroupsForUser` and inject group information as custom claims. See Section 5 for full details and code examples.

**Q7: Is passing user identity via custom header secure?**

Yes, because:
1. The Gateway authorizer validates the M2M token first (proving the caller is a legitimate Runtime)
2. The custom header (`X-User-Id`) is only readable by the interceptor Lambda (with `passRequestHeaders: true`)
3. The LLM do not have access to HTTP headers — they exist only in the transport layer

The security boundary is enforced at the Gateway level. If someone tries to call the Gateway directly (without a valid M2M token), the authorizer rejects them before the interceptor even fires.
