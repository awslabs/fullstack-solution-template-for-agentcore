# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

from code_int_mcp.server import code_int_mcp_server
from claude_agent_sdk import (
    AssistantMessage,
    UserMessage,
    ResultMessage,
    SystemMessage,
    ClaudeAgentOptions,
    TextBlock,
    ToolUseBlock,
    ClaudeSDKClient,
    ToolResultBlock,
    ProcessError,
)
from bedrock_agentcore.runtime import BedrockAgentCoreApp, RequestContext
from agents.subagents import get_subagent_definitions
from utils.auth import extract_user_id_from_context, get_gateway_access_token
from utils.ssm import get_ssm_parameter
import logging
import json
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = BedrockAgentCoreApp()


@app.entrypoint
async def main(payload, context: RequestContext):
    """
    Entrypoint for the Claude Agent SDK pattern.
    Uses ClaudeSDKClient for streaming with Code Interpreter and Gateway tools.
    User identity is extracted securely from the validated JWT token.
    """
    prompt = payload["prompt"]
    runtime_session_id = payload.get("runtimeSessionId", "")
    code_int_session_id = payload.get("code_int_session_id", "")
    claude_session_id = payload.get("claude_session_id")

    # Extract user ID securely from validated JWT token
    user_id = extract_user_id_from_context(context)
    logger.info("[AGENT] User: %s, Session: %s", user_id, runtime_session_id)

    # Get Gateway URL and access token
    stack_name = os.environ.get("STACK_NAME")
    gateway_url = get_ssm_parameter(f"/{stack_name}/gateway_url") if stack_name else None
    access_token = get_gateway_access_token() if gateway_url else None

    agent_responses = []

    # Build MCP servers config
    mcp_servers = {
        "codeint": code_int_mcp_server,
    }
    allowed_tools = [
        "mcp__codeint__execute_code",
        "mcp__codeint__execute_command",
        "mcp__codeint__write_files",
        "mcp__codeint__read_files",
    ]

    # Add Gateway MCP server if available
    if gateway_url and access_token:
        mcp_servers["gateway"] = {
            "type": "http",
            "url": gateway_url,
            "headers": {"Authorization": f"Bearer {access_token}"},
        }
        allowed_tools.append("mcp__gateway__*")
        logger.info("Gateway MCP server configured: %s", gateway_url)

    # Add Task tool for subagent spawning
    allowed_tools.append("Task")

    # Build subagent definitions
    subagents = get_subagent_definitions(mcp_servers)

    def _build_options(resume_id: str | None) -> ClaudeAgentOptions:
        """Build ClaudeAgentOptions, optionally with a resume session ID."""
        return ClaudeAgentOptions(
            mcp_servers=mcp_servers,
            model="us.anthropic.claude-opus-4-6-v1",
            allowed_tools=allowed_tools,
            agents=subagents,
            resume=resume_id,
            thinking={"type": "adaptive"},
            cli_path="/usr/bin/claude",
            stderr=lambda line: logger.error("claude-code stderr: %s", line),
            system_prompt=f"""You are an AI assistant that helps users with code execution and analysis tasks.

CRITICAL RULES:
1. You MUST use mcp__codeint__execute_code for ALL Python code execution tasks.
2. You can use mcp__codeint__execute_command to execute bash commands.
3. Use gateway tools (mcp__gateway__*) for accessing tools provided via the Gateway.
4. Use the tools without asking for permission.
5. CODE INTERPRETER SESSION: For the first Code Interpreter call, pass an empty string "" for code_int_session_id. The tool will return a valid session ID in its response. Use that EXACT returned session ID for all subsequent Code Interpreter calls in this conversation. NEVER make up or generate your own session IDs.

SUBAGENT DELEGATION:
You have specialized subagents available via the Task tool:
- code-analyst: For analyzing code output, debugging errors, explaining results. Has Code Interpreter and Gateway tools.
When delegating, include all relevant context in the Task prompt.

Available tool categories:
- Code Interpreter: execute_code, execute_command, write_files, read_files
- Gateway: Tools provided via the AgentCore Gateway (mcp__gateway__*)

Your response should:
1. Show the results
2. Provide a brief explanation
""",
        )

    async def _process_messages(options: ClaudeAgentOptions):
        """Run the agent and yield response events."""
        async with ClaudeSDKClient(options=options) as client:
            await client.query(prompt)
            async for msg in client.receive_response():
                if isinstance(msg, SystemMessage):
                    if msg.subtype == "init":
                        logger.info("Claude session init: %s", msg.data.get("session_id"))
                elif isinstance(msg, AssistantMessage):
                    for block in msg.content:
                        if isinstance(block, ToolUseBlock):
                            logger.info("TOOL USE: %s", block.name)
                            yield {
                                "current_tool_use": {
                                    "name": block.name,
                                    "input": block.input,
                                    "toolUseId": f"tool-{block.id}" if hasattr(block, "id") else f"tool-{hash(block.name)}",
                                }
                            }
                        elif isinstance(block, TextBlock):
                            logger.info("Agent response: %s", block.text)
                            agent_responses.append(block.text)
                            yield {"data": block.text}
                elif isinstance(msg, UserMessage):
                    for block in msg.content:
                        if isinstance(block, ToolResultBlock):
                            if block.content and len(block.content) > 0:
                                if isinstance(block.content[0], dict):
                                    text_content = block.content[0].get("text", "")
                                    try:
                                        result_data = json.loads(text_content)
                                        if isinstance(result_data, dict):
                                            extracted = result_data.get("code_int_session_id", "")
                                            if extracted:
                                                code_int_session_id = extracted
                                    except json.JSONDecodeError:
                                        pass
                elif isinstance(msg, ResultMessage):
                    logger.info("ResultMessage received, session_id=%s", msg.session_id)
                    yield {"claude_session_id": msg.session_id}

    try:
        async for event in _process_messages(_build_options(claude_session_id)):
            yield event
    except ProcessError:
        if claude_session_id:
            logger.warning("Resume failed for session %s, starting fresh session", claude_session_id)
            async for event in _process_messages(_build_options(None)):
                yield event
        else:
            raise


if __name__ == "__main__":
    app.run()
