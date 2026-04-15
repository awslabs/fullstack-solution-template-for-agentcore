"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { ChatHeader } from "./ChatHeader"
import { ChatInput } from "./ChatInput"
import { ChatMessages } from "./ChatMessages"
import { ChatSidebar } from "./ChatSidebar"
import { Message, MessageSegment, ToolCall, ChatSession, ChatCategory, CATEGORY_CONFIG } from "./types"

import { useGlobal } from "@/app/context/GlobalContext"
import { AgentCoreClient } from "@/lib/agentcore-client"
import type { AgentPattern } from "@/lib/agentcore-client"
import { submitFeedback } from "@/services/feedbackService"
import { useAuth } from "react-oidc-context"
import { useDefaultTool } from "@/hooks/useToolRenderer"
import { ToolCallDisplay } from "./ToolCallDisplay"
import { SidebarProvider } from "@/components/ui/sidebar"

const SESSIONS_KEY = "docent-admin-sessions"
const CURRENT_KEY = "docent-admin-current-session"

function loadSessions(): ChatSession[] {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]") } catch { return [] }
}
function saveSessions(s: ChatSession[]) { localStorage.setItem(SESSIONS_KEY, JSON.stringify(s)) }

export default function ChatInterface() {
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions)
  const [currentSessionId, setCurrentSessionId] = useState<string>(
    () => localStorage.getItem(CURRENT_KEY) || crypto.randomUUID()
  )
  const [currentCategory, setCurrentCategory] = useState<ChatCategory>("general")
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [client, setClient] = useState<AgentCoreClient | null>(null)

  const { isLoading, setIsLoading } = useGlobal()
  const auth = useAuth()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useDefaultTool(({ name, args, status, result }) => (
    <ToolCallDisplay name={name} args={args} status={status} result={result} />
  ))

  // Load config
  useEffect(() => {
    fetch("/aws-exports.json").then(r => r.json()).then(config => {
      setClient(new AgentCoreClient({
        runtimeArn: config.agentRuntimeArn,
        region: config.awsRegion || "us-east-1",
        pattern: (config.agentPattern || "strands-single-agent") as AgentPattern,
      }))
    }).catch(e => setError(`Configuration error: ${e.message}`))
  }, [])

  // Load messages when switching sessions
  useEffect(() => {
    const session = sessions.find(s => s.id === currentSessionId)
    setMessages(session?.history || [])
    localStorage.setItem(CURRENT_KEY, currentSessionId)
  }, [currentSessionId])

  // Persist messages to session
  const persistMessages = useCallback((msgs: Message[]) => {
    if (msgs.length === 0) return
    setSessions(prev => {
      const existing = prev.find(s => s.id === currentSessionId)
      const firstUserMsg = msgs.find(m => m.role === "user")?.content || "New Chat"
      const name = firstUserMsg.slice(0, 40) + (firstUserMsg.length > 40 ? "…" : "")
      const now = new Date().toISOString()
      let updated: ChatSession[]
      if (existing) {
        updated = prev.map(s => s.id === currentSessionId ? { ...s, history: msgs, endDate: now } : s)
      } else {
        updated = [{ id: currentSessionId, name, history: msgs, startDate: now, endDate: now, category: currentCategory }, ...prev]
      }
      saveSessions(updated)
      return updated
    })
  }, [currentSessionId])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || !client) return
    setError(null)

    const userMsg: Message = { role: "user", content: userMessage, timestamp: new Date().toISOString() }
    const assistantMsg: Message = { role: "assistant", content: "", timestamp: new Date().toISOString() }
    const newMessages = [...messages, userMsg, assistantMsg]
    setMessages(newMessages)
    setInput("")
    setIsLoading(true)

    // Build the actual prompt with category context and chart instructions
    const catHint = CATEGORY_CONFIG[currentCategory].systemHint
    const chartInstruction = currentCategory === "analytics"
      ? '\n\nWhen presenting numerical data that could be visualized, include a chart block like:\n```chart\n{"type":"bar","data":[{"name":"X","value":1}],"xKey":"name","yKey":"value","title":"Chart Title"}\n```\nSupported types: bar, pie, line.'
      : ""
    const fullPrompt = catHint ? `[Context: ${catHint}${chartInstruction}]\n\n${userMessage}` : userMessage

    try {
      const accessToken = auth.user?.access_token
      if (!accessToken) throw new Error("Authentication required.")

      const segments: MessageSegment[] = []
      const toolCallMap = new Map<string, ToolCall>()

      const updateMessage = () => {
        const content = segments.filter((s): s is Extract<MessageSegment, { type: "text" }> => s.type === "text").map(s => s.content).join("")
        setMessages(prev => {
          const updated = [...prev]
          updated[updated.length - 1] = { ...updated[updated.length - 1], content, segments: [...segments] }
          return updated
        })
      }

      await client.invoke(fullPrompt, currentSessionId, accessToken, event => {
        switch (event.type) {
          case "text": {
            const prev = segments[segments.length - 1]
            if (prev?.type === "tool") {
              for (const tc of toolCallMap.values()) {
                if (tc.status === "streaming" || tc.status === "executing") tc.status = "complete"
              }
            }
            const last = segments[segments.length - 1]
            if (last?.type === "text") last.content += event.content
            else segments.push({ type: "text", content: event.content })
            updateMessage()
            break
          }
          case "tool_use_start": {
            const tc: ToolCall = { toolUseId: event.toolUseId, name: event.name, input: "", status: "streaming" }
            toolCallMap.set(event.toolUseId, tc)
            segments.push({ type: "tool", toolCall: tc })
            updateMessage()
            break
          }
          case "tool_use_delta": {
            const tc = toolCallMap.get(event.toolUseId)
            if (tc) tc.input += event.input
            updateMessage()
            break
          }
          case "tool_result": {
            const tc = toolCallMap.get(event.toolUseId)
            if (tc) { tc.result = event.result; tc.status = "complete" }
            updateMessage()
            break
          }
          case "message": {
            if (event.role === "assistant") {
              for (const tc of toolCallMap.values()) { if (tc.status === "streaming") tc.status = "executing" }
              updateMessage()
            }
            break
          }
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      setError(`Failed to get response: ${msg}`)
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { ...updated[updated.length - 1], content: "Error processing request. Please try again." }
        return updated
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Persist after each send completes
  useEffect(() => { if (!isLoading && messages.length > 0) persistMessages(messages) }, [isLoading])

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(input) }

  const handleFeedbackSubmit = async (messageContent: string, feedbackType: "positive" | "negative", comment: string) => {
    try {
      const idToken = auth.user?.id_token
      if (!idToken) throw new Error("Auth required.")
      await submitFeedback({ sessionId: currentSessionId, message: messageContent, feedbackType, comment: comment || undefined }, idToken)
    } catch (err) {
      setError(`Feedback error: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  const startNewChat = (category?: ChatCategory) => {
    const newId = crypto.randomUUID()
    setCurrentSessionId(newId)
    setCurrentCategory(category || "general")
    setMessages([])
    setInput("")
    setError(null)
  }

  const selectSession = (session: ChatSession) => {
    if (messages.length > 0) persistMessages(messages)
    setCurrentSessionId(session.id)
    setCurrentCategory(session.category || "general")
    setError(null)
  }

  const isInitialState = messages.length === 0
  const hasAssistantMessages = messages.some(m => m.role === "assistant")

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full">
        <ChatSidebar
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSessionSelect={selectSession}
          onNewChat={startNewChat}
        />
        <div className="flex flex-col flex-1 min-w-0">
          <div className="flex-none">
            <ChatHeader onNewChat={startNewChat} canStartNewChat={hasAssistantMessages} />
            {error && (
              <div className="bg-red-50 border-l-4 border-red-500 p-4 mx-4 mt-2">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          {isInitialState ? (
            <>
              <div className="grow" />
              <div className="text-center mb-4">
                {currentCategory !== "general" && (
                  <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full border mb-3 ${CATEGORY_CONFIG[currentCategory].color}`}>
                    {CATEGORY_CONFIG[currentCategory].icon} {CATEGORY_CONFIG[currentCategory].label}
                  </span>
                )}
                <h2 className="text-2xl font-bold text-gray-800" style={{ fontFamily: 'Lora, serif' }}>Docent Admin</h2>
                <p className="text-gray-500 mt-2 mb-6" style={{ fontFamily: 'Inter, sans-serif' }}>Manage museums, galleries, exhibits, tours, reviews, users, and content.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {["Show platform stats", "List all SF museums", "Recent reviews", "List journal entries"].map(q => (
                    <button key={q} onClick={() => { setInput(q); sendMessage(q) }}
                      className="px-3 py-1.5 text-sm border border-gray-200 rounded-full hover:bg-gray-50 text-gray-600"
                      style={{ fontFamily: 'Inter, sans-serif' }}>{q}</button>
                  ))}
                </div>
              </div>
              <div className="px-4 mb-16 max-w-4xl mx-auto w-full">
                <ChatInput input={input} setInput={setInput} handleSubmit={handleSubmit} isLoading={isLoading} />
              </div>
              <div className="grow" />
            </>
          ) : (
            <>
              <div className="grow overflow-hidden">
                <div className="max-w-4xl mx-auto w-full h-full">
                  <ChatMessages messages={messages} messagesEndRef={messagesEndRef} sessionId={currentSessionId} onFeedbackSubmit={handleFeedbackSubmit} />
                </div>
              </div>
              <div className="flex-none">
                <div className="max-w-4xl mx-auto w-full">
                  <ChatInput input={input} setInput={setInput} handleSubmit={handleSubmit} isLoading={isLoading} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </SidebarProvider>
  )
}
