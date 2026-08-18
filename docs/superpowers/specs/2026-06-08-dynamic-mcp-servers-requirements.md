# Dynamic MCP Servers in FAST — Requirements

## 1. Problem

FAST agents today only connect to the built-in AgentCore Gateway. Users cannot bring additional MCP servers (third-party hosted MCPs, local tools, internal services) into a chat without code changes and a redeploy. We need a way to register MCP servers once and let end-users pick which ones to use per conversation.

## 2. Goal

Allow a developer to declare a catalog of MCP servers once at deploy time, and let each authenticated end-user enable or disable individual servers from the chat UI. The agent must connect only to the servers the calling user has enabled.

## 3. Future scope (not in this phase)

- Adding, editing, or removing MCP server entries directly from the UI.
- Support for agent patterns beyond the default (LangGraph, Claude SDK, AG-UI variants).
- MCP servers that require an interactive OAuth consent flow per end-user.
- Per-tool (sub-server) enable/disable; phase 1 toggles at server granularity only.

## 4. Users & use cases

| User | Needs |
|---|---|
| Delivery scientist (deploys FAST) | Declare a catalog of MCP servers covering the supported transport types and reference any secrets safely. Deploy once; update by changing config and redeploying. |
| End-user (chats in the app) | Open a settings panel from the chat UI, see all available servers with descriptions, toggle each on/off, save. Toggle state persists across sessions and devices. |
| Agent | On each conversation, use only the MCP servers the calling user has enabled, alongside any built-in tools. |

## 5. Functional requirements

1. **Server catalog** — A deploy-time catalog defines each available MCP server with at minimum: a stable id, a human-readable name, a description, transport type, connection details, optional authentication reference, and an optional default-enabled flag.
2. **Per-user preferences** — Each authenticated user has their own enabled-servers list, persisted across sessions and devices. New users start from the catalog's default-enabled set.
3. **Preferences API** — The chat UI can read the current user's enabled list and the catalog metadata needed to render it, and can save updates. All access is authenticated as the calling user.
4. **Runtime behaviour** — When the agent processes a user message, it uses only the MCP servers the calling user has currently enabled. Servers no longer in the catalog are silently ignored.
5. **Tool exposure** — Tools from enabled MCP servers are available to the agent alongside built-in tools (Gateway, Code Interpreter). Tool name collisions across servers must not break the agent.
6. **Settings UI** — A clearly discoverable entry point in the chat experience opens a settings view listing every catalog server with: name, description, transport indicator, and an on/off toggle. Saving updates takes effect on the user's next message.

## 6. Non-functional requirements

- **Security:** The catalog is authoritative on the server side; the frontend cannot point the agent at arbitrary MCP servers. User identity is always taken from the validated auth token, never from the request body. Secrets are never returned to the frontend or written to logs.
- **Performance:** Resolving the user's enabled list adds negligible latency to a chat turn (target p50 added latency < 50 ms).
- **Reliability:** A failing MCP server (timeout, auth error, unreachable) is logged and skipped; the agent continues to respond using remaining tools rather than failing the request.
- **Cost:** Phase 1 additions should be small and on-demand: one per-user preferences store, one preferences API, and on-demand secret lookups only when an authenticated server is enabled.
- **Compatibility:** Existing built-in tooling (Gateway, Code Interpreter) continues to work unchanged and is not gated by these toggles.

## 7. Success criteria

- A developer adds a new MCP server entry to the catalog and redeploys; the new server appears in every user's settings view, honouring its default-enabled flag.
- A user toggles a server off; the next agent response no longer lists or invokes that server's tools.
- A user's toggle state survives logout and is the same after logging in on a different device.
- Disabling a misbehaving server (via catalog change or user toggle) restores normal chat without requiring an emergency redeploy.

## 8. Risks & open questions

| Risk | Mitigation |
|---|---|
| Some transport types may need extra packaging in the agent runtime to work | Document supported transports clearly; phase 1 prioritises remote (HTTP-based) servers. |
| Tool name collisions across multiple enabled servers | Namespace tools per server so the agent disambiguates safely. |
| Catalog drift vs. user preferences (server removed while still in a user's enabled list) | Treat the catalog as the source of truth at request time; stale entries are ignored. |
| Multiple enabled servers increase total connection setup time | Establish connections in parallel; skip and continue on per-server failure. |

## 9. Phased rollout

- **Phase 1 (this requirement):** Deploy-time catalog, per-user enable/disable from the chat UI, persisted preferences, default agent pattern only.
- **Phase 2:** Add/edit/remove servers from the UI, per-tool toggles, additional agent patterns, OAuth-flow MCP servers.
