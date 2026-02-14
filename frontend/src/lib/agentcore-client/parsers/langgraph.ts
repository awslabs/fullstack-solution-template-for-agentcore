// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ChunkParser } from "../types";

/**
 * Parses SSE chunks from LangGraph agents (stream_mode="messages").
 *
 * Each SSE line is a model_dump() of either AIMessageChunk or ToolMessage.
 *
 * AIMessageChunk shapes:
 *   - text:       content: [{type:"text", text:"...", index:N}]
 *   - tool start: content: [{type:"tool_use", id, name, input:{}, index:N}]  + tool_calls[]
 *   - tool delta: content: [{type:"tool_use", partial_json:"...", index:N}]   + tool_call_chunks[]
 *   - stop:       response_metadata: {stop_reason:"end_turn"|"tool_use"}
 *   - last:       chunk_position: "last"
 *
 * ToolMessage shape:
 *   - type: "tool", content: "result", name: "tool_name", tool_call_id: "id"
 */

// Track current tool_use_id across chunks (deltas don't carry the id)
let currentToolUseId = "";

export const parseLanggraphChunk: ChunkParser = (line, callback) => {
  if (!line.startsWith("data: ")) return;

  const data = line.substring(6).trim();
  if (!data) return;

  try {
    const json = JSON.parse(data);

    // ToolMessage — tool result
    if (json.type === "tool") {
      callback({
        type: "tool_result",
        toolUseId: json.tool_call_id,
        result: typeof json.content === "string" ? json.content : JSON.stringify(json.content),
      });
      return;
    }

    // AIMessageChunk
    if (json.type === "AIMessageChunk") {
      if (Array.isArray(json.content)) {
        for (const block of json.content) {
          // Text token
          if (block.type === "text" && block.text) {
            callback({ type: "text", content: block.text });
          }

          // Tool use start — has id and name
          if (block.type === "tool_use" && block.id && block.name) {
            currentToolUseId = block.id;
            callback({ type: "tool_use_start", toolUseId: block.id, name: block.name });
          }

          // Tool input streaming — has partial_json
          if (block.type === "tool_use" && typeof block.partial_json === "string" && block.partial_json) {
            callback({ type: "tool_use_delta", toolUseId: currentToolUseId, input: block.partial_json });
          }
        }
      }

      // Stop reason
      const stopReason = json.response_metadata?.stop_reason;
      if (stopReason) {
        callback({ type: "result", stopReason });
      }
    }
  } catch {
    console.debug("Failed to parse langgraph event:", data);
  }
};
