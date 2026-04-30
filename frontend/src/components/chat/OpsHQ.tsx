"use client"

import { useEffect, useState, useCallback } from "react"
import { ChatCategory, AGENTS } from "./types"
import { Link } from "react-router-dom"
import { LayoutDashboard, BookOpen, Plus, Clock, CheckCircle2, Loader2, AlertCircle, Play, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { createTaskLocal, updateTaskLocal, deleteTaskLocal, onTasksChange, type AgentTaskDoc } from "@/lib/firebase"
import { AgentCoreClient } from "@/lib/agentcore-client"
import type { AgentPattern } from "@/lib/agentcore-client"
import { useAuth as useOidcAuth } from "react-oidc-context"

function getSprintInfo() {
  const now = new Date()
  const jan1 = new Date(now.getFullYear(), 0, 1)
  const weekNum = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return { label: `Sprint ${weekNum} · ${fmt(monday)}–${fmt(sunday)}` }
}

const statusIcon = { queued: Clock, running: Loader2, done: CheckCircle2, failed: AlertCircle }
const statusColor = { queued: "text-gray-400", running: "text-blue-500 animate-spin", done: "text-green-500", failed: "text-red-500" }

interface OpsHQProps {
  onOpenAgent: (category: ChatCategory) => void
  onResumeSession: (sessionId: string, category: ChatCategory) => void
  onLearn: () => void
  sessions: { id: string; category?: ChatCategory; name: string; endDate: string }[]
}

export function OpsHQ({ onOpenAgent, onResumeSession, onLearn, sessions }: OpsHQProps) {
  const [tasks, setTasks] = useState<AgentTaskDoc[]>([])
  const [newTaskAgent, setNewTaskAgent] = useState<ChatCategory | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState("")
  const [expandedTask, setExpandedTask] = useState<string | null>(null)
  const { isAuthenticated, signOut } = useAuth()
  const auth = useOidcAuth()
  const sprint = getSprintInfo()

  // Real-time task listener
  useEffect(() => onTasksChange(setTasks), [])

  const agentKeys: ChatCategory[] = ["dev", "analytics", "content", "qa", "marketing"]

  const runTask = useCallback(async (taskId: string, title: string, agent: ChatCategory) => {
    updateTaskLocal(taskId, { status: "running", startedAt: Math.floor(Date.now() / 1000) })
    try {
      const config = await fetch("/aws-exports.json").then(r => r.json())
      const client = new AgentCoreClient({
        runtimeArn: config.agentRuntimeArn,
        region: config.awsRegion || "us-east-1",
        pattern: (config.agentPattern || "strands-single-agent") as AgentPattern,
      })
      const token = auth.user?.access_token
      if (!token) throw new Error("No auth token")

      const hint = AGENTS[agent].systemHint
      // Direct prompt: tell the agent to pick the right tool immediately, no deliberation
      const prompt = `${hint ? `[Context: ${hint}]\n\n` : ""}TASK: ${title}\n\nPick the single best tool for this task and call it immediately. Do not explain your reasoning first. After the tool returns, summarize the results concisely.`
      let result = ""
      await client.invoke(prompt, taskId, token, event => {
        if (event.type === "text") result += event.content
      }, 600000) // 10 min timeout for tasks
      updateTaskLocal(taskId, { status: "done", result, completedAt: Math.floor(Date.now() / 1000) })
    } catch (e) {
      updateTaskLocal(taskId, { status: "failed", result: e instanceof Error ? e.message : "Unknown error", completedAt: Math.floor(Date.now() / 1000) })
    }
  }, [auth.user?.access_token])

  const addAndRunTask = async (agent: ChatCategory) => {
    if (!newTaskTitle.trim()) return
    const title = newTaskTitle.trim()
    const id = createTaskLocal({ title, agent, status: "queued", createdAt: Math.floor(Date.now() / 1000) })
    setNewTaskTitle("")
    setNewTaskAgent(null)
    runTask(id, title, agent)
  }

  const addTaskOnly = async (agent: ChatCategory) => {
    if (!newTaskTitle.trim()) return
    createTaskLocal({ title: newTaskTitle.trim(), agent, status: "queued", createdAt: Math.floor(Date.now() / 1000) })
    setNewTaskTitle("")
    setNewTaskAgent(null)
  }

  const ageLabel = (ts: number) => {
    const mins = Math.floor((Date.now() / 1000 - ts) / 60)
    return mins < 60 ? `${mins}m` : mins < 1440 ? `${Math.floor(mins / 60)}h` : `${Math.floor(mins / 1440)}d`
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold" style={{ fontFamily: "Lora, serif" }}>Docent HQ</h1>
          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-3 py-1 rounded-full">{sprint.label}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onLearn}><BookOpen className="h-4 w-4 mr-1" /> Learn</Button>
          <Link to="/dashboard"><Button variant="outline" size="sm"><LayoutDashboard className="h-4 w-4 mr-1" /> Dashboard</Button></Link>
          {isAuthenticated && <Button variant="outline" size="sm" onClick={() => signOut()}>Logout</Button>}
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6">
        {/* Agent Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
          {agentKeys.map(key => {
            const agent = AGENTS[key]
            const agentTasks = tasks.filter(t => t.agent === key)
            const activeTasks = agentTasks.filter(t => t.status !== "done")
            const recentSessions = sessions.filter(s => s.category === key).slice(0, 3)

            return (
              <div key={key} className={`rounded-lg border-2 ${agent.borderColor} ${agent.bgColor} p-4 flex flex-col`}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-2xl">{agent.avatar}</span>
                  <div>
                    <p className={`text-sm font-bold ${agent.color}`}>{agent.name}</p>
                    <p className="text-xs text-gray-500">{agent.role}</p>
                  </div>
                </div>

                {activeTasks.length > 0 && <div className="text-xs text-gray-500 mb-2">{activeTasks.length} active</div>}

                <div className="space-y-1.5 mb-3 flex-1">
                  {agentTasks.slice(0, 4).map(task => {
                    const Icon = statusIcon[task.status]
                    return (
                      <div key={task.id}>
                        <div className="flex items-center gap-1.5 group">
                          <Icon className={`h-3 w-3 flex-shrink-0 ${statusColor[task.status]}`} />
                          <button onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                            className={`text-xs truncate flex-1 text-left hover:underline ${task.status === "done" ? "text-gray-400" : "text-gray-700"}`}>{task.title}</button>
                          <div className="hidden group-hover:flex gap-0.5">
                            {task.status === "queued" && <button onClick={() => runTask(task.id, task.title, key)} className="text-blue-400 hover:text-blue-600"><Play className="h-3 w-3" /></button>}
                            <button onClick={() => deleteTaskLocal(task.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
                          </div>
                        </div>
                        {expandedTask === task.id && task.result && (
                          <div className="mt-1 ml-4 p-2 bg-white rounded border text-xs text-gray-600 max-h-32 overflow-y-auto whitespace-pre-wrap">{task.result}</div>
                        )}
                      </div>
                    )
                  })}
                </div>

                {newTaskAgent === key ? (
                  <form onSubmit={e => { e.preventDefault(); addAndRunTask(key) }} className="space-y-1 mb-2">
                    <input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="Describe the task…"
                      className="w-full text-xs border rounded px-2 py-1.5 bg-white" autoFocus />
                    <div className="flex gap-1">
                      <button type="submit" className="text-xs text-blue-600 font-medium px-2 py-0.5 bg-blue-50 rounded hover:bg-blue-100">Run Now</button>
                      <button type="button" onClick={() => addTaskOnly(key)} className="text-xs text-gray-500 px-2 py-0.5 hover:bg-gray-100 rounded">Queue</button>
                      <button type="button" onClick={() => setNewTaskAgent(null)} className="text-xs text-gray-400 px-1">×</button>
                    </div>
                  </form>
                ) : (
                  <button onClick={() => setNewTaskAgent(key)} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 mb-2">
                    <Plus className="h-3 w-3" /> Add task
                  </button>
                )}

                {recentSessions.length > 0 && (
                  <div className="border-t border-gray-200/50 pt-2 mt-auto space-y-1">
                    <p className="text-xs text-gray-400 font-medium mb-1">Recent chats</p>
                    {recentSessions.map(s => (
                      <button key={s.id} onClick={() => onResumeSession(s.id, key)}
                        className="block w-full text-left text-xs text-gray-500 hover:text-gray-800 truncate hover:underline">{s.name}</button>
                    ))}
                  </div>
                )}

                <button onClick={() => onOpenAgent(key)}
                  className={`mt-2 w-full text-xs font-medium py-1.5 rounded border ${agent.borderColor} ${agent.color} hover:opacity-80`}>
                  Open Chat →
                </button>
              </div>
            )
          })}
        </div>

        {/* Active Tasks Table */}
        {tasks.filter(t => t.status !== "done").length > 0 && (
          <div className="bg-white rounded-lg border p-4 mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Active Tasks</h3>
            <div className="space-y-2">
              {tasks.filter(t => t.status !== "done").map(task => {
                const agent = AGENTS[task.agent as ChatCategory] || AGENTS.general
                const Icon = statusIcon[task.status]
                return (
                  <div key={task.id}>
                    <div className="flex items-center gap-3 py-2 px-3 rounded hover:bg-gray-50 group cursor-pointer"
                      onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}>
                      <Icon className={`h-4 w-4 ${statusColor[task.status]}`} />
                      <span className={`text-xs px-2 py-0.5 rounded ${agent.bgColor} ${agent.color} font-medium`}>{agent.avatar} {agent.name}</span>
                      <span className="text-sm text-gray-700 flex-1">{task.title}</span>
                      <span className="text-xs text-gray-400">{ageLabel(task.createdAt)}</span>
                      <div className="hidden group-hover:flex gap-1" onClick={e => e.stopPropagation()}>
                        {task.status === "queued" && <button onClick={() => runTask(task.id, task.title, task.agent as ChatCategory)} className="text-xs text-blue-500 hover:underline">Run</button>}
                        <button onClick={() => deleteTaskLocal(task.id)} className="text-xs text-red-400 hover:underline">Remove</button>
                      </div>
                    </div>
                    {expandedTask === task.id && task.result && (
                      <div className="ml-12 mr-3 mb-2 p-3 bg-gray-50 rounded border text-xs text-gray-600 max-h-48 overflow-y-auto whitespace-pre-wrap">{task.result}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Completed Tasks */}
        {tasks.filter(t => t.status === "done").length > 0 && (
          <div className="bg-white rounded-lg border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Completed ({tasks.filter(t => t.status === "done").length})</h3>
            <div className="space-y-1">
              {tasks.filter(t => t.status === "done").slice(0, 10).map(task => {
                const agent = AGENTS[task.agent as ChatCategory] || AGENTS.general
                return (
                  <div key={task.id}>
                    <div className="flex items-center gap-3 py-1.5 px-3 rounded hover:bg-gray-50 cursor-pointer group"
                      onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}>
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                      <span className="text-xs text-gray-400">{agent.avatar}</span>
                      <span className="text-sm text-gray-500 flex-1">{task.title}</span>
                      <span className="text-xs text-gray-400">{ageLabel(task.createdAt)}</span>
                      <button onClick={e => { e.stopPropagation(); deleteTaskLocal(task.id) }} className="hidden group-hover:block text-xs text-gray-300 hover:text-red-400">×</button>
                    </div>
                    {expandedTask === task.id && task.result && (
                      <div className="ml-12 mr-3 mb-2 p-3 bg-gray-50 rounded border text-xs text-gray-600 max-h-48 overflow-y-auto whitespace-pre-wrap">{task.result}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
