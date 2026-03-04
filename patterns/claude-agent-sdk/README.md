# Claude Agent SDK Pattern

This pattern integrates Anthropic's Claude Agent SDK with Amazon Bedrock AgentCore, providing Code Interpreter access via an in-process MCP server, subagent delegation, and Gateway tool integration.

## Features

- **Claude Agent SDK**: Uses Anthropic's official agent SDK (`ClaudeSDKClient`) for agentic workflows on Bedrock
- **Code Interpreter**: Execute Python code, bash commands, and file operations via an in-process MCP server
- **Subagent Spawning**: Delegate focused subtasks to a specialized `code-analyst` subagent via the Task tool
- **Gateway Integration**: Access Lambda-based tools through AgentCore Gateway (MCP protocol with OAuth2 auth)
- **Session Management**: Resume conversations across requests via `claude_session_id`
- **Secure Identity**: User identity extracted from validated JWT token (`RequestContext`), not from payload

## Architecture

```
User Request
    |
BedrockAgentCoreApp (agent.py)
    |
ClaudeSDKClient (Opus model via Bedrock)
    |
    +-- Code Interpreter MCP (in-process)
    |     execute_code, execute_command, write_files, read_files
    |
    +-- Gateway MCP (HTTP, optional)
    |     Lambda-based tools via AgentCore Gateway
    |
    +-- Task tool (subagent spawning)
          code-analyst (Sonnet) — analyze output, debug errors
```

The main agent (Opus) orchestrates work and can delegate to a `code-analyst` subagent (Sonnet) that runs as a separate `claude-code` child process.

## File Structure

```
patterns/claude-agent-sdk/
├── agent.py                  # Main entrypoint (BedrockAgentCoreApp)
├── agents/
│   └── subagents.py          # Subagent definitions (code-analyst)
├── code_int_mcp/
│   ├── server.py             # MCP server with @tool definitions
│   ├── client.py             # boto3 wrapper for AgentCore Code Interpreter API
│   └── models.py             # Pydantic result model
├── requirements.txt          # Python dependencies
├── Dockerfile                # Container build (Python 3.11 + Node.js + claude-code CLI)
└── README.md
```

## Available Tools

| Tool | MCP Prefix | Description |
|------|-----------|-------------|
| `execute_code` | `mcp__codeint__` | Execute Python code snippets |
| `execute_command` | `mcp__codeint__` | Run bash/shell commands |
| `write_files` | `mcp__codeint__` | Write files in the Code Interpreter session |
| `read_files` | `mcp__codeint__` | Read files from the Code Interpreter session |
| `Task` | — | Spawn a subagent for focused subtasks |
| Gateway tools | `mcp__gateway__*` | Lambda-based tools via AgentCore Gateway |

## Models

- **Main agent**: `us.anthropic.claude-opus-4-6-v1`
- **Subagents**: `sonnet` (cost-efficient for focused analysis tasks)

## Streaming Events

The agent yields three event types as SSE `data: {json}` lines:

| Event | Format | Description |
|-------|--------|-------------|
| Text | `{"data": "text content"}` | Agent text response |
| Tool use | `{"current_tool_use": {"name": "...", "input": {...}, "toolUseId": "..."}}` | Tool invocation |
| Session ID | `{"claude_session_id": "..."}` | Session ID for conversation resumption |

A dedicated frontend parser at `frontend/src/lib/agentcore-client/parsers/claude-agent-sdk.ts` handles these events.

## Session Management

This pattern uses `claude_session_id` for conversation continuity — **not** AgentCoreMemory. The flow:

1. First request: no `claude_session_id` in payload — a fresh session is created
2. Agent yields `{"claude_session_id": "..."}` at the end of the response
3. Subsequent requests: include the returned `claude_session_id` in the payload
4. The SDK resumes the conversation via the `resume` option in `ClaudeAgentOptions`
5. If resumption fails (e.g., container replaced), the agent automatically starts a fresh session

## Code Interpreter Session Handling

Code Interpreter sessions are separate from Claude sessions:

1. First call: pass `code_int_session_id: ""` (empty string)
2. The tool returns a valid session ID in the response
3. Use the returned session ID for all subsequent Code Interpreter calls
4. Never generate or fabricate session IDs

## Adding a Subagent

Edit `agents/subagents.py` and add an entry to the dictionary returned by `get_subagent_definitions()`:

```python
"my-agent": AgentDefinition(
    description="When to use this agent (the main agent reads this to decide delegation)",
    prompt="System prompt defining the agent's role and behavior",
    tools=["mcp__codeint__execute_code", "mcp__gateway__*", "Read", "Grep", "Glob"],
    model="sonnet",
),
```

Constraints:
- Subagents inherit MCP server configuration from the parent `ClaudeAgentOptions`
- Subagents **cannot** spawn other subagents (don't include `Task` in their tools)
- Keep descriptions clear — the main agent uses them to decide when to delegate

## Deployment

```bash
cd infra-cdk
# Set pattern in config.yaml:
#   backend:
#     pattern: claude-agent-sdk
#     deployment_type: docker
cdk deploy
```

**Note**: This pattern requires `deployment_type: docker` because it needs Node.js and the `@anthropic-ai/claude-code` npm package installed at build time. ZIP deployment is not supported.

## Security

- **User identity**: Extracted from the validated JWT token via `RequestContext`, not from the payload body
- **STACK_NAME validation**: Validated for alphanumeric characters (plus `-` and `_`) before use in SSM parameter paths
- **Payload validation**: Required fields (`prompt`, `runtimeSessionId`) are validated before processing
- **Gateway auth**: OAuth2 client credentials flow via Cognito for machine-to-machine authentication
- **Gateway resilience**: If Gateway is unavailable, the agent continues without Gateway tools

## Differences from Strands / LangGraph Patterns

| Feature | Claude Agent SDK | Strands | LangGraph |
|---------|-----------------|---------|-----------|
| Framework | Anthropic Claude Agent SDK | Strands Agents | LangGraph + LangChain |
| Model provider | Bedrock (via `CLAUDE_CODE_USE_BEDROCK`) | Bedrock (`BedrockModel`) | Bedrock (`ChatBedrock`) |
| Memory | `claude_session_id` (SDK-managed) | AgentCoreMemory | AgentCoreMemory |
| Token streaming | No (complete message blocks) | Yes | Yes |
| Subagents | Yes (Task tool + `AgentDefinition`) | No (single agent) | No (single agent) |
| Code Interpreter | In-process MCP server | `StrandsCodeInterpreterTools` | LangGraph tool wrapper |
| Requires Node.js | Yes (claude-code CLI) | No | No |
| ZIP deployment | Not supported | Supported | Supported |
