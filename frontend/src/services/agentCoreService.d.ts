// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Type declarations for agentCoreService.js
 */

export function invokeAgentCore(
  message: string,
  sessionId: string,
  onStreamUpdate: (content: string) => void,
  accessToken: string,
  userId: string
): Promise<void>

export function generateSessionId(): string

export function setAgentConfig(
  agentRuntimeArn: string,
  awsRegion: string,
  agentPattern?: string
): Promise<void>
