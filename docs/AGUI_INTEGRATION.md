# AG-UI Protocol Integration

Guide for using the AG-UI (Agent-User Interaction) protocol patterns in FAST.

---

## Overview

[AG-UI](https://docs.ag-ui.com/concepts/overview) is an open protocol that defines a standard SSE event format for agent-to-frontend communication. Instead of each framework emitting its own event schema (Strands events, LangChain message chunks, etc.), AG-UI provides a unified event vocabulary: `TEXT_MESSAGE_CONTENT`, `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_RESULT`, `RUN_FINISHED`, and so on.

FAST includes two AG-UI agent patterns:

| Pattern | Framework | Location |
|---------|-----------|----------|
| `agui-strands-agent` | Strands + `ag-ui-strands` | `agent_patterns/agui-strands-agent/` |
| `agui-langgraph-agent` | LangGraph + `copilotkit` | `agent_patterns/agui-langgraph-agent/` |

Both patterns use `BedrockAgentCoreApp` as the entrypoint (same as the HTTP patterns), which means AgentCore Runtime headers (WorkloadAccessToken, Authorization, Session-Id) are available for Gateway auth, Memory, and secure user identity extraction.

---

## How It Works

### Architecture

```
Frontend (Amplify)
  │
  │  POST /invocations  (AG-UI RunAgentInput payload)
  ▼
AgentCore Runtime
  │
  │  Proxies request to container port 8080
  │  Injects: WorkloadAccessToken, Authorization, Session-Id headers
  ▼
Agent Container
  │
  │  BedrockAgentCoreApp reads headers → sets ContextVars
  │  @entrypoint handler creates agent, runs it
  ▼
AG-UI Wrapper (StrandsAgent / LangGraphAGUIAgent)
  │
  │  Translates framework events → AG-UI SSE events
  ▼
Frontend Parser (parsers/agui.ts)
  │
  │  Maps AG-UI events → StreamEvent types
  ▼
ChatInterface.tsx renders messages
```

### Request Flow

1. The frontend sends an AG-UI `RunAgentInput` payload (with `threadId`, `messages`, `runId`)
2. AgentCore Runtime proxies the request, injecting auth headers
3. `BedrockAgentCoreApp` reads headers and populates `BedrockAgentCoreContext` (ContextVars)
4. The `@entrypoint` handler extracts user identity from the JWT, creates the agent with Memory and Gateway tools
5. The AG-UI wrapper translates framework streaming events into AG-UI SSE events
6. The frontend `parseAguiChunk` parser maps AG-UI events to the shared `StreamEvent` types

### AG-UI vs HTTP Protocol on AgentCore Runtime

AgentCore Runtime supports both `HTTP` and `AGUI` server protocols. The difference is minimal: with `AGUI`, platform-level errors are returned as AG-UI-compliant `RUN_ERROR` events in the SSE stream (HTTP 200) instead of HTTP error codes. Everything else — auth, session headers, payload passthrough — is identical.

The AG-UI patterns in FAST deploy with `HTTP` protocol, which works correctly because the agent container handles AG-UI event formatting internally.

---

## Agent Patterns

### AG-UI Strands (`agui-strands-agent`)

**Location**: `agent_patterns/agui-strands-agent/`

Uses `ag-ui-strands` (`StrandsAgent`) to wrap a Strands `Agent`. The agent is created per-request inside the `@entrypoint` handler, ensuring each request gets a fresh `Agent` with the correct `session_manager` and fresh MCP client connections.

**Includes**: AgentCore Memory, Gateway MCP tools, Code Interpreter, AG-UI SSE streaming.

### AG-UI LangGraph (`agui-langgraph-agent`)

**Location**: `agent_patterns/agui-langgraph-agent/`

Uses the `copilotkit` python library (`LangGraphAGUIAgent`) to wrap a LangGraph compiled graph. Uses `ActorAwareLangGraphAgent`, a subclass that rebuilds the graph per-request to ensure fresh Gateway MCP tool connections with valid tokens.

**Includes**: AgentCore Memory (checkpointer), Gateway MCP tools, Code Interpreter, CopilotKit middleware, AG-UI SSE streaming.

---

## Frontend

### Parser Auto-Selection

The AG-UI parser is automatically selected based on the pattern name prefix. Any pattern starting with `agui-` uses the AG-UI parser (`parsers/agui.ts`). Unlike the HTTP patterns — which each require a framework-specific parser (Strands, LangGraph, Claude) to handle their different streaming formats — all AG-UI patterns share a single parser. This is one of the key benefits of the AG-UI protocol: the backend framework is abstracted away behind a standard event vocabulary, so the frontend doesn't need to know whether the agent uses Strands or LangGraph.

See `frontend/src/lib/agentcore-client/client.ts` for the parser selection logic and `infra-cdk/config.yaml` comments for the full prefix-to-parser mapping.

### AG-UI Payload Format

The frontend automatically sends the correct payload format based on the pattern prefix. AG-UI patterns receive a `RunAgentInput` payload (with `threadId`, `messages`, `runId`), while HTTP patterns receive the standard `{ prompt, runtimeSessionId }` format. This is handled by `AgentCoreClient.invoke()`.

---

## Deployment

Set the pattern in `infra-cdk/config.yaml`:

```yaml
backend:
  pattern: agui-strands-agent    # or agui-langgraph-agent
  deployment_type: docker
```

No CDK changes are required. The AG-UI patterns deploy as standard HTTP containers on AgentCore Runtime.

---

## CopilotKit Integration

[CopilotKit](https://www.copilotkit.ai/) is a React UI library that natively understands the AG-UI protocol. While FAST's built-in frontend includes a lightweight AG-UI parser for basic chat streaming, CopilotKit provides a richer set of capabilities for building agent-powered applications. Fullstack FAST applications with deeper CopilotKit integration can be found in the FAST samples repository (coming soon).

---

## Additional Resources

- [AG-UI Protocol Documentation](https://docs.ag-ui.com/concepts/overview)
- [ag-ui-strands on PyPI](https://pypi.org/project/ag-ui-strands/)
- [CopilotKit Documentation](https://docs.copilotkit.ai/)
- [Strands AG-UI Integration Guide](https://strandsagents.com/docs/community/integrations/ag-ui/)
