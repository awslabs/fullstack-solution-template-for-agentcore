# AgentCore Browser Integration

This document explains the architectural decisions for integrating Amazon Bedrock AgentCore Browser into FAST.

## What is AgentCore Browser?

Amazon Bedrock AgentCore Browser provides a secure, isolated cloud browser environment for AI agents to interact with web applications. Key features:

- Isolated Chromium browser sessions in containerized environments
- CDP (Chrome DevTools Protocol) access for automation
- Real-time live view streaming via DCV protocol
- Session persistence (cookies, login state, tabs carry over across tool calls)
- Web Bot Auth support for reducing CAPTCHAs

**Documentation**: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-tool.html

## Architecture

```
User prompt
  → Agent (Strands / LangGraph / Claude SDK)
    → browser tool (async generator)
      → AgentCore Browser session (CDP)
        → browser-use Agent (autonomous browsing)
          → on_step_start hook → asyncio.Queue → yield → tool_stream_event SSE
          → on_step_end hook   → asyncio.Queue → yield → tool_stream_event SSE
      → Live View URL → DCV WebSocket → BrowserLiveView component (direct to client)
    → tool result → agent continues reasoning
  → Final text response to user
```

The DCV live view stream flows **directly** from AgentCore to the user's browser — it does not pass through the application server.

## Why Direct Integration (Not Gateway)?

Same rationale as Code Interpreter — FAST integrates Browser **directly into agents** rather than through the Gateway:

- **Session management** — Browser sessions persist across tool calls (cookies, login state, tabs)
- **Streaming** — Tool stream events (live view URL, browser actions) require async generator yields
- **Lower latency** — No Gateway/Lambda hops for CDP commands
- **Follows AWS patterns** — Matches official SDK documentation and sample apps

## Browser Automation: browser-use Library

The browser tool uses the [browser-use](https://github.com/browser-use/browser-use) library for autonomous browser control. Instead of scripting individual clicks and navigations, you describe the task in natural language and the LLM-driven agent figures out the UI interactions.

### Why browser-use?

- **Autonomous** — LLM decides what to click, type, scroll without manual scripting
- **Resilient** — Handles UI changes (CSS class renames, layout shifts) by reading the DOM semantically
- **Multi-step** — Handles complex workflows in a single tool call
- **Session reuse** — Agent memory, page context, and action history persist between calls

### Lifecycle Hooks for Streaming

browser-use provides `on_step_start` and `on_step_end` hooks that fire before and after each agent step. FAST uses these hooks with `asyncio.Queue` to stream actions to the frontend in real-time:

```python
step_queue: asyncio.Queue = asyncio.Queue()

async def on_step_end_hook(agent):
    # Extract completed action from agent history
    actions = agent.history.action_names()
    urls = agent.history.urls()
    extracted = agent.history.extracted_content()
    # Put into queue for immediate yield
    await step_queue.put({"type": "browser_action", "extracted_content": summary})

# Run agent with hooks in background task
agent_task = asyncio.create_task(
    agent.run(on_step_start=on_step_start_hook, on_step_end=on_step_end_hook)
)

# Yield from queue as events arrive
while not agent_task.done():
    step = await asyncio.wait_for(step_queue.get(), timeout=0.5)
    yield step
```

## Frontend: Live View Component

The frontend uses the official `bedrock-agentcore` npm package for the DCV live view:

```tsx
import { BrowserLiveView } from 'bedrock-agentcore/browser/live-view'

<BrowserLiveView
  signedUrl={presignedUrl}
  remoteWidth={1380}
  remoteHeight={720}
/>
```

### Vite Configuration

The `BrowserLiveView` component requires DCV SDK aliases in your Vite config:

- `resolve.alias` — Points `dcv` and `dcv-ui` to vendored SDK files
- `resolve.dedupe` — Forces shared deps (React, Cloudscape) to resolve from your `node_modules`
- `viteStaticCopy` — Copies DCV runtime files (workers, WASM decoders) to build output

See `frontend/vite.config.ts` for the complete configuration.

### Custom Tool Renderer

`BrowserToolDisplay` is registered as a custom renderer for the `"browser"` tool name:

```tsx
useToolRenderer("browser", props => <BrowserToolDisplay {...props} />)
```

This keeps browser-specific UI (live view, action streaming, result parsing) decoupled from the generic tool display system. Other tools continue using the default `ToolCallDisplay`.

### Streaming Reliability

Two key fixes ensure streaming actions appear in real-time:

1. **`flushSync`** — Forces React to render immediately on each `tool_stream` event instead of batching
2. **Parser priority** — `tool_stream_event` is checked before text `data` in the strands parser to prevent action content from leaking as chat text

## Available Patterns

| Pattern | Description | Status |
|---------|-------------|--------|
| `strands-browseruse-multiagent` | Strands + browser-use + Code Interpreter + Gateway tools | ✅ Available |
| `strands-browser-single-agent` | Strands + browser tool only | 🔜 Planned |
| `langgraph-browser-agent` | LangGraph + browser tool | 🔜 Planned |
| `claude-browser-agent` | Claude Agent SDK + browser tool | 🔜 Planned |

## Configuration

In `infra-cdk/config.yaml`:

```yaml
backend:
  pattern: strands-browseruse-multiagent
  deployment_type: docker
```

The browser tool requires Docker deployment (`deployment_type: docker`), not zip.

## References

- [AgentCore Browser documentation](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/browser-tool.html)
- [BrowserLiveView blog post](https://aws.amazon.com/blogs/machine-learning/embed-a-live-ai-browser-agent-in-your-react-app-with-amazon-bedrock-agentcore/)
- [browser-use library](https://github.com/browser-use/browser-use)
- [browser-use hooks documentation](https://docs.browser-use.com/customize/hooks)
- [Bedrock AgentCore TypeScript SDK](https://github.com/aws/bedrock-agentcore-sdk-typescript)
