"use client"

import { useState, useRef } from "react"
import { Globe, Loader2, CheckCircle2, ChevronRight, ChevronDown, Monitor } from "lucide-react"
import type { ToolRenderProps } from "@/hooks/useToolRenderer"
import { BrowserLiveView } from "./BrowserLiveView"

/**
 * Browser tool display component.
 *
 * Uses streamEvents length as a React key on the actions container
 * to force re-render when new events arrive.
 */
export function BrowserToolDisplay({
  name,
  args,
  status,
  result,
  liveViewUrl,
  streamEvents,
}: ToolRenderProps) {
  const [expanded, setExpanded] = useState(false)
  const [showViewer, setShowViewer] = useState(false)
  const stableUrlRef = useRef<string | null>(null)
  const wasAutoExpanded = useRef(false)

  // Parse the input args to extract task and URL
  let taskDescription = ""
  let startingUrl = ""
  try {
    const parsedArgs = JSON.parse(args)
    taskDescription = parsedArgs.task || ""
    startingUrl = parsedArgs.starting_url || ""
  } catch {
    taskDescription = args
  }

  // Prefer streamed liveViewUrl; fall back to extracting from final result.
  let url: string | null = liveViewUrl ?? null
  if (!url && result) {
    try {
      const parsed = JSON.parse(result)
      if (parsed?.live_view_url && String(parsed.live_view_url).includes("bedrock-agentcore")) {
        url = String(parsed.live_view_url)
      }
    } catch {
      const match = result.match(/https:\/\/bedrock-agentcore\.[^\s"]+live-view[^\s"]+/)
      if (match) url = match[0]
    }
  }
  if (url && !stableUrlRef.current) {
    stableUrlRef.current = url
  }
  const stableUrl = stableUrlRef.current

  // Parse browser tool result
  const parsedResult = result ? parseBrowserResult(result) : null

  // Extract actions from stream events
  const evtCount = streamEvents?.length ?? 0
  const liveActions: string[] = []
  if (streamEvents) {
    for (const ev of streamEvents) {
      if (typeof ev === "object" && ev !== null) {
        const data = ev as Record<string, unknown>
        if (data.type !== "browser_live_view" && data.extracted_content) {
          liveActions.push(String(data.extracted_content))
        }
      }
    }
  }

  const isInProgress = status === "streaming" || status === "executing"

  // Auto-expand when first stream event arrives so user sees live actions
  if (isInProgress && liveActions.length > 0 && !wasAutoExpanded.current) {
    wasAutoExpanded.current = true
    if (!expanded) setExpanded(true)
  }

  return (
    <div className="my-1 text-sm">
      {/* Header row */}
      <div className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-200/50 transition-colors">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 flex-1 text-left"
        >
          {expanded ? (
            <ChevronDown size={12} className="text-gray-400" />
          ) : (
            <ChevronRight size={12} className="text-gray-400" />
          )}
          <Globe size={12} className="text-blue-500" />
          <span className="text-blue-700 font-medium">{name}</span>
          {!expanded && (
            <span className="text-xs text-gray-500 ml-1">
              {isInProgress
                ? liveActions.length > 0
                  ? `(${liveActions.length} actions)`
                  : "(executing...)"
                : status === "complete"
                  ? `✓ done${liveActions.length > 0 ? ` (${liveActions.length} actions)` : ""}`
                  : ""}
            </span>
          )}
        </button>
        {stableUrl && (
          <button
            onClick={() => setShowViewer(!showViewer)}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-1.5 py-0.5 rounded hover:bg-blue-50 transition-colors"
          >
            <Monitor size={10} />
            {showViewer ? "Hide viewer" : status === "complete" ? "View session" : "Watch live"}
          </button>
        )}
        {status === "streaming" && <Loader2 size={12} className="animate-spin text-blue-500" />}
        {status === "executing" && <Loader2 size={12} className="animate-spin text-amber-500" />}
        {status === "complete" && <CheckCircle2 size={12} className="text-green-500" />}
      </div>

      {/* Expanded content — ONLY visible when expanded */}
      {expanded && (
        <div key={`actions-${evtCount}-${status}`} className="mx-2 mt-1 space-y-2">
          {/* 1. Input — task and URL */}
          {args && (
            <div className="text-xs text-gray-600">
              {taskDescription && (
                <div>
                  <span className="font-medium">Task:</span> {taskDescription}
                </div>
              )}
              {startingUrl && (
                <div className="mt-0.5">
                  <span className="font-medium">URL:</span>{" "}
                  <a
                    href={startingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {startingUrl}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* 2. Browser actions */}
          {isInProgress && liveActions.length === 0 && (
            <div className="text-xs text-gray-400 italic">Waiting for browser actions...</div>
          )}
          {liveActions.length > 0 && (
            <div className="space-y-0.5">
              <div className="text-xs text-gray-500">Browser actions ({liveActions.length}):</div>
              {liveActions.slice(-5).map((action, i) => (
                <div
                  key={`${evtCount}-${i}`}
                  className={`text-xs rounded px-2 py-1 border-l-2 ${
                    isInProgress
                      ? "text-gray-600 bg-blue-50 border-blue-300"
                      : "text-gray-500 bg-gray-50 border-gray-300"
                  }`}
                >
                  {action}
                </div>
              ))}
            </div>
          )}

          {/* 3. Result */}
          {status === "complete" && parsedResult?.finalContent && (
            <div className="text-xs text-gray-700 bg-green-50 rounded px-2 py-1.5 border border-green-200">
              <span className="font-medium text-green-800">✓ </span>
              <span className="line-clamp-3">{parsedResult.finalContent}</span>
            </div>
          )}
        </div>
      )}

      {/* 4. DCV live viewer — with spacing */}
      {showViewer && stableUrl && (
        <div className="mx-2 mt-3 mb-1 rounded overflow-hidden border border-gray-200">
          <BrowserLiveView
            presignedUrl={stableUrl}
            isActive={showViewer}
            onConnectionError={() => {}}
          />
        </div>
      )}
    </div>
  )
}

/** Parse browser tool result to extract meaningful content. */
function parseBrowserResult(result: string): {
  finalContent: string | null
  actions: string[]
  raw: string
} | null {
  try {
    const parsed = JSON.parse(result)
    let finalContent: string | null = null
    const actions: string[] = []
    if (parsed.response && typeof parsed.response === "string") {
      const matches = Array.from(
        parsed.response.matchAll(/extracted_content='([^']+(?:''[^']+)*)'/g)
      ) as RegExpMatchArray[]
      const contents = matches.map((m: RegExpMatchArray) => m[1].replace(/''/g, "'"))
      if (contents.length > 0) {
        finalContent = contents[contents.length - 1]
        for (let i = 0; i < contents.length - 1; i++) {
          if (contents[i] && !contents[i].includes("AgentHistoryList")) actions.push(contents[i])
        }
      }
    }
    return { finalContent, actions, raw: result }
  } catch {
    return { finalContent: null, actions: [], raw: result }
  }
}
