// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ChunkParser } from "../types";

/**
 * Parses SSE chunks containing raw Bedrock Converse stream events.
 *
 * Strands agents yield events that include a nested `event` key with
 * Bedrock Converse API structures (messageStart, contentBlockDelta, etc.).
 * This parser extracts text, tool use, and lifecycle from those structures.
 */
// Track toolUseId across contentBlockStart → contentBlockDelta
let currentToolUseId = "";

export const parseConverseChunk: ChunkParser = (line, callback) => {
  if (!line.startsWith("data: ")) return;

  const data = line.substring(6).trim();
  if (!data) return;

  try {
    const json = JSON.parse(data);

    // Raw Converse events are nested under the `event` key
    const event = json.event;
    if (event) {
      // Text streaming
      if (event.contentBlockDelta?.delta?.text) {
        callback({ type: "text", content: event.contentBlockDelta.delta.text });
        return;
      }

      // Tool use start
      if (event.contentBlockStart?.start?.toolUse) {
        const toolUse = event.contentBlockStart.start.toolUse;
        currentToolUseId = toolUse.toolUseId;
        callback({ type: "tool_use_start", toolUseId: toolUse.toolUseId, name: toolUse.name });
        return;
      }

      // Tool use input streaming
      if (event.contentBlockDelta?.delta?.toolUse?.input) {
        const input = event.contentBlockDelta.delta.toolUse.input;
        callback({ type: "tool_use_delta", toolUseId: currentToolUseId, input });
        return;
      }

      // Message stop with stop reason
      if (event.messageStop?.stopReason) {
        callback({ type: "result", stopReason: event.messageStop.stopReason });
        return;
      }

      // Message start (lifecycle)
      if (event.messageStart) {
        callback({ type: "lifecycle", event: "message_start" });
        return;
      }

      return;
    }

    // Final result (Strands-level)
    if (json.result) {
      callback({ type: "result", stopReason: typeof json.result === "object" ? json.result.stop_reason : "end_turn" });
      return;
    }
  } catch {
    console.debug("Failed to parse converse event:", data);
  }
};
