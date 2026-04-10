# Claude Agent SDK Single-Agent Pattern

This pattern integrates Anthropic's Claude Agent SDK with Amazon Bedrock AgentCore, providing Code Interpreter access via an in-process MCP server and Gateway tool integration. For a multi-agent version with subagent delegation, see the `claude-agent-sdk-multi-agent` pattern.

## Features

- **Claude Agent SDK**: Uses Anthropic's official agent SDK (`ClaudeSDKClient`) for agentic workflows on Bedrock
- **Code Interpreter**: Execute Python code, bash commands, and file operations via an in-process MCP server
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
          Lambda-based tools via AgentCore Gateway
```

## File Structure

```
patterns/claude-agent-sdk-single-agent/
├── agent.py                  # Main entrypoint (BedrockAgentCoreApp)
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
| Gateway tools | `mcp__gateway__*` | Lambda-based tools via AgentCore Gateway |

## Built-in Tool Configuration

The Claude Agent SDK includes built-in tools from claude-code (Bash, Read, Write, etc.). This pattern disables most of them so the agent operates exclusively through Code Interpreter and Gateway MCP tools.

**Disabled built-in tools** (`disallowed_tools` in `ClaudeAgentOptions`):

| Tool | Why disabled |
|------|-------------|
| `Bash` | Use `mcp__codeint__execute_command` instead (sandboxed Code Interpreter) |
| `Write` | Use `mcp__codeint__write_files` instead (sandboxed Code Interpreter) |
| `Read` | Use `mcp__codeint__read_files` instead (sandboxed Code Interpreter) |
| `Edit` | Use Code Interpreter file operations instead |
| `NotebookEdit` | Use Code Interpreter for notebook-style execution |
| `WebFetch` | Not needed for this pattern |
| `Glob` | Use Code Interpreter for file discovery |
| `Grep` | Use Code Interpreter for content searching |
| `EnterWorktree` | Not applicable in this deployment context |
| `Skill` | Not applicable in this deployment context |
| `TodoWrite` | Not applicable in this deployment context |
| `CronCreate` | Not applicable in this deployment context |
| `CronDelete` | Not applicable in this deployment context |
| `CronList` | Not applicable in this deployment context |

**To re-enable a built-in tool**, remove it from the `disallowed_tools` list in the `_build_options()` function in `agent.py`:

```python
# Before: tool is disabled
disallowed_tools=["Bash", "Write", "NotebookEdit", "Edit", "WebFetch", "Read", "Glob", "Grep", "EnterWorktree", "Skill", "TodoWrite", "CronCreate", "CronDelete", "CronList"],

# After: Bash re-enabled
disallowed_tools=["Write", "NotebookEdit", "Edit", "WebFetch", "Read", "Glob", "Grep", "EnterWorktree", "Skill", "TodoWrite", "CronCreate", "CronDelete", "CronList"],
```

If you also want the agent to proactively use the re-enabled tool, add it to the `allowed_tools` list and mention it in the `system_prompt`.

## Models

- **Main agent**: `us.anthropic.claude-opus-4-6-v1`

## Streaming Events

The agent yields three event types as SSE `data: {json}` lines:

| Event | Format | Description |
|-------|--------|-------------|
| Text | `{"data": "text content"}` | Agent text response |
| Tool use | `{"current_tool_use": {"name": "...", "input": {...}, "toolUseId": "..."}}` | Tool invocation |
| Session ID | `{"claude_session_id": "..."}` | Session ID for conversation resumption |

A dedicated frontend parser at `frontend/src/lib/agentcore-client/parsers/claude-agent-sdk.ts` handles these events. Both the single-agent and multi-agent patterns share the same parser.

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

## Deployment

```bash
cd infra-cdk
# Set pattern in config.yaml:
#   backend:
#     pattern: claude-agent-sdk-single-agent
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

## Differences from Other Patterns

| Feature | Claude Agent SDK (Single-Agent) | Claude Agent SDK (Multi-Agent) | Strands | LangGraph |
|---------|--------------------------------|-------------------------------|---------|-----------|
| Framework | Anthropic Claude Agent SDK | Anthropic Claude Agent SDK | Strands Agents | LangGraph + LangChain |
| Model provider | Bedrock (via `CLAUDE_CODE_USE_BEDROCK`) | Bedrock (via `CLAUDE_CODE_USE_BEDROCK`) | Bedrock (`BedrockModel`) | Bedrock (`ChatBedrock`) |
| Memory | `claude_session_id` (SDK-managed) | `claude_session_id` (SDK-managed) | AgentCoreMemory | AgentCoreMemory |
| Token streaming | No (complete message blocks) | No (complete message blocks) | Yes | Yes |
| Subagents | No (single agent) | Yes (Task tool + `AgentDefinition`) | No (single agent) | No (single agent) |
| Code Interpreter | In-process MCP server | In-process MCP server | `StrandsCodeInterpreterTools` | LangGraph tool wrapper |
| Requires Node.js | Yes (claude-code CLI) | Yes (claude-code CLI) | No | No |
| ZIP deployment | Not supported | Not supported | Supported | Supported |
