# Dynamic MCP Servers

Connect additional MCP servers to your FAST agent through the AgentCore Gateway. Users can enable or disable individual servers from the chat UI without redeploying.

## Overview

FAST supports registering external MCP servers (streamable-HTTP endpoints) alongside the built-in Lambda tool target. The feature has three parts:

1. **Deploy-time catalog** — declared in `config.yaml` (CDK) or `terraform.tfvars` (Terraform).
2. **Per-user preferences** — each user toggles servers on/off from a settings dialog; state persists across sessions and devices in DynamoDB.
3. **Runtime filtering** — the agent loads only tools from servers the calling user has enabled.

## Quick Start

Add entries to `infra-cdk/config.yaml`:

```yaml
backend:
  mcp_servers:
    - id: aws-knowledge
      name: AWS Knowledge
      description: Up-to-date AWS docs, API references, and blog content.
      endpoint: https://knowledge-mcp.global.api.aws

    - id: my-internal-mcp
      name: Internal Tools
      endpoint: https://tools.internal.example.com/mcp
      default_enabled: false
      auth:
        type: OAUTH
        client_id: my-client-id
        client_secret_secret_arn: arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-AbCdEf
        discovery_url: https://auth.example.com/.well-known/openid-configuration
        scopes:
          - mcp/invoke
```

Deploy with `cdk deploy`. The new servers appear in every user's settings view.

## Configuration Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `id` | Yes | — | Stable identifier (alphanumeric + hyphens). Used in resource names. |
| `name` | Yes | — | Human-readable label shown in the settings UI. |
| `description` | No | `""` | Shown below the server name in the settings dialog. |
| `endpoint` | Yes | — | HTTPS URL of the streamable-HTTP MCP server. |
| `enabled` | No | `true` | Set `false` to keep the entry in config without deploying it. |
| `default_enabled` | No | `true` | Initial on/off state for users who haven't set preferences yet. |
| `auth.type` | No | `"NONE"` | `NONE` (public) or `OAUTH` (client-credentials M2M). |

### OAUTH fields (required when `auth.type: OAUTH`)

| Field | Description |
|-------|-------------|
| `client_id` | OAuth2 client ID (plaintext). Mutually exclusive with `client_id_secret_arn`. |
| `client_id_secret_arn` | Secrets Manager ARN holding the client ID. Mutually exclusive with `client_id`. |
| `client_secret_secret_arn` | Secrets Manager ARN holding the client secret. Never embedded in templates. |
| `discovery_url` | OIDC discovery URL of the authorization server. |
| `scopes` | List of OAuth2 scopes to request (optional, defaults to `[]`). |

## Supported Transport Types

| Type | Supported | Notes |
|------|-----------|-------|
| Streamable HTTP (`https://`) | Yes | Phase 1 only supports this. |
| stdio (`command` + `args`) | No | Rejected at validation time. AgentCore Gateway speaks HTTP MCP only. |

## Auth Types

| Type | Description |
|------|-------------|
| `NONE` | Public, unauthenticated MCP endpoint. No credential configuration on the gateway target. |
| `OAUTH` | OAuth2 Client Credentials (M2M) via AgentCore Token Vault. Uses native `AWS::BedrockAgentCore::OAuth2CredentialProvider`. |
| `IAM_SIGV4` | Not supported on MCP-server targets (Gateway limitation). |
| `API_KEY` | Not supported on MCP-server targets (Gateway limitation). |

## Architecture

```
┌───────────┐     ┌──────────────┐     ┌─────────────────┐
│  Frontend │────▶│  API Gateway │────▶│ mcp-prefs Lambda │──▶ DynamoDB
│  (Dialog) │     │ GET/PUT      │     │ (per-user prefs) │    (mcp-prefs table)
└───────────┘     └──────────────┘     └─────────────────┘

┌───────────┐     ┌──────────────────┐     ┌───────────────────┐
│   Agent   │────▶│ AgentCore Gateway│────▶│ MCP Server Target │
│  Runtime  │     │ (tools/list)     │     │ (streamable HTTP) │
└───────────┘     └──────────────────┘     └───────────────────┘
      │
      ▼
  mcp_prefs.py
  (filter tools by user's enabled list from DynamoDB)
```

## How Per-User Filtering Works

1. On each request, the agent runtime reads the user's enabled-server list from DynamoDB (`MCP_PREFS_TABLE`).
2. Users with no saved preferences get the catalog's `default_enabled` set.
3. A Strands `tool_filters` callback rejects tools whose names contain the target marker (`mcp-{disabled_id}___`).
4. Fail-open: if DynamoDB is unreachable, catalog defaults are used and the agent keeps responding.
5. Built-in tools (sample Lambda target, Code Interpreter) are never filtered.

## Settings UI

After logging in, click the gear icon in the chat header. The dialog shows each catalog server with:

- Name and description
- On/off checkbox
- Save button (changes apply on the user's next message)

Empty state: "No additional MCP servers are configured for this deployment" when `backend.mcp_servers` is empty or absent.

## Terraform

The equivalent Terraform configuration uses a variable:

```hcl
mcp_servers = [
  {
    id          = "aws-knowledge"
    name        = "AWS Knowledge"
    description = "Up-to-date AWS docs, API references, and blog content."
    endpoint    = "https://knowledge-mcp.global.api.aws"
  },
  {
    id              = "my-oauth-mcp"
    name            = "My OAuth MCP"
    endpoint        = "https://secure-mcp.example.com/mcp"
    default_enabled = false
    auth = {
      type                     = "OAUTH"
      client_id                = "my-client-id"
      client_secret_secret_arn = "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret"
      discovery_url            = "https://auth.example.com/.well-known/openid-configuration"
      scopes                   = ["mcp/invoke"]
    }
  },
]
```

## Cedar Policy Considerations

The default Cedar policy permits all gateway tools for authenticated users. Per-user MCP server enable/disable is enforced at the agent runtime layer (tool filtering), not at the Cedar policy layer. This is intentional: MCP-server tool names are only known after gateway target sync, so they cannot be enumerated in Cedar at deploy time.

If you need to restrict specific MCP tools by user department or role, you can add targeted Cedar `forbid` statements after deploying and observing the tool names (format: `mcp-{id}___{tool_name}`).

## Tool Name Format

Gateway tools follow the naming convention: `{target_name}___{tool_name}` (triple underscore).

With the Strands `MCPClient` prefix `"gateway"`, the full tool name visible to the agent is:
```
gateway_{target_name}___{tool_name}
```

Example: `gateway_mcp-aws-knowledge___aws___search_documentation`

Target names are kept short (`mcp-{id}`) to stay within Bedrock's 64-character tool-name limit.

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Server not in settings | `enabled: false` in config | Set `enabled: true` or remove the field |
| Gateway target stuck in CREATING | Endpoint unreachable or returns errors | Verify endpoint responds to MCP `initialize` |
| Tool name too long (>64 chars) | Server exposes tools with long names | Use a shorter `id` in config, or ask the MCP server maintainer to shorten tool names |
| OAUTH target fails | Invalid credentials or discovery URL | Check Secrets Manager values and that the discovery URL returns valid OIDC metadata |
| User toggle not taking effect | Agent uses cached tool list | Effect is per-message; send a new message after saving |
