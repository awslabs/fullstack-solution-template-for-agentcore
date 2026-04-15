"use client"

import { useState } from "react"
import { ThumbsUp, ThumbsDown } from "lucide-react"
import { Message } from "./types"
import { FeedbackDialog } from "./FeedbackDialog"
import { getToolRenderer } from "@/hooks/useToolRenderer"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { renderContentWithCharts } from "./ChartRenderer"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from "recharts"

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe", "#818cf8", "#4f46e5"]

interface ChatMessageProps {
  message: Message
  sessionId: string
  onFeedbackSubmit: (feedbackType: "positive" | "negative", comment: string) => Promise<void>
}

export function ChatMessage({
  message,
  sessionId: _sessionId,
  onFeedbackSubmit,
}: ChatMessageProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedFeedbackType, setSelectedFeedbackType] = useState<"positive" | "negative">(
    "positive"
  )
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false)

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const handleFeedbackClick = (type: "positive" | "negative") => {
    setSelectedFeedbackType(type)
    setIsDialogOpen(true)
  }

  const handleFeedbackSubmit = async (comment: string) => {
    await onFeedbackSubmit(selectedFeedbackType, comment)
    setFeedbackSubmitted(true)
  }

  const renderAssistantContent = () => {
    if (message.segments && message.segments.length > 0) {
      return message.segments.map((seg, i) => {
        if (seg.type === "text") {
          const { text, charts } = renderContentWithCharts(seg.content)
          return (
            <div key={i}>
              {text && <MarkdownRenderer content={text} />}
              {charts.map((chart, ci) => (
                <div key={ci} className="my-4 p-4 bg-gray-50 rounded-lg border">
                  {chart.title && <p className="text-sm font-medium text-gray-700 mb-3">{chart.title}</p>}
                  <ResponsiveContainer width="100%" height={280}>
                    {chart.type === "pie" ? (
                      <PieChart><Pie data={chart.data} dataKey={chart.yKey} nameKey={chart.xKey} cx="50%" cy="50%" outerRadius={100} label={({ name, value }) => `${name}: ${value}`}>{chart.data.map((_, j) => <Cell key={j} fill={COLORS[j % COLORS.length]} />)}</Pie><Tooltip /></PieChart>
                    ) : chart.type === "line" ? (
                      <LineChart data={chart.data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={chart.xKey} tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip /><Line type="monotone" dataKey={chart.yKey} stroke="#6366f1" strokeWidth={2} /></LineChart>
                    ) : (
                      <BarChart data={chart.data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={chart.xKey} tick={{ fontSize: 12 }} angle={-30} textAnchor="end" height={60} /><YAxis tick={{ fontSize: 12 }} /><Tooltip /><Bar dataKey={chart.yKey} fill="#6366f1" radius={[4, 4, 0, 0]} /></BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          )
        }
        const render = getToolRenderer(seg.toolCall.name)
        if (!render) return null
        return (
          <div key={seg.toolCall.toolUseId} className="my-1">
            {render({ name: seg.toolCall.name, args: seg.toolCall.input, status: seg.toolCall.status, result: seg.toolCall.result })}
          </div>
        )
      })
    }
    const { text, charts } = renderContentWithCharts(message.content)
    return (
      <>
        {text && <MarkdownRenderer content={text} />}
        {charts.map((chart, ci) => (
          <div key={ci} className="my-4 p-4 bg-gray-50 rounded-lg border">
            {chart.title && <p className="text-sm font-medium text-gray-700 mb-3">{chart.title}</p>}
            <ResponsiveContainer width="100%" height={280}>
              {chart.type === "bar" ? (
                <BarChart data={chart.data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey={chart.xKey} tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} /><Tooltip /><Bar dataKey={chart.yKey} fill="#6366f1" radius={[4, 4, 0, 0]} /></BarChart>
              ) : <BarChart data={chart.data}><Bar dataKey={chart.yKey} fill="#6366f1" /></BarChart>}
            </ResponsiveContainer>
          </div>
        ))}
      </>
    )
  }

  return (
    <div className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[80%] break-words ${
          message.role === "user"
            ? "p-3 rounded-lg bg-gray-800 text-white rounded-br-none whitespace-pre-wrap"
            : "text-gray-800"
        }`}
      >
        {message.role === "assistant" ? renderAssistantContent() : message.content}
      </div>

      {/* Timestamp and Feedback buttons for assistant messages */}
      <div className="flex items-center gap-2 mt-1 px-1">
        <div className="text-xs text-gray-500">{formatTime(message.timestamp)}</div>

        {/* Show feedback buttons only for assistant messages with content */}
        {message.role === "assistant" && message.content && (
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => handleFeedbackClick("positive")}
              disabled={feedbackSubmitted}
              className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Positive feedback"
              title="Good response"
            >
              <ThumbsUp size={14} />
            </button>
            <button
              onClick={() => handleFeedbackClick("negative")}
              disabled={feedbackSubmitted}
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Negative feedback"
              title="Bad response"
            >
              <ThumbsDown size={14} />
            </button>
            {feedbackSubmitted && (
              <span className="text-xs text-gray-500 ml-1">Thanks for your feedback!</span>
            )}
          </div>
        )}
      </div>

      {/* Feedback Dialog */}
      <FeedbackDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onSubmit={handleFeedbackSubmit}
        feedbackType={selectedFeedbackType}
      />
    </div>
  )
}
