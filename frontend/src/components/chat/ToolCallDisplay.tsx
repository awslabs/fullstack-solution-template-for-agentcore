"use client"

import { useState } from "react"
import { Wrench, Loader2, CheckCircle2, ChevronRight, ChevronDown } from "lucide-react"
import type { ToolRenderProps } from "@/hooks/useToolRenderer"

export function ToolCallDisplay({ name, args, status, result }: ToolRenderProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-1 text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-200/50 transition-colors w-full text-left"
      >
        {expanded ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
        <Wrench size={12} className="text-gray-400" />
        <span className="text-gray-600">{name}</span>
        {status === "streaming" && <Loader2 size={12} className="animate-spin text-blue-500 ml-auto" />}
        {status === "executing" && <Loader2 size={12} className="animate-spin text-amber-500 ml-auto" />}
        {status === "complete" && <CheckCircle2 size={12} className="text-green-500 ml-auto" />}
      </button>

      {expanded && (
        <div className="ml-6 mt-1 border-l-2 border-gray-200 pl-3 space-y-2">
          {args && (
            <div>
              <div className="text-xs text-gray-400">Input</div>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap break-words mt-0.5">{args}</pre>
            </div>
          )}
          {result && (
            <div>
              <div className="text-xs text-gray-400">Result</div>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap break-words mt-0.5">{result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
