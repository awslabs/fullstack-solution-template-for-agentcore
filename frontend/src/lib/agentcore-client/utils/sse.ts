// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ChunkParser, StreamCallback } from "../types";

/** Reads an SSE response stream, passing each line to the parser. */
export async function readSSEStream(
  response: Response,
  parser: ChunkParser,
  callback: StreamCallback
): Promise<void> {
  let buffer = "";

  if (!response.body) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          parser(line, callback);
        }
      }
    }

    // Process any remaining data in the buffer
    if (buffer.trim()) {
      parser(buffer, callback);
    }
  } finally {
    reader.releaseLock();
  }
}
