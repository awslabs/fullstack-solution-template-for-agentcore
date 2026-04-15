export type MessageRole = "user" | "assistant"
export type ToolCallStatus = "streaming" | "executing" | "complete"
export type ChatCategory = "general" | "features" | "analytics" | "content"

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

export const CATEGORY_CONFIG: Record<ChatCategory, { label: string; icon: string; color: string; systemHint: string }> = {
  general: { label: "General", icon: "💬", color: "text-gray-500", systemHint: "" },
  features: { label: "Features / Dev", icon: "🛠", color: "text-blue-500", systemHint: "Focus on development tasks, bug fixes, feature requests, and code changes for the Docent platform." },
  analytics: { label: "Analytics", icon: "📊", color: "text-green-500", systemHint: "Focus on data analysis, metrics, user behavior, and platform statistics. When presenting data, format it as tables or suggest visualizations." },
  content: { label: "Content", icon: "✏️", color: "text-purple-500", systemHint: "Focus on content management: journal entries, exhibit descriptions, museum info, tours, and editorial work." },
}
