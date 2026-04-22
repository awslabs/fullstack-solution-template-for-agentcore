// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import React from "react"
import { BrowserLiveView as AgentCoreBrowserLiveView } from "bedrock-agentcore/browser/live-view"

interface BrowserLiveViewProps {
  presignedUrl: string
  isActive: boolean
  onConnectionError?: () => void
}

/**
 * Wrapper around the bedrock-agentcore BrowserLiveView component.
 *
 * Memoized to prevent DCV reconnections on parent re-renders.
 * The component auto-scales to fit its parent container while preserving aspect ratio.
 * remoteWidth and remoteHeight must match the backend viewport dimensions.
 */
export const BrowserLiveView = React.memo(function BrowserLiveView({
  presignedUrl,
  isActive,
}: BrowserLiveViewProps) {
  if (!isActive || !presignedUrl) {
    return null
  }

  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "1380 / 720",
        background: "#0f172a",
        position: "relative",
      }}
    >
      <AgentCoreBrowserLiveView signedUrl={presignedUrl} remoteWidth={1380} remoteHeight={720} />
    </div>
  )
})
