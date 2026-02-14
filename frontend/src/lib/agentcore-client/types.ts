// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/** Supported agent framework patterns */
export type AgentPattern = "strands-single-agent" | "langgraph-single-agent";

/** Configuration for AgentCoreClient */
export interface AgentCoreConfig {
  runtimeArn: string;
  region?: string;
  pattern: AgentPattern;
}

/** Stream event types emitted by parsers */
export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "tool_use_start"; toolUseId: string; name: string }
  | { type: "tool_use_delta"; toolUseId: string; input: string }
  | { type: "tool_result"; toolUseId: string; result: string }
  | { type: "message"; role: string; content: unknown[] }
  | { type: "result"; stopReason: string }
  | { type: "lifecycle"; event: string };

/** Callback invoked with each stream event */
export type StreamCallback = (event: StreamEvent) => void;

/** Parses a single SSE line and emits events via callback */
export type ChunkParser = (line: string, callback: StreamCallback) => void;
