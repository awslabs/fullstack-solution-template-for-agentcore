# Gateway Interceptors

AgentCore Gateway **interceptors** let you run custom Lambda code during each gateway
invocation, so you can inspect, authorize, transform, or short-circuit a request before it
reaches a target, and inspect or rewrite the response before it returns to the caller.

This guide explains the interceptor capability itself: the two interceptor types, the
input/output contract, and the use cases they support, with examples that use FAST's own
Gateway tool (`sample-tool-target` / `text_analysis_tool`). It is capability and design
documentation. FAST ships Cedar-based access control today (see
[Identity Propagation & Cedar Policy](IDENTITY_POLICY.md) and the
[Cedar Policy Guide](CEDAR_POLICY_GUIDE.md)); interceptors are a complementary, code-based
option you can adopt when you need dynamic, runtime logic. For how interceptors fit the
"replace Cognito / bring another IdP" story, see [Replacing Cognito](REPLACING_COGNITO.md).

---

## 1. What an interceptor is

An interceptor is a Lambda function the gateway invokes around a tool call. As described in
the official AWS documentation (see [References](#references)), there are two types:

- **REQUEST interceptor** — runs **before** the gateway calls the target. Use it for request
  validation, custom authorization, or request transformation (including injecting
  server-derived context into the tool arguments).
- **RESPONSE interceptor** — runs **after** the target responds but **before** the gateway
  returns to the caller. Use it for response filtering, redaction, or adding fields.

A gateway can have **at most one REQUEST interceptor and at most one RESPONSE interceptor**.
You can configure both on the same gateway, but not two of the same type.

> The interceptor runs in the HTTP/transport layer, not in the model. The LLM only ever sees
> tool schemas and tool results; it never sees the interceptor event, tokens, or headers.

---

## 2. The interceptor contract

The interceptor Lambda receives a JSON event and must return a JSON response in the shape
the gateway expects. The payload shape depends on the **target type**: MCP targets (such as
the Lambda tools FAST ships) use the `mcp` payload; HTTP targets (such as an AgentCore
Runtime or an inference target) use an `http` payload whose body is base64-encoded. The
examples below use the `mcp` payload and follow the official interceptor payload spec (see
[References](#references)); they are trimmed to the fields this guide discusses.

### 2a. Input payload

```json
{
  "interceptorInputVersion": "1.0",
  "mcp": {
    "rawGatewayRequest": { "body": "<raw_request_body>" },
    "gatewayRequest": {
      "path": "/mcp",
      "httpMethod": "POST",
      "headers": {
        "Authorization": "<bearer_token>",
        "Mcp-Session-Id": "<session_id>"
      },
      "body": { "jsonrpc": "2.0", "id": 1, "method": "tools/list" }
    }
  }
}
```

A RESPONSE interceptor additionally receives a `gatewayResponse` field (the target's
response). The presence of `gatewayResponse` is how a single Lambda can tell which type it is
serving.

> **`headers` are opt-in.** The `headers` field is only present when `passRequestHeaders` is
> set to `true` in the interceptor configuration. Headers can carry credentials, so this is
> off by default. See [Configuration](#5-configuration-cdk).

### 2b. Output payload

```json
{
  "interceptorOutputVersion": "1.0",
  "mcp": {
    "transformedGatewayRequest":  { "body": { "...": "..." } },
    "transformedGatewayResponse": { "statusCode": 200, "body": { "...": "..." } }
  }
}
```

- `interceptorOutputVersion` must be `"1.0"`.
- Return **`transformedGatewayRequest`** to forward a (possibly modified) request to the
  target.
- Return **`transformedGatewayResponse`** to respond to the caller **immediately without
  calling the target**. If both are present, the response wins (the target is skipped).

### 2c. Two operational rules

- **Idempotency.** The gateway may retry an interceptor on failure or timeout. Write the
  Lambda so a duplicate invocation with the same input produces the same result (no
  non-idempotent side effects).
- **Least privilege.** Scope the gateway execution role to invoke only the specific
  interceptor Lambda(s), not a wildcard, and do not log the `Authorization` header or other
  sensitive headers.

---

## 3. Two types, three use cases

Per the official AWS documentation (see [References](#references)), interceptors serve three
purposes: **fine-grained access control**, **request/response transformation**, and **custom
authorization logic**. The sections below map each onto FAST, using the shipped tool
(`sample-tool-target___text_analysis_tool`). Access control and transformation each use
**both** interceptor types where it makes sense.

### 3a. Use case 1 — Fine-grained access control

Decide, per call, whether the user may invoke a tool (REQUEST), and which tools the user may
even see (RESPONSE).

**REQUEST — authorize `tools/call`.** The interceptor reads the caller's identity (see
[Section 4](#4-how-the-interceptor-learns-who-the-caller-is) for how identity reaches the
interceptor), looks up what the user may do, and either forwards the call or stops it.

There are two ways to stop a call, and the choice matters:

#### Hard deny — stop the target from running

Return a `transformedGatewayResponse`. The gateway replies with it and **never calls the
target**.

```python
def lambda_handler(event, context):
    """REQUEST interceptor: hard-deny an unauthorized tools/call."""
    mcp = event["mcp"]
    body = mcp["gatewayRequest"]["body"]
    request_id = body.get("id")

    user_id = _user_id_from(mcp)                      # see Section 4
    tool_name = body.get("params", {}).get("name", "")  # e.g. "sample-tool-target___text_analysis_tool"

    if not _is_authorized(user_id, tool_name):
        # Presence of transformedGatewayResponse short-circuits: the target never runs.
        return {
            "interceptorOutputVersion": "1.0",
            "mcp": {
                "transformedGatewayResponse": {
                    "statusCode": 403,
                    "body": {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "result": {"error": f"Not authorized for {tool_name}"},
                    },
                }
            },
        }

    # Authorized: forward unchanged.
    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {"transformedGatewayRequest": {"body": body}},
    }
```

#### Soft deny — let the target run, but neutralize the scope

Return a `transformedGatewayRequest` in which the server-owned arguments are emptied, and let
the target fail closed on an empty scope. This keeps a single code path (every call goes to
the target) and makes the target the final gate. It is the right choice when the target
already treats "no scope" as "return nothing."

```python
def lambda_handler(event, context):
    """REQUEST interceptor: soft-deny by stripping the server-owned scope."""
    mcp = event["mcp"]
    body = mcp["gatewayRequest"]["body"]

    user_id = _user_id_from(mcp)
    params = body.get("params", {})
    arguments = params.get("arguments", {})

    # The interceptor owns this argument; a caller value is always overwritten.
    arguments["allowed_actions"] = _allowed_actions(user_id)  # [] when unauthorized
    params["arguments"] = arguments
    body["params"] = params

    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {"transformedGatewayRequest": {"body": body}},
    }
```

> **Why the distinction matters.** `transformedGatewayRequest` is always *forwarded to the
> target*. Returning an error object under `transformedGatewayRequest` does **not** block the
> target — the gateway still calls it, now with a malformed body. To actually stop the
> target, you must return `transformedGatewayResponse`. Choose hard deny to block at the
> gateway; choose soft deny to let a fail-closed target enforce the boundary.

**RESPONSE — filter `tools/list`.** A RESPONSE interceptor removes tools the user may not use
from the discovery list, so the agent never sees (and cannot try) a tool it is not allowed to
call. The target returns all tools; the interceptor returns the filtered subset.

```python
def lambda_handler(event, context):
    """RESPONSE interceptor: filter the tools/list result for the caller."""
    mcp = event["mcp"]
    response = mcp["gatewayResponse"]
    user_id = _user_id_from(mcp)                       # from gatewayRequest.headers

    tools = response.get("body", {}).get("result", {}).get("tools", [])
    allowed = set(_allowed_actions(user_id))
    # FAST tool names are "<target>___<tool>", e.g. "sample-tool-target___text_analysis_tool".
    filtered = [t for t in tools if t["name"] in allowed]

    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {
            "transformedGatewayResponse": {
                "statusCode": response.get("statusCode", 200),
                "body": {"jsonrpc": "2.0", "id": response["body"].get("id"),
                         "result": {"tools": filtered}},
            }
        },
    }
```

> Cedar Policy already filters `tools/list` automatically (denied tools are hidden at
> discovery) and authorizes `tools/call`. Reach for an interceptor here only when the
> decision needs logic Cedar cannot express declaratively. See
> [Section 6](#6-interceptors-vs-cedar-vs-the-pre-token-lambda).

### 3b. Use case 2 — Request and response transformation

Interceptors can rewrite the request before the target sees it and the response before the
caller sees it, independent of any allow/deny decision.

**REQUEST transformation** — normalize or enrich tool arguments. For example, clamp the
`text_analysis_tool`'s `N` argument to a safe maximum so a caller cannot request an unbounded
result:

```python
def lambda_handler(event, context):
    """REQUEST interceptor: clamp an argument before the target runs."""
    mcp = event["mcp"]
    body = mcp["gatewayRequest"]["body"]
    params = body.get("params", {})
    arguments = params.get("arguments", {})

    if "N" in arguments:
        arguments["N"] = min(int(arguments["N"]), 20)   # enforce a ceiling
    params["arguments"] = arguments
    body["params"] = params

    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {"transformedGatewayRequest": {"body": body}},
    }
```

**RESPONSE transformation** — redact or add to the result. For example, scrub a pattern from
the tool's text output before it returns to the agent:

```python
import re

def lambda_handler(event, context):
    """RESPONSE interceptor: redact a pattern from the tool result."""
    mcp = event["mcp"]
    response = mcp["gatewayResponse"]
    result = response.get("body", {}).get("result", {})

    for item in result.get("content", []):
        if item.get("type") == "text":
            item["text"] = re.sub(r"\b\d{16}\b", "[REDACTED]", item["text"])

    return {
        "interceptorOutputVersion": "1.0",
        "mcp": {
            "transformedGatewayResponse": {
                "statusCode": response.get("statusCode", 200),
                "body": response["body"],
            }
        },
    }
```

### 3c. Use case 3 — Custom authorization: resolve and inject

This is the pattern that makes interceptors a true alternative to enriching the token at
issuance. Instead of baking the user's attributes into the M2M token (what FAST's Pre-Token
Lambda does today, see [Section 6](#6-interceptors-vs-cedar-vs-the-pre-token-lambda)), the
**REQUEST interceptor resolves the user's attributes at call time and injects them into the
tool arguments**. The target then trusts only the injected value, never a caller-supplied
one.

```python
import boto3, os

ddb = boto3.resource("dynamodb")
table = ddb.Table(os.environ["PERMISSIONS_TABLE"])

def lambda_handler(event, context):
    """REQUEST interceptor: resolve the caller's scope at request time and inject it."""
    mcp = event["mcp"]
    body = mcp["gatewayRequest"]["body"]

    if body.get("method") != "tools/call":
        return {"interceptorOutputVersion": "1.0",
                "mcp": {"transformedGatewayRequest": {"body": body}}}

    user_id = _user_id_from(mcp)

    # Dynamic lookup — nothing was baked into the token. Fail closed on miss.
    item = table.get_item(Key={"pk": f"USER#{user_id}", "sk": "PERMS"}).get("Item", {}) if user_id else {}
    allowed_actions = item.get("allowed_actions", [])

    params = body.get("params", {})
    arguments = params.get("arguments", {})
    arguments["allowed_actions"] = allowed_actions   # server-owned; overwrite any caller value
    params["arguments"] = arguments
    body["params"] = params

    return {"interceptorOutputVersion": "1.0",
            "mcp": {"transformedGatewayRequest": {"body": body}}}
```

Why resolve-and-inject at the interceptor can be preferable to token enrichment:

- **Nothing stale in the token.** Permissions are read at the moment of the call, so a change
  takes effect immediately, with no re-issued token and nothing cached in a claim.
- **Smaller, simpler token.** The M2M token carries only machine trust and the user's
  identifier (so the interceptor knows whom to look up); the user's resolved attributes and
  fine-grained scope never have to be serialized into it.
- **Any source.** The lookup can hit DynamoDB, a directory, or an external API, not just what
  the IdP can put in a claim.

The injected argument (here `allowed_actions`) is **server-owned**: the interceptor always
overwrites whatever the agent supplied, so the model cannot widen its own scope.

---

## 4. How the interceptor learns who the caller is

An interceptor can only enforce on an identity it can trust. There are a few ways the caller
identity reaches the gateway (and therefore the interceptor). The gateway's inbound authorizer
validates a JWT on every request; what differs is **which** token that is and **where the
user identity rides**.

| Model | Gateway authorizer validates | User identity carried by | Notes |
|---|---|---|---|
| **M2M token + claim** | the machine (M2M) token | a `user_id` claim injected into the token at issuance | FAST's shipped shape: the Pre-Token Lambda injects the claim; identity is inside the signed token. |
| **M2M token + header** | the machine (M2M) token | a custom header (requires `passRequestHeaders`) | Identity rides outside the signed token, so trust rests on the gateway boundary, not the token signature. |
| **On-behalf-of (OBO) token** | the OBO token | the token's own `sub` (user), with the agent as `act` | AgentCore Identity exchanges the inbound user token for a scoped downstream token. |
| **User-token passthrough** | the user's own token | the token's own `sub` | The runtime forwards the user JWT; the authorizer points at the user IdP. |

In the **M2M + claim** model (FAST's shipped shape), the Pre-Token Lambda places `user_id` in
the M2M token's claims, and the interceptor reads it by decoding the validated `Authorization`
bearer token. In the **M2M + header** model, set `passRequestHeaders: true` and read the
identity from the request header instead. In the **OBO** and **passthrough** models, the
verified user is the token `sub` itself. In every case the identity the interceptor keys on
must come from the verified token (or a header only a trusted runtime can set), never from a
model-supplied argument.

A minimal reader for FAST's **M2M + claim** shape, decoding `user_id` from the bearer token
(the gateway authorizer has already verified its signature):

```python
import base64, json

def _user_id_from(mcp: dict) -> str:
    headers = mcp.get("gatewayRequest", {}).get("headers", {}) or {}
    token = headers.get("Authorization", "").removeprefix("Bearer ")
    parts = token.split(".")
    if len(parts) != 3:
        return ""
    payload = parts[1] + "=" * (-len(parts[1]) % 4)   # pad base64url
    claims = json.loads(base64.urlsafe_b64decode(payload))
    return claims.get("user_id", "")
```

A minimal reader for the **M2M + header** shape (`passRequestHeaders: true` required):

```python
def _user_id_from_header(mcp: dict) -> str:
    headers = mcp.get("gatewayRequest", {}).get("headers", {}) or {}
    return headers.get("X-User-Id", "")
```

> For the full comparison of these identity models in the context of swapping IdPs, see
> [Replacing Cognito](REPLACING_COGNITO.md).

---

## 5. Configuration (CDK)

Attach interceptors in the same `agentcore.Gateway` constructor FAST already uses for the
authorizer (`infra-cdk/lib/backend-construct.ts`), via the `interceptorConfigurations`
property. `passRequestHeaders` must be `true` for an interceptor to receive request headers.

```typescript
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";

const gateway = new agentcore.Gateway(this, "AgentCoreGateway", {
  gatewayName: `${config.stack_name_base}-gateway`,
  role: gatewayRole,
  authorizerConfiguration: agentcore.GatewayAuthorizer.usingCustomJwt({
    discoveryUrl: cognitoDiscoveryUrl,
    allowedClients: [machineClient.userPoolClientId],
  }),
  interceptorConfigurations: [
    agentcore.LambdaInterceptor.forRequest(requestInterceptorLambda, {
      passRequestHeaders: true,  // required to read request headers in the interceptor
    }),
    agentcore.LambdaInterceptor.forResponse(responseInterceptorLambda, {
      passRequestHeaders: true,
    }),
  ],
});
```

> Verify the construct and property names against the `aws-cdk-lib` version pinned in this
> repo before use; the AgentCore CDK surface is still evolving.

Grant the gateway role permission to invoke only these specific Lambdas, and keep the
interceptor Lambdas idempotent (Section 2c).

---

## 6. Interceptors vs. Cedar vs. the Pre-Token Lambda

FAST ships three building blocks that touch user context at the gateway. They are
complementary; this section is a decision aid, not a re-explanation (see the linked docs).

| | Pre-Token Lambda | Cedar Policy | Gateway interceptor |
|---|---|---|---|
| Where it runs | Cognito, at token issuance | Gateway policy engine | Lambda, per gateway call |
| What it does | injects user claims into the M2M token | allow/deny + `tools/list` filtering from claims | any custom logic: authorize, transform, resolve-and-inject |
| Static or dynamic | static per token lifetime | static rules (redeploy to change) | fully dynamic at request time |
| Needs token enrichment | — (it *is* the enrichment) | yes — reads claims as principal tags | no — can read headers or query any source |
| Code required | yes (small) | no (declarative) | yes (Lambda) |

What FAST does today: the **Pre-Token Lambda** injects `user_id` / `department` / `role` into
the M2M token from a hardcoded `USER_ROLE_MAP` (UUID → group; default `guest/viewer`), and
**Cedar** authorizes `sample-tool-target___text_analysis_tool` from those claims. The grouping
is resolved once, at token issuance, and is not read by the tool itself. See
[Identity Propagation & Cedar Policy](IDENTITY_POLICY.md) and the
[Cedar Policy Guide](CEDAR_POLICY_GUIDE.md).

When an interceptor is the better fit:

- **Dynamic permissions.** The Pre-Token Lambda's mapping is resolved at issuance; its own
  comments note the hardcoded map can be replaced with a DynamoDB lookup. An interceptor does
  that lookup **per request**, so changes take effect immediately and the user's resolved
  permissions are not baked into the token (only the user identifier is). See Section 3c.
- **Logic Cedar cannot express.** External calls, time windows, per-tenant data, or request
  argument transformation (Section 3b).
- **An IdP that cannot enrich tokens.** Carry identity in a header and resolve in the
  interceptor instead. See [Replacing Cognito](REPLACING_COGNITO.md).

You can also combine them: Cedar for the static baseline, an interceptor for the dynamic
edge cases. When both are configured, the gateway authorizer validates the token, Cedar
evaluates, and the interceptors run (REQUEST before the target, RESPONSE after).

---

## References

The interceptor contract (payload shapes, output rules, configuration) in this guide follows
the official AWS documentation, which is the source of truth:

- [Using interceptors with Gateway](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-interceptors.html)
- [Types of interceptors](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-interceptors-types.html) — REQUEST/RESPONSE input and output payloads
- [Interceptor configuration](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-interceptors-configuration.html) — `passRequestHeaders` and related settings
- [Interceptor examples](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-interceptors-examples.html)

## Related documentation

- [Gateway](GATEWAY.md) — AgentCore Gateway integration in FAST.
- [Identity Propagation & Cedar Policy](IDENTITY_POLICY.md) — the shipped access-control path.
- [Cedar Policy Guide](CEDAR_POLICY_GUIDE.md) — Cedar syntax and reference.
- [Replacing Cognito](REPLACING_COGNITO.md) — swapping IdPs and carrying identity to the gateway.
- [Runtime-Gateway Authentication](RUNTIME_GATEWAY_AUTH.md) — the M2M token flow.
