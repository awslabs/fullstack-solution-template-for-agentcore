// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import type { ChunkParser, StreamCallback } from "../types"

/** Reads an SSE response stream, passing each line to the parser. */
export async function readSSEStream(
  response: Response,
  parser: ChunkParser,
  callback: StreamCallback
): Promise<void> {
  let buffer = ""

  if (!response.body) {
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.trim()) {
          parser(line, callback)
        }
      }

      // Yield to the browser so React can flush state updates between chunks.
      // Without this, multiple SSE events in one network chunk get batched
      // into a single React render, making streaming appear instant.
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    // Process any remaining data in the buffer
    if (buffer.trim()) {
      parser(buffer, callback)
    }
  } finally {
    reader.releaseLock()
  }
}
