# LangGraph Single Agent Pattern

This pattern uses [LangGraph](https://github.com/langchain-ai/langgraph) with [LangChain AWS](https://github.com/langchain-ai/langchain-aws) to build a ReAct agent with Gateway tool access and AgentCore Memory for conversation history.

## Features

- **Token-Level Streaming**: True token-by-token streaming via `graph.astream()` with `stream_mode="messages"`
- **AgentCore Memory**: Conversation history persisted via `AgentCoreMemorySaver` (LangGraph checkpoint)
- **Gateway Integration**: Access Lambda-based tools through AgentCore Gateway via `MultiServerMCPClient`
- **ReAct Agent**: Uses LangGraph's `create_react_agent` for structured reasoning and tool use
- **Secure Identity**: User identity extracted from validated JWT token (`RequestContext`), not from payload

## Architecture

```
User Request
    |
BedrockAgentCoreApp (langgraph_agent.py)
    |
LangGraph ReAct Agent (Sonnet model via ChatBedrock)
    |
    +-- AgentCore Memory (conversation history)
    |     AgentCoreMemorySaver (LangGraph checkpoint)
    |
    +-- MultiServerMCPClient (streamable HTTP)
          Lambda-based tools via AgentCore Gateway
```

## File Structure

```
patterns/langgraph-single-agent/
├── langgraph_agent.py    # Main entrypoint (BedrockAgentCoreApp)
├── tools/
│   └── langgraph_execute_python.py  # LangGraph-specific tool wrapper
├── requirements.txt      # Pinned dependencies
└── Dockerfile            # Container build (Python 3.13)
```

## Available Tools

| Tool | Source | Description |
|------|--------|-------------|
| Gateway tools | AgentCore Gateway | Lambda-based tools discovered via `MultiServerMCPClient.get_tools()` |

## Model

- **Agent**: `us.anthropic.claude-sonnet-4-5-20250929-v1:0` (Sonnet via Bedrock)

## Streaming Events

The agent yields SSE `data: {json}` lines from `graph.astream()` with `stream_mode="messages"`. Each event is a `model_dump()` of either `AIMessageChunk` or `ToolMessage`. The frontend parser at `frontend/src/lib/agentcore-client/parsers/langgraph.ts` handles these:

| Event | Format | Description |
|-------|--------|-------------|
| Text (string) | `{"type": "AIMessageChunk", "content": "text"}` | Plain text response |
| Text (block) | `{"type": "AIMessageChunk", "content": [{"type": "text", "text": "..."}]}` | Text in content array |
| Tool use start | `{"type": "AIMessageChunk", "content": [{"type": "tool_use", "id": "...", "name": "..."}]}` | Tool invocation begins |
| Tool use delta | `{"type": "AIMessageChunk", "content": [{"type": "tool_use", "partial_json": "..."}]}` | Streaming tool input |
| Tool result | `{"type": "tool", "content": "result", "tool_call_id": "..."}` | Tool execution result |
| Stop | `{"response_metadata": {"stop_reason": "end_turn"}}` | Agent finished |

## Memory Integration

This pattern uses **AgentCore Memory** via the official LangGraph AWS integration:

1. `MEMORY_ID` environment variable provides the memory resource ID
2. `AgentCoreMemorySaver` acts as a LangGraph checkpointer
3. `thread_id` (session ID) and `actor_id` (user ID) passed via LangGraph config
4. Memory is tied to the `runtimeSessionId` from the client

## Security

- **User identity**: Extracted from the validated JWT token via `RequestContext`, not from the payload body
- **STACK_NAME validation**: Validated for alphanumeric format before use in SSM parameter paths
- **Payload validation**: Required fields (`prompt`, `runtimeSessionId`) validated before processing
- **Gateway auth**: OAuth2 client credentials flow via Cognito for machine-to-machine authentication

## Deployment

```bash
cd infra-cdk
# Set pattern in config.yaml:
#   backend:
#     pattern: langgraph-single-agent
#     deployment_type: docker  # or zip
cdk deploy
```

Both Docker and ZIP deployment types are supported.

## Dependencies

```
langgraph==1.0.5
langchain-aws==1.0.0
langchain-mcp-adapters==0.1.13
langgraph-checkpoint-aws==1.0.1
mcp==1.23.1
bedrock-agentcore==1.0.6
PyJWT[crypto]>=2.10.1
```
