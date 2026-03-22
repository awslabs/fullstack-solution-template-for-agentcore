// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ChunkParser } from "../types"

/**
 * Parses SSE chunks from LangGraph agents (stream_mode="messages").
 *
 * Uses LangChain's normalized message fields — works with any ChatModel backend.
 *
 * Stream format:
 *   AIMessageChunk:
 *     - text:        content (string)
 *     - tool start:  tool_call_chunks[{id, name, args}]  — first chunk has id + name
 *     - tool delta:  tool_call_chunks[{args}]             — subsequent chunks have args only
 *     - stop:        response_metadata.stop_reason
 *   ToolMessage:
 *     - type: "tool", content: string, tool_call_id: string
 */

// Track current tool_use_id — streaming deltas may omit the id
let currentToolUseId = ""

export const parseLanggraphChunk: ChunkParser = (line, callback) => {
  if (!line.startsWith("data: ")) return

  const data = line.substring(6).trim()
  if (!data) return

  try {
    const json = JSON.parse(data)

    // ToolMessage — tool result
    if (json.type === "tool") {
      callback({
        type: "tool_result",
        toolUseId: json.tool_call_id,
        result: typeof json.content === "string" ? json.content : JSON.stringify(json.content),
      })
      return
    }

    // AIMessageChunk
    if (json.type === "AIMessageChunk") {
      // Text token — content can be a string or array of text blocks
      if (typeof json.content === "string" && json.content) {
        callback({ type: "text", content: json.content })
      } else if (Array.isArray(json.content)) {
        for (const block of json.content) {
          if (block.type === "text" && block.text) {
            callback({ type: "text", content: block.text })
          }
        }
      }

      // Tool calls — streamed via tool_call_chunks (LangChain's standard streaming field)
      if (Array.isArray(json.tool_call_chunks)) {
        for (const chunk of json.tool_call_chunks) {
          if (chunk.id && chunk.name) {
            currentToolUseId = chunk.id
            callback({ type: "tool_use_start", toolUseId: chunk.id, name: chunk.name })
          }
          if (typeof chunk.args === "string" && chunk.args) {
            callback({
              type: "tool_use_delta",
              toolUseId: chunk.id || currentToolUseId,
              input: chunk.args,
            })
          }
        }
      }

      // Stop reason
      const stopReason = json.response_metadata?.stop_reason
      if (stopReason) {
        callback({ type: "result", stopReason })
      }
    }
  } catch {
    console.debug("Failed to parse langgraph event:", data)
  }
}
