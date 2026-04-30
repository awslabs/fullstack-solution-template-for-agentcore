"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { ChatInput } from "./ChatInput"
import { ChatMessages } from "./ChatMessages"
import { OpsHQ } from "./OpsHQ"
import { LearnDialog } from "./LearnDialog"
import { Message, MessageSegment, ToolCall, ChatSession, ChatCategory, AGENTS } from "./types"

import { useGlobal } from "@/app/context/GlobalContext"
import { AgentCoreClient } from "@/lib/agentcore-client"
import type { AgentPattern } from "@/lib/agentcore-client"
import { submitFeedback } from "@/services/feedbackService"
import { useAuth } from "react-oidc-context"
import { useDefaultTool } from "@/hooks/useToolRenderer"
import { ToolCallDisplay } from "./ToolCallDisplay"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

const SESSIONS_KEY = "docent-admin-sessions"

function loadSessions(): ChatSession[] { try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]") } catch { return [] } }
function saveSessions(s: ChatSession[]) { localStorage.setItem(SESSIONS_KEY, JSON.stringify(s)) }

export default function ChatInterface() {
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentCategory, setCurrentCategory] = useState<ChatCategory>("general")
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [client, setClient] = useState<AgentCoreClient | null>(null)
  const [learnOpen, setLearnOpen] = useState(false)

  const { isLoading, setIsLoading } = useGlobal()
  const auth = useAuth()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useDefaultTool(({ name, args, status, result }) => (
    <ToolCallDisplay name={name} args={args} status={status} result={result} />
  ))

  useEffect(() => {
    fetch("/aws-exports.json").then(r => r.json()).then(config => {
      setClient(new AgentCoreClient({
        runtimeArn: config.agentRuntimeArn,
        region: config.awsRegion || "us-east-1",
        pattern: (config.agentPattern || "strands-single-agent") as AgentPattern,
      }))
    }).catch(e => setError(`Configuration error: ${e.message}`))
  }, [])

  const persistMessages = useCallback((msgs: Message[], sessionId: string) => {
    if (msgs.length === 0 || !sessionId) return
    setSessions(prev => {
      const existing = prev.find(s => s.id === sessionId)
      const firstUserMsg = msgs.find(m => m.role === "user")?.content || "New Chat"
      const name = firstUserMsg.slice(0, 40) + (firstUserMsg.length > 40 ? "…" : "")
      const now = new Date().toISOString()
      let updated: ChatSession[]
      if (existing) {
        updated = prev.map(s => s.id === sessionId ? { ...s, history: msgs, endDate: now } : s)
      } else {
        updated = [{ id: sessionId, name, history: msgs, startDate: now, endDate: now, category: currentCategory }, ...prev]
      }
      saveSessions(updated)
      return updated
    })
  }, [currentCategory])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim() || !client || !currentSessionId) return
    setError(null)
    const userMsg: Message = { role: "user", content: userMessage, timestamp: new Date().toISOString() }
    const assistantMsg: Message = { role: "assistant", content: "", timestamp: new Date().toISOString() }
    const newMessages = [...messages, userMsg, assistantMsg]
    setMessages(newMessages)
    setInput("")
    setIsLoading(true)

    const agent = AGENTS[currentCategory]
    const catHint = agent.systemHint
    const fullPrompt = catHint ? `[Context: ${catHint}]\n\n${userMessage}` : userMessage

    try {
      const accessToken = auth.user?.access_token
      if (!accessToken) throw new Error("Authentication required.")
      const segments: MessageSegment[] = []
      const toolCallMap = new Map<string, ToolCall>()
      const updateMessage = () => {
        const content = segments.filter((s): s is Extract<MessageSegment, { type: "text" }> => s.type === "text").map(s => s.content).join("")
        setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], content, segments: [...segments] }; return u })
      }
      await client.invoke(fullPrompt, currentSessionId, accessToken, event => {
        switch (event.type) {
          case "text": {
            if (segments[segments.length - 1]?.type === "tool") for (const tc of toolCallMap.values()) { if (tc.status === "streaming" || tc.status === "executing") tc.status = "complete" }
            const last = segments[segments.length - 1]
            if (last?.type === "text") last.content += event.content; else segments.push({ type: "text", content: event.content })
            updateMessage(); break
          }
          case "tool_use_start": { const tc: ToolCall = { toolUseId: event.toolUseId, name: event.name, input: "", status: "streaming" }; toolCallMap.set(event.toolUseId, tc); segments.push({ type: "tool", toolCall: tc }); updateMessage(); break }
          case "tool_use_delta": { const tc = toolCallMap.get(event.toolUseId); if (tc) tc.input += event.input; updateMessage(); break }
          case "tool_result": { const tc = toolCallMap.get(event.toolUseId); if (tc) { tc.result = event.result; tc.status = "complete" }; updateMessage(); break }
          case "message": { if (event.role === "assistant") { for (const tc of toolCallMap.values()) { if (tc.status === "streaming") tc.status = "executing" }; updateMessage() }; break }
        }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      setError(`Failed: ${msg}`)
      setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1], content: "Error. Please try again." }; return u })
    } finally { setIsLoading(false) }
  }

  useEffect(() => { if (!isLoading && messages.length > 0 && currentSessionId) persistMessages(messages, currentSessionId) }, [isLoading])

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(input) }

  const handleFeedbackSubmit = async (messageContent: string, feedbackType: "positive" | "negative", comment: string) => {
    const idToken = auth.user?.id_token
    if (!idToken || !currentSessionId) return
    await submitFeedback({ sessionId: currentSessionId, message: messageContent, feedbackType, comment: comment || undefined }, idToken)
  }

  const openAgent = (category: ChatCategory) => {
    const newId = crypto.randomUUID()
    setCurrentSessionId(newId)
    setCurrentCategory(category)
    setMessages([])
    setInput("")
    setError(null)
  }

  const resumeSession = (sessionId: string, category: ChatCategory) => {
    const session = sessions.find(s => s.id === sessionId)
    setCurrentSessionId(sessionId)
    setCurrentCategory(category)
    setMessages(session?.history || [])
    setInput("")
    setError(null)
  }

  const goHome = () => {
    if (messages.length > 0 && currentSessionId) persistMessages(messages, currentSessionId)
    setCurrentSessionId(null)
    setMessages([])
    setError(null)
  }

  const handleLearnSubmit = async (lesson: string, category: string) => {
    if (!client) return
    const accessToken = auth.user?.access_token
    if (!accessToken) return
    await client.invoke(`Use log_lesson to save this lesson: "${lesson}" with category="${category}" and source="user_correction"`, crypto.randomUUID(), accessToken, () => {})
  }

  // Home state — show OpsHQ
  if (!currentSessionId) {
    return (
      <>
        <OpsHQ onOpenAgent={openAgent} onResumeSession={resumeSession} onLearn={() => setLearnOpen(true)} sessions={sessions} />
        <LearnDialog open={learnOpen} onClose={() => setLearnOpen(false)} onSubmit={handleLearnSubmit} />
      </>
    )
  }

  // Chat state — active agent conversation
  const agent = AGENTS[currentCategory]

  return (
    <div className="flex flex-col h-screen">
      {/* Agent Chat Header */}
      <header className={`flex items-center gap-3 px-4 py-3 border-b ${agent.bgColor}`}>
        <Button variant="ghost" size="sm" onClick={goHome}><ArrowLeft className="h-4 w-4" /></Button>
        <span className="text-xl">{agent.avatar}</span>
        <div>
          <p className={`text-sm font-bold ${agent.color}`}>{agent.name}</p>
          <p className="text-xs text-gray-500">{agent.role}</p>
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => setLearnOpen(true)}>📝 Learn</Button>
      </header>

      {error && <div className="bg-red-50 border-l-4 border-red-500 p-3 mx-4 mt-2"><p className="text-sm text-red-700">{error}</p></div>}

      {/* Messages or empty state */}
      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <span className="text-4xl mb-3">{agent.avatar}</span>
          <p className={`text-lg font-bold ${agent.color}`}>{agent.name}</p>
          <p className="text-sm text-gray-500 mb-6">{agent.role}</p>
          <div className="flex flex-wrap justify-center gap-2 max-w-lg">
            {agent.quickActions.map(q => (
              <button key={q} onClick={() => { setInput(q); sendMessage(q) }}
                className={`px-3 py-1.5 text-xs rounded-full border ${agent.borderColor} ${agent.bgColor} ${agent.color} hover:opacity-80`}>{q}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <div className="max-w-4xl mx-auto w-full h-full">
            <ChatMessages messages={messages} messagesEndRef={messagesEndRef} sessionId={currentSessionId} onFeedbackSubmit={handleFeedbackSubmit} />
          </div>
        </div>
      )}

      <div className="flex-none max-w-4xl mx-auto w-full">
        <ChatInput input={input} setInput={setInput} handleSubmit={handleSubmit} isLoading={isLoading} />
      </div>

      <LearnDialog open={learnOpen} onClose={() => setLearnOpen(false)} onSubmit={handleLearnSubmit} />
    </div>
  )
}
