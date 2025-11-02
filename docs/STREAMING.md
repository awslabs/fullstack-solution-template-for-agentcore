# Streaming Guide for Agents

## Overview

Your agent sends streaming events. This guide shows how to integrate them with the UI.

## Integration Steps

1. **Your agent sends streaming events** (SSE format)
2. **Update `agentCoreService.js`** to parse your agent's events
3. **Update `Home.jsx`** (optional) to display additional info like tool usage
4. **UI displays the parsed text** in real-time

## Current Implementation: Strands Agent

### Event Format

Strands sends events in JSON and Python dict formats:

**Example streaming sequence:**
```javascript
data: {"start": true}
data: {"start_event_loop": true}
data: {"event": {"messageStart": {"role": "assistant"}}}
data: {"event": {"contentBlockDelta": {"delta": {"text": "Hello"}}}}
data: "{'data': 'Hello', 'delta': {'text': 'Hello'}, ...}"
data: {"event": {"contentBlockDelta": {"delta": {"text": " there"}}}}
data: "{'data': ' there', 'delta': {'text': ' there'}, ...}"
data: {"event": {"contentBlockStop": {"contentBlockIndex": 0}}}
data: {"event": {"messageStop": {"stopReason": "end_turn"}}}
data: {"event": {"metadata": {"usage": {...}}}}
data: {"message": {"content": [{"text": "Hello there"}]}}
data: "{'result': AgentResult(..., 'text': 'Hello there'), ...}"
```

**Reference:** [Strands Streaming Docs](https://strandsagents.com/latest/documentation/docs/user-guide/concepts/streaming/overview/)

### Parser Location

**File:** `frontend/src/services/agentCoreService.js`

See the `parseStreamingChunk()` function for full implementation.

### Handling Additional Events

To handle tool streaming or other Strands events, add to the parser:

```javascript
// Inside parseStreamingChunk() function

// Handle tool streaming events
if (json.tool_stream_event?.data) {
  const toolText = `\n[Tool: ${json.tool_stream_event.tool_use.name}]\n${json.tool_stream_event.data}`;
  const newText = currentCompletion + toolText;
  updateCallback(newText);
  return newText;
}

// Handle current tool use
if (json.current_tool_use?.name) {
  const toolStatus = `\n[Using tool: ${json.current_tool_use.name}]\n`;
  const newText = currentCompletion + toolStatus;
  updateCallback(newText);
  return newText;
}
```

**Note:** You may also want to update `Home.jsx` to display tool usage separately (e.g., show which tool is being used in a status indicator above the message).

## Sample Implementation for LangGraph/LangChain

**Note:** LangGraph and LangChain use tuple-based streaming `(message_chunk, metadata)`. Backend yields raw chunks, frontend parser extracts content.

**Backend (Minimal):**
```python
# Yield raw chunks - no filtering
async for chunk, metadata in graph.astream(inputs, stream_mode="messages"):
    yield chunk
```

**Frontend Parser:**
```javascript
const parseStreamingChunk = (line, currentCompletion, updateCallback) => {
  const data = line.substring(6).trim();
  
  // Parse chunk object (auto-serialized by framework)
  const chunk = JSON.parse(data);
  
  // Extract content from chunk
  if (chunk.content) {
    const newText = currentCompletion + chunk.content;
    updateCallback(newText);
    return newText;
  }
  
  return currentCompletion;
};
```

**References:**
- [LangGraph Streaming](https://docs.langchain.com/oss/python/langgraph/streaming)
- [LangChain Streaming](https://docs.langchain.com/oss/python/langchain/streaming)


## Debugging

Enable console logging in the parser:
```javascript
console.log('[Streaming Event]', data);
```

Open browser console (F12) to see all events from your agent.
