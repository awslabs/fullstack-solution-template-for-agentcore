# Streaming Guide for Agents

## Overview

Your agent sends streaming events in SSE format. This guide explains how to integrate streaming with frontend.

## Integration Steps

1. **Your agent sends streaming events** (SSE format)
2. **The `agentcore-client` library** reads the SSE stream and routes it to the appropriate parser:
   - For **Strands agents (default)**: `frontend/src/lib/agentcore-client/parsers/strands.ts` — parses Strands schema events
   - For **LangGraph agents**: `frontend/src/lib/agentcore-client/parsers/langgraph.ts`
   - For **Bedrock Converse (generic)**: `frontend/src/lib/agentcore-client/parsers/converse.ts` — parses raw Bedrock Converse stream events
   - For **other agent frameworks**: Create a new parser and register it in `frontend/src/lib/agentcore-client/client.ts`
3. **Parsers emit typed `StreamEvent`s** (text, tool_use_start, tool_use_delta, tool_result, message, result, lifecycle)
4. **`ChatInterface.tsx`** handles events and builds message segments (interleaved text + tool calls)
5. **`ChatMessage.tsx`** renders segments inline with markdown formatting and tool call components

---

## Current Implementation

### Backend: Strands Agent

**File:** `patterns/strands-single-agent/basic_agent.py`

The backend yields all raw Strands streaming events, serialized to JSON-safe dicts:

```python
async for event in agent.stream_async(user_query):
    yield json.loads(json.dumps(dict(event), default=str))
```

**Note:** Strands events can contain non-JSON-serializable Python objects (agent instances, UUIDs, `ModelStopReason` tuples, etc.). The `json.dumps(default=str)` call converts these to strings, ensuring all events are safe to send over SSE.

### Frontend: Event Parser

**File:** `frontend/src/lib/agentcore-client/parsers/strands.ts`

The default parser for `strands-single-agent` handles Strands schema events:

```typescript
export const parseStrandsChunk: ChunkParser = (line, callback) => {
  if (!line.startsWith("data: ")) return;
  const json = JSON.parse(line.substring(6).trim());

  // Text token: {"data": "Hello"}
  if (typeof json.data === "string") {
    callback({ type: "text", content: json.data });
  }

  // Tool use: {"current_tool_use": {...}, "delta": {"toolUse": {"input": "..."}}}
  if (json.current_tool_use) {
    // First delta (empty input) → tool_use_start
    // Subsequent deltas → tool_use_delta
  }

  // Tool result: {"message": {"role": "user", "content": [{"toolResult": {...}}]}}
  if (json.message?.role === "user") {
    // Extract toolResult blocks → callback({ type: "tool_result", ... })
  }

  // Completion: {"result": {"stop_reason": "end_turn"}}
  if (json.result) {
    callback({ type: "result", stopReason: "end_turn" });
  }

  // Lifecycle: {"init_event_loop": true}
  if (json.init_event_loop || json.start_event_loop) { ... }
};
```

See the full implementation in the source file for edge cases.

### Event Structure

Strands provides these event types:

- `data`: Text chunks (accumulate as they arrive)
- `current_tool_use`: Tool name, ID, and input parameters (with `delta` for streaming)
- `message`: Final structured message with full content (assistant with `toolUse`, user with `toolResult`)
- `result`: AgentResult with stop reason and metrics
- `init_event_loop`, `start_event_loop`, `complete`: Lifecycle markers
- `tool_stream_event`: Events streamed from tool execution
- `event`: Raw Bedrock Converse events (used by the alternative converse parser below)

```javascript
// Text streaming
data: {"data": "Hello"}
data: {"data": " there"}

// Tool use start — first delta has empty input
data: {"current_tool_use": {"toolUseId": "tool_abc123", "name": "text_analysis"}, "delta": {"toolUse": {"input": ""}}}

// Tool input streaming
data: {"current_tool_use": {"toolUseId": "tool_abc123", "name": "text_analysis"}, "delta": {"toolUse": {"input": "{\"text\": \"hello\"}"}}}

// Complete assistant message
data: {"message": {"role": "assistant", "content": [{"toolUse": {"toolUseId": "tool_abc123", "name": "text_analysis", "input": {"text": "hello"}}}]}}

// Tool result (user message with toolResult blocks)
data: {"message": {"role": "user", "content": [{"toolResult": {"toolUseId": "tool_abc123", "content": [{"text": "Analysis complete: 1 word"}]}}]}}

// Final result
data: {"result": {"stop_reason": "end_turn"}}

// Lifecycle events
data: {"init_event_loop": true}
data: {"start_event_loop": true}
```

**Reference:** [Strands Streaming Documentation](https://strandsagents.com/latest/documentation/docs/user-guide/concepts/streaming/overview/)

---

## Alternative: Using Raw Converse Events

Instead of parsing Strands schema events, you can parse the raw Bedrock Converse events nested under the `event` key. This gives you lower-level access to the Converse stream API structures.

**Note:** Tool results are not emitted as Converse stream events — they are an input to the next `converse_stream` call. Strands handles this internally and emits tool results as `message` events. The converse parser does not handle tool results; instead, `ChatInterface.tsx` marks tools as complete when the next text segment starts streaming.

### Frontend Parser

**File:** `frontend/src/lib/agentcore-client/parsers/converse.ts`

To use this parser instead of the default strands parser, update `client.ts`:

```typescript
import { parseConverseChunk } from "./parsers/converse";

const PARSERS: Record<AgentPattern, ChunkParser> = {
  "strands-single-agent": parseConverseChunk,  // Switch to Converse parser
  ...
};
```

The parser handles raw Bedrock Converse events:

```typescript
export const parseConverseChunk: ChunkParser = (line, callback) => {
  if (!line.startsWith("data: ")) return;
  const json = JSON.parse(line.substring(6).trim());

  const event = json.event;
  if (event) {
    // Text streaming
    if (event.contentBlockDelta?.delta?.text) {
      callback({ type: "text", content: event.contentBlockDelta.delta.text });
    }

    // Tool use start
    if (event.contentBlockStart?.start?.toolUse) {
      const toolUse = event.contentBlockStart.start.toolUse;
      callback({ type: "tool_use_start", toolUseId: toolUse.toolUseId, name: toolUse.name });
    }

    // Tool use input streaming
    if (event.contentBlockDelta?.delta?.toolUse?.input) {
      callback({ type: "tool_use_delta", toolUseId: currentToolUseId, input: ... });
    }

    // Message stop
    if (event.messageStop?.stopReason) {
      callback({ type: "result", stopReason: event.messageStop.stopReason });
    }
  }
};
```

See the full implementation in the source file for edge cases.

### Event Structure

Converse events are nested under the `event` key:

```javascript
// Message lifecycle
data: {"event": {"messageStart": {"role": "assistant"}}}

// Text streaming
data: {"event": {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": "Hello"}}}}
data: {"event": {"contentBlockDelta": {"contentBlockIndex": 0, "delta": {"text": " there"}}}}

// Tool use start
data: {"event": {"contentBlockStart": {"contentBlockIndex": 1, "start": {"toolUse": {"toolUseId": "tool_abc123", "name": "text_analysis"}}}}}

// Tool use input streaming
data: {"event": {"contentBlockDelta": {"contentBlockIndex": 1, "delta": {"toolUse": {"input": "{\"text\": \"hello\"}"}}}}}

// Content block and message completion
data: {"event": {"contentBlockStop": {"contentBlockIndex": 0}}}
data: {"event": {"messageStop": {"stopReason": "end_turn"}}}

// Metadata
data: {"event": {"metadata": {"usage": {"inputTokens": 88, "outputTokens": 30}}}}
```

**Reference:** [Bedrock Converse Stream API](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/bedrock-runtime/client/converse_stream.html)

---

## LangGraph/LangChain Implementation

**Note:** LangGraph uses tuple-based streaming `(message_chunk, metadata)` and returns LangChain message objects with content as an array.

### Backend

**File:** `patterns/langgraph-single-agent/langgraph_agent.py`

```python
# Stream with messages mode - yields raw LangChain message chunks
async for event in graph.astream(
    {"messages": [("user", user_query)]},
    config=config,
    stream_mode="messages"
):
    message_chunk, metadata = event
    yield message_chunk.model_dump()  # Serialize to JSON-safe dict
```

### Event Structure

LangGraph emits LangChain message objects that serialize to JSON with content as an **array of content blocks**:

```javascript
// Text streaming (AIMessageChunk)
data: {"content": [{"type": "text", "text": "Hello", "index": 0}], "type": "AIMessageChunk", ...}
data: {"content": [{"type": "text", "text": " there", "index": 0}], "type": "AIMessageChunk", ...}

// Tool use start — content block has id and name
data: {"content": [{"type": "tool_use", "id": "tool_abc123", "name": "text_analysis", "input": {}, "index": 1}], "type": "AIMessageChunk", ...}

// Tool input streaming — partial_json carries incremental input
data: {"content": [{"type": "tool_use", "partial_json": "{\"text\":", "index": 1}], "type": "AIMessageChunk", ...}
data: {"content": [{"type": "tool_use", "partial_json": " \"hello\"}", "index": 1}], "type": "AIMessageChunk", ...}

// Tool response (ToolMessage — separate message type)
data: {"content": "Tool result text", "type": "tool", "name": "text_analysis", "tool_call_id": "tool_abc123", ...}

// Stop reason
data: {"content": [], "type": "AIMessageChunk", "response_metadata": {"stop_reason": "end_turn"}, ...}

// Final chunk with usage metadata
data: {"content": [], "type": "AIMessageChunk", "chunk_position": "last", "usage_metadata": {"input_tokens": 88, "output_tokens": 30}}
```

**Current parser handles:**
- `AIMessageChunk` with `content[].type === "text"`: Text tokens for display
- `AIMessageChunk` with `content[].type === "tool_use"` + `id` + `name`: Tool call start
- `AIMessageChunk` with `content[].type === "tool_use"` + `partial_json`: Streaming tool input
- `type === "tool"` (ToolMessage): Tool execution result
- `response_metadata.stop_reason`: Stream completion

**Key difference from Strands:** LangGraph's `content` is always an array of typed blocks (text, tool_use), not a flat string. Tool results come as separate `ToolMessage` objects, not nested in user messages.

### Frontend Parser

**File:** `frontend/src/lib/agentcore-client/parsers/langgraph.ts`

Same pattern — parses SSE lines and emits typed events. LangGraph uses LangChain message types:

```typescript
export const parseLanggraphChunk: ChunkParser = (line, callback) => {
  if (!line.startsWith("data: ")) return;
  const json = JSON.parse(line.substring(6).trim());

  // Tool result: {"type": "tool", "tool_call_id": "...", "content": "result"}
  if (json.type === "tool") {
    callback({ type: "tool_result", toolUseId: json.tool_call_id, result: json.content });
  }

  // AIMessageChunk — content is an array of blocks
  if (json.type === "AIMessageChunk" && Array.isArray(json.content)) {
    for (const block of json.content) {
      if (block.type === "text" && block.text) {
        callback({ type: "text", content: block.text });
      }
      if (block.type === "tool_use" && block.id && block.name) {
        callback({ type: "tool_use_start", toolUseId: block.id, name: block.name });
      }
    }

    // Stop reason from response metadata
    if (json.response_metadata?.stop_reason) {
      callback({ type: "result", stopReason: json.response_metadata.stop_reason });
    }
  }
};
```

See the full implementation for tool input delta streaming and edge cases.

**Key Points:**
- Filter by `type === 'AIMessageChunk'` to only process assistant responses
- Ignore `ToolMessage` and other internal message types
- `content` is an **array of content blocks**, not a string
- Each block has `type`, `text`, and `index` fields
- Filter for `type === 'text'` to extract text content
- Join multiple text blocks if present

**Why Content is an Array:**
LangChain uses content blocks to support multimodal messages (text, images, tool calls) following the Anthropic/OpenAI message format.

**References:**
- [LangGraph Streaming](https://docs.langchain.com/oss/python/langgraph/streaming)
- [LangChain Streaming](https://docs.langchain.com/oss/python/langchain/streaming)

---

## Adding a New Agent Pattern

1. Create `patterns/my-pattern/` with your agent code
2. Create a parser: `frontend/src/lib/agentcore-client/parsers/my-pattern.ts`
   - Export a `ChunkParser` function that converts SSE lines into `StreamEvent`s via `callback()`
3. Register it in `frontend/src/lib/agentcore-client/client.ts` (add to the parser map in the constructor)
4. Set `pattern: my-pattern` in `infra-cdk/config.yaml`

---

## Debugging

Enable console logging in the parser:

```javascript
console.log('[Streaming Event]', data);
```

Open browser console (F12) to see all events from your agent.
