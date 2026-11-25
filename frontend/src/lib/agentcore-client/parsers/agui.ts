// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ChunkParser } from "../types"

/**
 * Parses SSE chunks from AG-UI 1.0 agents (ag-ui-strands, ag-ui-langgraph).
 *
 * AG-UI events arrive as `data: <JSON>` where each JSON object has a `type` field:
 *   RUN_STARTED, STATE_SNAPSHOT, TEXT_MESSAGE_START, TEXT_MESSAGE_CONTENT,
 *   TEXT_MESSAGE_END, TOOL_CALL_START, TOOL_CALL_ARGS, TOOL_CALL_END,
 *   TOOL_CALL_RESULT, RUN_FINISHED, RUN_ERROR
 */

/**
 * AG-UI 1.0 tool results are either a string or a list of content parts
 * (text, image, ...). The chat UI shows text, so keep the text parts.
 */
function toolResultToText(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map(part =>
      part && typeof part === "object" && (part as { type?: string }).type === "text"
        ? String((part as { text?: unknown }).text ?? "")
        : ""
    )
    .join("")
}

export const parseAguiChunk: ChunkParser = (line, callback) => {
  if (!line.startsWith("data: ")) return

  const data = line.substring(6).trim()
  if (!data) return

  try {
    const json = JSON.parse(data)
    const eventType: string = json.type

    switch (eventType) {
      case "TEXT_MESSAGE_CONTENT":
        callback({ type: "text", content: json.delta ?? "" })
        break

      case "TOOL_CALL_START":
        callback({
          type: "tool_use_start",
          toolUseId: json.toolCallId,
          name: json.toolCallName,
        })
        break

      case "TOOL_CALL_ARGS":
        callback({
          type: "tool_use_delta",
          toolUseId: json.toolCallId,
          input: json.delta ?? "",
        })
        break

      case "TOOL_CALL_RESULT":
        callback({
          type: "tool_result",
          toolUseId: json.toolCallId,
          result: toolResultToText(json.content),
        })
        break

      case "RUN_FINISHED":
        callback({ type: "result", stopReason: "end_turn" })
        callback({ type: "lifecycle", event: "run_finished" })
        break

      case "RUN_STARTED":
        callback({ type: "lifecycle", event: "run_started" })
        break

      case "TEXT_MESSAGE_START":
        callback({ type: "lifecycle", event: "message_start" })
        break

      case "TEXT_MESSAGE_END":
        callback({ type: "lifecycle", event: "message_end" })
        break

      case "RUN_ERROR":
        // The run failed inside the agent. Surface the reason in the chat and
        // close the turn so the UI does not wait for a RUN_FINISHED that never comes.
        callback({ type: "text", content: `\n\nError: ${json.message ?? "The agent run failed."}` })
        callback({ type: "result", stopReason: "error" })
        callback({ type: "lifecycle", event: "run_error" })
        break

      case "STATE_SNAPSHOT":
      case "STATE_DELTA":
      case "MESSAGES_SNAPSHOT":
      case "TOOL_CALL_END":
      case "STEP_STARTED":
      case "STEP_FINISHED":
      case "REASONING_START":
      case "REASONING_MESSAGE_START":
      case "REASONING_MESSAGE_CONTENT":
      case "REASONING_MESSAGE_END":
      case "REASONING_END":
      case "ACTIVITY_SNAPSHOT":
      case "ACTIVITY_DELTA":
      case "CUSTOM":
      case "RAW":
        // Not rendered by this lightweight chat UI — no action needed
        break

      default:
        console.debug("Unhandled AG-UI event type:", eventType)
    }
  } catch {
    console.debug("Failed to parse AG-UI event:", data)
  }
}
