export type MessageRole = "user" | "assistant"
export type ToolCallStatus = "streaming" | "executing" | "complete"
export type ChatCategory = "general" | "dev" | "analytics" | "content" | "qa" | "marketing"

export interface ToolCall {
  toolUseId: string
  name: string
  input: string
  result?: string
  status: ToolCallStatus
}

export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "tool"; toolCall: ToolCall }

export interface Message {
  role: MessageRole
  content: string
  timestamp: string
  segments?: MessageSegment[]
}

export interface ChatSession {
  id: string
  name: string
  history: Message[]
  startDate: string
  endDate: string
  category?: ChatCategory
}

export interface AgentTask {
  id: string
  title: string
  agent: ChatCategory
  status: "queued" | "running" | "done" | "failed"
  createdAt: string
  dueBy?: string
  sessionId?: string
}

export interface AgentPersona {
  key: ChatCategory
  name: string
  role: string
  avatar: string
  color: string
  bgColor: string
  borderColor: string
  systemHint: string
  quickActions: string[]
}

export const AGENTS: Record<ChatCategory, AgentPersona> = {
  general: {
    key: "general",
    name: "Docent HQ",
    role: "Orchestrator",
    avatar: "🎯",
    color: "text-gray-700",
    bgColor: "bg-gray-50",
    borderColor: "border-gray-200",
    systemHint: "",
    quickActions: ["Show platform stats", "What's the sprint status?"],
  },
  dev: {
    key: "dev",
    name: "Dev Dave",
    role: "Engineering",
    avatar: "🛠",
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    systemHint: "Focus on development tasks, CRUD operations, data changes, and code modifications.",
    quickActions: ["Add a new exhibit", "Update museum hours", "List all SF museums"],
  },
  analytics: {
    key: "analytics",
    name: "Analytics Ada",
    role: "Data & Metrics",
    avatar: "📊",
    color: "text-green-700",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
    systemHint: "Focus on data analysis, metrics, user behavior, and platform statistics.",
    quickActions: ["Weekly activity summary", "Top reviewed venues", "User growth trend"],
  },
  content: {
    key: "content",
    name: "Content Clara",
    role: "Editorial",
    avatar: "✏️",
    color: "text-purple-700",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
    systemHint: "Focus on content management: journal entries, exhibit descriptions, museum info, tours, and editorial work.",
    quickActions: ["Draft exhibit description", "List journal entries", "Review tour content"],
  },
  qa: {
    key: "qa",
    name: "QA Quinn",
    role: "Quality Assurance",
    avatar: "🧪",
    color: "text-orange-700",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-200",
    systemHint: "Focus on data quality: run audits, find missing fields, orphaned records, stale exhibits, and integrity issues.",
    quickActions: ["Run venue health check", "Find stale exhibits", "Audit orphaned exhibits"],
  },
  marketing: {
    key: "marketing",
    name: "Marketing Maria",
    role: "Growth & Outreach",
    avatar: "📣",
    color: "text-pink-700",
    bgColor: "bg-pink-50",
    borderColor: "border-pink-200",
    systemHint: "Focus on marketing: content calendar, outreach tracking, social media, newsletter drafts, campaign planning.",
    quickActions: ["Draft IG caption", "Outreach status", "Newsletter outline"],
  },
}

// Compat export
export const CATEGORY_CONFIG = Object.fromEntries(
  Object.entries(AGENTS).map(([k, v]) => [k, { label: v.name, icon: v.avatar, color: v.color, systemHint: v.systemHint }])
) as Record<ChatCategory, { label: string; icon: string; color: string; systemHint: string }>
