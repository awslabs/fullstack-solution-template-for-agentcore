# Cedar Policy Guide

This document covers how to write, manage, and extend Cedar policies for AgentCore Gateway. For the identity propagation architecture and component setup, see [Identity Propagation & Cedar Policy Guide](IDENTITY_POLICY.md).

## Understanding Claims (Custom vs. Standard)

Cedar policies reference JWT claims via `principal.getTag("claim_name")`. These claims come in two categories:

### Custom Claims (Application-Defined)

Custom claims are injected by the V3 Pre-Token Lambda via `claimsToAddOrOverride`. They are not part of the standard JWT/OIDC claim set — they are defined based on the application's access control needs.

**Claims in this demo:**

| Claim | Purpose | Example Value |
|-------|---------|---------------|
| `user_id` | Authenticated user's identity | `"<cognito-sub-uuid>"` |
| `department` | User's organizational unit | `"finance"` |
| `role` | User's permission level | `"admin"` |

**Additional custom claim examples:**

| Claim | Use Case | Cedar Usage |
|-------|----------|-------------|
| `tenant_id` | Multi-tenant isolation | `principal.getTag("tenant_id") == "example-corp"` |
| `clearance_level` | Tiered data access | `principal.getTag("clearance_level") == "top-level"` |
| `region` | Geo-restricted access | `principal.getTag("region") == "us-east-1"` |
| `runtime_env` | Runtime-level isolation | `principal.getTag("runtime_env") == "production"` |

To add a custom claim: inject it in the Pre-Token Lambda's `claimsToAddOrOverride` dict, then reference it in Cedar via `principal.getTag("claim_name")`. No Gateway configuration change is needed — the CUSTOM_JWT authorizer maps all JWT claims to Cedar tags automatically.

### Standard Claims (Cognito-Managed)

Standard claims are automatically included in every token by Cognito. They cannot be overridden by the Pre-Token Lambda.

| Claim | Description | Modifiable? |
|-------|-------------|-------------|
| `sub` | Subject identifier (app client ID for M2M) | No |
| `iss` | Token issuer (Cognito user pool URL) | No |
| `client_id` | The app client ID | No |
| `token_use` | Always `"access"` | No |
| `scope` | OAuth scopes granted | No |
| `exp` / `iat` / `jti` | Token timing and ID | No |

Standard claims are also accessible via `principal.getTag()` in Cedar but are typically used for infrastructure-level checks rather than business logic.

### What's NOT Available as a Claim

| Data | Why Not Available | Alternative |
|------|-------------------|-------------|
| Request headers / IP | Not exposed to Cedar | N/A (not supported) |
| Runtime ARN | Not in Cedar schema | Inject `runtime_env` via Pre-Token Lambda (see [Runtime-Level Access Control](IDENTITY_POLICY.md#runtime-level-access-control)) |
| Tool input parameters | Not a claim | Use `context.input.<field>` in Cedar |

## Policy File Location

`gateway/policies/policy.cedar` — edit this file and run `cdk deploy` to apply changes. The Custom Resource Lambda detects the change and updates the policy in-place without recreating the Policy Engine.

## Action Name Format

Cedar action names follow the format: `<TargetName>___<tool_name>` (triple underscore).

- **TargetName** comes from the `CfnGatewayTarget` name in `backend-stack.ts` (e.g., `sample-tool-target`)
- **tool_name** comes from `tool_spec.json` (e.g., `text_analysis_tool`)
- Combined: `sample-tool-target___text_analysis_tool`

These are case-sensitive. A mismatch silently denies all requests even when the policy logic looks correct.

## Deny-by-Default

Cedar is deny-by-default: if no `permit` statement matches a request, it is automatically denied. An explicit `forbid` statement is not needed to block access — simply omit the department from the permit's conditions.

For example, to deny guests, remove `"guest"` from the department list. No `forbid` statement is required.

## Tool Discovery vs Execution

The AgentCore Policy Engine enforces authorization at **two points** in the tool lifecycle:

### 1. Discovery (`tools/list`) — Tool Filtering

When the Runtime calls `tools/list` on the Gateway, the Policy Engine evaluates **every tool** against the caller's identity using `PartiallyAuthorizeActions`. Tools that the caller is not permitted to use are **removed from the response**. The agent never sees them.

```
Agent → Runtime → Gateway tools/list → Policy Engine (PartiallyAuthorizeActions)
                                         ↓
                                    Evaluates each tool against principal's claims
                                         ↓
                                    Returns ONLY permitted tools
                                         ↓
                              Agent receives filtered tool list
```

**Effect:** If a user with `department=guest` calls `tools/list` while Version 2 (guest denied) is active, the `text_analysis_tool` will NOT appear in the response. The agent has no knowledge the tool exists and will not attempt to call it.

### 2. Execution (`tools/call`) — Full Context Enforcement

When the agent calls a specific tool, the Policy Engine evaluates the request with **full context** — including the tool's input parameters (`context.input`). This is a stricter evaluation than discovery because it has access to the actual request payload.

```
Agent → Runtime → Gateway tools/call → Policy Engine (AuthorizeAction)
                                         ↓
                                    Evaluates principal claims + context.input
                                         ↓
                                    Allow → execute tool
                                    Deny  → return authorization error
```

**Why both?** A tool might pass discovery filtering (the user is generally allowed to use it) but fail at execution time due to input-specific conditions. For example:

```cedar
// User can discover the refund tool (passes tools/list filtering)
// But execution is denied if amount > 1000 (fails tools/call check)
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"billing-target___process_refund",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("department") &&
  principal.getTag("department") == "finance" &&
  context.input.amount < 1000
};
```

In this example, a finance user would see `process_refund` in `tools/list` (they're in the finance department), but if they try to process a refund of $5000, the `tools/call` would be denied because `context.input.amount < 1000` fails.

### Verifying Discovery Filtering in CloudWatch

To confirm that denied tools are being filtered from `tools/list`:

1. Enable tracing on both the Runtime and Gateway (see [Verifying Policy Decisions via Tracing](IDENTITY_POLICY.md#verifying-policy-decisions-via-tracing))
2. Trigger a query from the frontend
3. In CloudWatch → `aws/spans` log group, filter for `PartiallyAuthorizeActions`
4. The span contains:
   - `aws.agentcore.policy.allowed_tools`: tools returned to the agent
   - `aws.agentcore.policy.denied_tools`: tools filtered out
   - `aws.agentcore.gateway.policy.mode`: should show `ENFORCE`

> **Verifying at the Runtime level:** Add a log line in the agent code to confirm which tools the agent received after Cedar policy filtering. Examples for the two primary agent patterns:
>
> **Strands pattern** (`patterns/strands-single-agent/basic_agent.py`) — add after `Agent()` creation:
> ```python
> agent = Agent(
>     name="strands_agent",
>     tools=[gateway_client, code_tools.execute_python_securely],
>     ...
> )
> specs = agent.tool_registry.get_all_tool_specs()
> logger.info(f"[GATEWAY] Raw tool specs: {specs}")
> return agent
> ```
> **Where to find:** CloudWatch → Log groups → `/aws/bedrock-agentcore/runtimes/{runtime_name}` → log stream `otel-rt-logs`. Search for `[GATEWAY] Raw tool specs`.
>
> **LangGraph pattern** (`patterns/langgraph-single-agent/langgraph_agent.py`) — add after `mcp_client.get_tools()`:
> ```python
> mcp_client = await create_gateway_mcp_client(user_id)
> tools = await mcp_client.get_tools()
> logger.info(f"[GATEWAY] Tools loaded: {[t.name for t in tools]}")
> ```
> **Where to find:** CloudWatch → Log groups → `/aws/bedrock-agentcore/runtimes/{runtime_name}` → log stream `otel-rt-logs`. Search for `[GATEWAY] Tools loaded`.

### Summary

| Stage | API | Evaluation | What Happens on Deny |
|-------|-----|-----------|---------------------|
| Discovery (`tools/list`) | `PartiallyAuthorizeActions` | Principal claims only (no input context) | Tool is hidden — agent never sees it |
| Execution (`tools/call`) | `AuthorizeAction` | Principal claims + `context.input` | Request rejected — agent gets authorization error |

## Adding New Tools

When adding a new Gateway target and tool:

1. Create the new Lambda tool and `CfnGatewayTarget` in `backend-stack.ts`
2. Add a new `permit` statement to `policy.cedar` with the correct action name
3. Run `cdk deploy`

Each `create_policy` call creates one policy containing one Cedar statement. The Custom Resource currently creates a single policy per deploy. To add multiple policies (e.g., separate permit and forbid statements), update the Custom Resource Lambda to call `create_policy()` once per statement.

## Cedar Schema Constraints

AgentCore Gateway validates Cedar policies against an auto-generated schema derived from the Gateway's MCP tool manifest. Policies that reference unsupported fields will fail during creation, causing CloudFormation rollback.

**Supported in Cedar policies:**

| Element | What Can Be Referenced | Example |
|---------|----------------------|--------|
| `principal` | Must be `AgentCore::OAuthUser` | `principal is AgentCore::OAuthUser` |
| `principal.hasTag()` / `principal.getTag()` | Any JWT claim mapped by the CUSTOM_JWT authorizer | `principal.getTag("department")` |
| `action` | Tool actions in `<TargetName>___<tool_name>` format | `AgentCore::Action::"sample-tool-target___text_analysis_tool"` |
| `resource` | The Gateway ARN | `AgentCore::Gateway::"arn:aws:..."` |
| `context.input` | Tool input parameters as defined in the MCP manifest | `context.input.query` |

**NOT supported in Cedar policies:**

| Element | Why |
|---------|-----|
| `context.runtime.arn` | Not in the schema — only `context.input` is available |
| Custom entity types | Cannot define entities outside the `AgentCore` namespace |
| Custom attributes on `OAuthUser` | Use `hasTag()`/`getTag()` instead of direct property access |
| Request metadata (headers, IP, etc.) | Not exposed to Cedar |

If access control decisions depend on information not available in `context.input`, inject it as a JWT claim via the Pre-Token Lambda and access it via `principal.getTag()`. See [Runtime-Level Access Control](IDENTITY_POLICY.md#runtime-level-access-control) for an example of this pattern.

## Cedar Policy Capabilities

Cedar is a purpose-built policy language designed for authorization. This section documents what can be expressed in Cedar policies for AgentCore Gateway, with practical examples for each capability.

> **Already demonstrated in this project:**
> - Identity-based access (`principal.getTag("department") == "finance"`) — see [Cedar Policy File](IDENTITY_POLICY.md#cedar-policy-file) Version 1 & 2
> - Multi-value OR conditions (`department == "finance" || department == "engineering"`) — see Version 1 policy
>
> The capabilities below show **additional patterns** that can be implemented using the same infrastructure.

### Capability 1: Input Validation (`context.input`)

**Scenario:** Finance users can process refunds, but only up to $1000. Refunds above $1000 require a different approval workflow.

**How it works:** `context.input` gives Cedar access to the tool's input parameters (as defined in the MCP tool manifest). Conditions can be written against these values. The tool still appears in `tools/list` for finance users (discovery only checks principal claims), but the $1000 limit is enforced at `tools/call` time when the actual input is available.

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"billing-target___process_refund",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("department") &&
  principal.getTag("department") == "finance" &&
  context.input.amount < 1000
};
```

**Result:**
- Finance user, amount=500 → permitted
- Finance user, amount=5000 → denied (exceeds limit)
- Engineering user, amount=100 → denied (wrong department)

**Important:** This is where [Tool Discovery vs Execution](#tool-discovery-vs-execution) matters most. The tool passes discovery filtering (finance user is generally permitted), but execution is denied when the input violates the condition.

---

### Capability 2: Multi-Tool Policies (`action in [...]`)

**Scenario:** Developers can use all read-only tools (list, get, search) but cannot use write tools (create, update, delete).

**How it works:** Use `action in [...]` to apply one policy to multiple tools at once, instead of writing separate `permit` statements for each tool.

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action in [
    AgentCore::Action::"data-target___list_records",
    AgentCore::Action::"data-target___get_record",
    AgentCore::Action::"data-target___search_records"
  ],
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("role") &&
  principal.getTag("role") == "developer"
};
```

**Result:**
- Developer calls `list_records` → permitted
- Developer calls `search_records` → permitted
- Developer calls `delete_record` → denied (not in the action list)

> **Note:** Separate `permit` statements can also be written for each tool. The `action in [...]` syntax is a convenience for grouping related tools under the same conditions.

---

### Capability 3: Explicit Deny (`forbid`)

**Scenario:** All departments are allowed to use a tool, EXCEPT a specific user (e.g., a compromised account) needs to be explicitly blocked regardless of their department.

**How it works:** `forbid` statements override `permit` statements. Cedar's conflict resolution is "forbid wins" — if both a `permit` and `forbid` match, the request is denied.

```cedar
// Allow all departments
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"sample-tool-target___text_analysis_tool",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("department")
};

// But explicitly block a specific user (by their Cognito sub UUID)
forbid(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"sample-tool-target___text_analysis_tool",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("user_id") &&
  principal.getTag("user_id") == "<compromised-user-sub-uuid>"
};
```

**Result:**
- Any user with a department → permitted
- The user matching `<compromised-user-sub-uuid>` → denied (forbid wins over permit)

> **Note:** Cedar's deny-by-default means simply omitting a user/department from the `permit`
> is often sufficient to deny access. Use `forbid` when overriding a broad `permit`
> for specific cases — such as blocking a compromised user, disabling a tool during an incident,
> or implementing an emergency shutdown.

---

### Capability 4: Wildcard String Matching (`like`)

**Scenario:** Only users with an internal email domain can access internal tools. This requires injecting an `email` claim via the Pre-Token Lambda (not included in the default demo, but straightforward to add).

**How it works:** Use `like` with `*` wildcard for pattern matching on string claim values.

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"internal-target___internal_tool",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("email") &&
  principal.getTag("email") like "*@example.com"
};
```

**Result:**
- User with `email` claim `alice@example.com` → permitted
- User with `email` claim `bob@example.com` → permitted
- User with `email` claim `contractor@external.com` → denied (doesn't match pattern)

> **Note:** This example uses a custom `email` claim (injected by the Pre-Token Lambda via `claimsToAddOrOverride`). The default `user_id` claim is a UUID and would not match email patterns. The `like` operator only supports `*` as a wildcard, which matches zero or more characters of any kind (letters, numbers, symbols, dots, etc.). It does not support regex, single-character wildcards, character classes, or other pattern syntax.

---

### Capability 5: Environment-Based Access Control

**Scenario:** Production tools should only be accessible from the production runtime. Staging runtimes should not be able to call production tools even if the user has the right department/role.

**How it works:** The Pre-Token Lambda maps the Cognito `clientId` to a `runtime_env` claim (see [Runtime-Level Access Control](IDENTITY_POLICY.md#runtime-level-access-control)). Cedar checks both user identity AND runtime environment.

```cedar
permit(
  principal is AgentCore::OAuthUser,
  action == AgentCore::Action::"prod-target___production_tool",
  resource == AgentCore::Gateway::"{{GATEWAY_ARN}}"
)
when {
  principal.hasTag("runtime_env") &&
  principal.getTag("runtime_env") == "production" &&
  principal.hasTag("department") &&
  principal.getTag("department") == "finance"
};
```

**Result:**
- Finance user from production runtime → permitted
- Finance user from staging runtime → denied (wrong environment)
- Engineering user from production runtime → denied (wrong department)

---

### Quick Reference: Cedar Operators

| Operator | Meaning | Example |
|----------|---------|--------|
| `==` | Equals | `principal.getTag("role") == "admin"` |
| `!=` | Not equals | `principal.getTag("department") != "restricted"` |
| `&&` | AND (both must be true) | `condition_a && condition_b` |
| `\|\|` | OR (either can be true) | `value == "a" \|\| value == "b"` |
| `<`, `>`, `<=`, `>=` | Numeric comparison | `context.input.amount < 1000` |
| `in [...]` | Action is one of a set | `action in [Action::"a", Action::"b"]` |
| `like` | Wildcard string match | `principal.getTag("email") like "*@example.com"` |
| `hasTag()` | Claim exists in token | `principal.hasTag("department")` |
| `getTag()` | Get claim value | `principal.getTag("department")` |
| `has` | Field/attribute exists | `context.input has shippingAddress` |
| `.contains()` | Set membership | `["US", "CA", "MX"].contains(context.input.country)` |

### What Cedar CANNOT Do

| Limitation | Workaround |
|-----------|------------|
| Regular expressions | Use `like` with `*` wildcard for simple patterns |
| Arithmetic operations (e.g., `a + b > c`) | Pre-compute in the Pre-Token Lambda and inject as a claim |
| External data lookups (e.g., query a database) | Resolve in the Pre-Token Lambda and inject as a claim |
| Time-based rules (e.g., "only during business hours") | Inject a `time_window` claim from the Pre-Token Lambda |
| Array/list membership (e.g., "user in allowed_list") | Use `.contains()` for hardcoded lists: `["a", "b"].contains(context.input.x)`. For dynamic lists (loaded from a database), resolve in the Pre-Token Lambda and inject as a boolean claim |
| Request headers, IP address, or network context | Not exposed to Cedar — not available |

> **Architecture Pattern:** When Cedar cannot evaluate something directly (time,
> external data, complex logic), resolve it in the Pre-Token Lambda and inject the
> result as a custom claim. Cedar then checks the pre-resolved value. This keeps
> policies simple, deterministic, and auditable.
