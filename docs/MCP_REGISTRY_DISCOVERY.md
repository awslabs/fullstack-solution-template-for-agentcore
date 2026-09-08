# MCP Server Discovery from AWS Agent Registry

Discover MCP servers from an [AWS Agent Registry](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/registry.html)
at agent runtime and **auto-connect** to them, so the registry's approved MCP
records become live, callable tools on your FAST agent — with **no
DynamoDB, no UI, and no per-user preferences**. This is a deliberately
lightweight feature: enable it, point it at a registry, and the agent does the
rest on each request.

## How it differs from Dynamic MCP Servers

FAST has two, independent ways to add external MCP servers. Pick whichever fits;
they do not depend on each other.

| | **MCP Registry Discovery** (this doc) | **[Dynamic MCP Servers](MCP_SERVERS.md)** |
|---|---|---|
| Source of servers | An AWS Agent Registry, queried at **runtime** | A catalog you declare at **deploy time** in `config.yaml` / `tfvars` |
| How servers connect | Direct Strands `MCPClient`s on the agent | AgentCore **Gateway targets** |
| Per-user on/off | No (agent-wide) | Yes (DynamoDB-backed preferences + settings UI) |
| Extra infrastructure | One IAM statement + two env vars | DynamoDB table, `mcp-prefs` Lambda, API routes, frontend dialog |
| Best for | "Let the agent use whatever the org has published" | "Curated, per-user-toggleable set of servers" |

## Overview

When enabled, on each request the agent:

1. Lists the registry's **Approved** `recordType == "MCP"` records
   (`list_discoverable_registry_records`, paginated).
2. Fetches their full descriptors in one batch call
   (`batch_get_discoverable_registry_record`) and reads each server's
   streamable-HTTP endpoint from `mcpServer.remotes[0].url`.
3. Builds a live Strands `MCPClient` for each **public streamable-HTTP** server
   and adds it to the agent's tools, alongside the Gateway client and Code
   Interpreter.

```
                         ┌──────────────────────────┐
   Agent Runtime  ──────▶│  AWS Agent Registry       │  list_discoverable_registry_records
 (basic_agent.py)        │  (agent-registry API)     │  batch_get_discoverable_registry_record
        │                └──────────────────────────┘
        │  build_registry_mcp_clients()  → remotes[0].url
        ▼
  ┌───────────────┐   streamable HTTP   ┌───────────────────┐
  │  Strands      │────────────────────▶│ Discovered MCP     │
  │  MCPClient(s) │                     │ Server (public)    │
  └───────────────┘                     └───────────────────┘
```

## Quick Start

### CDK (`infra-cdk/config.yaml`)

```yaml
backend:
  mcp_registry:
    enabled: true
    registry_id: arn:aws:agent-registry:us-east-1:123456789012:registry/my-registry
```

Deploy with `cdk deploy`.

### Terraform (`terraform.tfvars`)

```hcl
mcp_registry = {
  enabled     = true
  registry_id = "arn:aws:agent-registry:us-east-1:123456789012:registry/my-registry"
}
```

Deploy with `terraform apply`.

## Configuration Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `enabled` | No | `false` | Master switch. When false the feature is completely inert (no IAM, no env, no runtime calls). |
| `registry_id` | When enabled | `""` | ARN or id of the AWS Agent Registry. A full ARN scopes the IAM grant to that registry; a bare id falls back to the account/region `registry/*` wildcard. |

Validation is **fail-loud**: enabling the feature without a `registry_id` fails
at synth/plan time (CDK `config-manager` and the Terraform variable validation).

## Environment Variables (set by the infrastructure)

| Variable | Description |
|----------|-------------|
| `MCP_REGISTRY_DISCOVERY_ENABLED` | `"true"` activates discovery in the agent runtime. |
| `MCP_REGISTRY_ID` | ARN or id of the registry to discover from. |
| `AWS_REGION` / `AWS_DEFAULT_REGION` | Region of the registry (already set for the runtime). |

## IAM

When enabled, the agent runtime execution role gets two read-only statements.
**The IAM action names differ from the API names**: the `BatchGetDiscoverableRegistryRecord`
API is authorized by the permission-only action `agent-registry:GetDiscoverableRegistryRecord`
on the **record** resource, while `List`/`Search` authorize on the **registry** resource.

```json
[
  {
    "Sid": "AgentRegistryDiscoveryList",
    "Effect": "Allow",
    "Action": [
      "agent-registry:ListDiscoverableRegistryRecords",
      "agent-registry:SearchDiscoverableRegistryRecords"
    ],
    "Resource": "arn:aws:agent-registry:<region>:<account>:registry/<registryId>"
  },
  {
    "Sid": "AgentRegistryDiscoveryGetRecord",
    "Effect": "Allow",
    "Action": "agent-registry:GetDiscoverableRegistryRecord",
    "Resource": "arn:aws:agent-registry:<region>:<account>:registry/<registryId>/record/*"
  }
]
```

> Common pitfall: granting `agent-registry:BatchGetDiscoverableRegistryRecord`
> (matching the API name) is a **no-op** — that is not a real IAM action, so
> record reads fail with `AccessDenied`. Use `GetDiscoverableRegistryRecord`.

## Namespace note

The data-plane discovery APIs (`ListDiscoverableRegistryRecords`,
`BatchGetDiscoverableRegistryRecord`) live under the **`agent-registry`**
namespace. The public-preview **`bedrock-agentcore`** namespace does **not**
expose these APIs and is scheduled for discontinuation on **2026-09-17**. This
feature uses `boto3.client("agent-registry")` accordingly. If you created your
registry under the old namespace, migrate it first — see the
[registry migration guide](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/registry-faq.html).

## Behavior & Limits

- **Only Approved records** are returned by the discovery APIs; Draft /
  Pending / Rejected / Deprecated records are never connected.
- **v1 connects public `streamable-http` servers only.** Records using another
  transport, or requiring authentication, are logged and skipped. Per-server
  OAuth is a documented follow-up (the [Dynamic MCP Servers](MCP_SERVERS.md)
  Gateway path already supports OAUTH M2M today if you need auth now).
- **Fail-loud on misconfiguration**: enabled + no `registry_id` raises at
  synth/plan time.
- **Fail-soft at runtime**: if the registry is unreachable, access is denied, or
  an individual record is malformed, that server is skipped with a logged
  warning and the agent keeps responding on its remaining tools.
- **Per-request discovery**: the tool list reflects the registry's current
  approved records on each new agent invocation.

## Tool Naming

Each discovered server is connected with a Strands client prefix derived from
its record name: `registry_<slug>`, where `<slug>` is the lowercased name with
non-alphanumeric runs collapsed to underscores. Its tools therefore appear to
the agent as `registry_<slug>_<tool_name>`.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| No discovered tools appear | Feature disabled, or registry has no Approved MCP records | Set `enabled: true` + `registry_id`; approve records in the registry |
| Synth/plan fails on `registry_id` | `enabled` true but `registry_id` empty | Provide the registry ARN/id |
| A known server isn't connected | Non-HTTP transport, auth-required, or missing `remotes[0].url` | Check the record's descriptor; v1 connects public streamable-HTTP only |
| `AccessDeniedException` in logs | Role lacks discovery permissions or registry not readable | Confirm the `AgentRegistryDiscoveryAccess` statement covers the registry |
| APIs return `ValidationException` for the namespace | Registry created under deprecated `bedrock-agentcore` namespace | Migrate the registry to `agent-registry` |

## Files

- `patterns/strands-single-agent/tools/mcp_registry.py` — discovery + client builder
- `patterns/strands-single-agent/basic_agent.py` — wires discovered clients into the agent
- `infra-cdk/lib/utils/config-manager.ts`, `infra-cdk/lib/backend-construct.ts`, `infra-cdk/config.yaml` — CDK config, IAM, env
- `infra-terraform/modules/backend/{variables,runtime}.tf`, `infra-terraform/{variables,main}.tf`, `terraform.tfvars.example` — Terraform parity
