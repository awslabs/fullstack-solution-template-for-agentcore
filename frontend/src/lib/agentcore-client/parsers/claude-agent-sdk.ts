// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ChunkParser } from "../types";

/**
 * Parses SSE chunks from Claude Agent SDK agents.
 * Emits typed StreamEvents for text, tool use, and session lifecycle.
 *
 * Event shapes from the agent:
 * - {"data": "text"}              → text content
 * - {"current_tool_use": {...}}   → tool use (complete per event)
 * - {"claude_session_id": "..."}  → session ID for resumption
 */
export const parseClaudeAgentSdkChunk: ChunkParser = (line, callback) => {
  if (!line.startsWith("data: ")) return;

  const data = line.substring(6).trim();
  if (!data) return;

  try {
    const json = JSON.parse(data);

    // Text streaming
    if (typeof json.data === "string") {
      callback({ type: "text", content: json.data });
      return;
    }

    // Tool use — claude-agent-sdk sends complete tool info per event
    if (json.current_tool_use) {
      const tool = json.current_tool_use;
      callback({
        type: "tool_use_start",
        toolUseId: tool.toolUseId,
        name: tool.name,
      });
      if (tool.input) {
        callback({
          type: "tool_use_delta",
          toolUseId: tool.toolUseId,
          input: JSON.stringify(tool.input),
        });
      }
      return;
    }

    // Claude session ID for conversation resumption
    if (json.claude_session_id) {
      callback({ type: "lifecycle", event: "session_id" });
      return;
    }
  } catch {
    console.debug("Failed to parse claude-agent-sdk event:", data);
  }
};
