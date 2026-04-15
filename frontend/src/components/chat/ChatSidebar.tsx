"use client"

import { MessageSquare, Plus } from "lucide-react"
import { ChatSession, ChatCategory, CATEGORY_CONFIG } from "./types"
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"

type ChatSidebarProps = {
  sessions: ChatSession[]
  currentSessionId?: string
  onSessionSelect: (session: ChatSession) => void
  onNewChat: (category?: ChatCategory) => void
}

export function ChatSidebar({ sessions, currentSessionId, onSessionSelect, onNewChat }: ChatSidebarProps) {
  const categories: ChatCategory[] = ["general", "features", "analytics", "content"]

  return (
    <Sidebar>
      <SidebarHeader className="p-4 space-y-2">
        <Button onClick={() => onNewChat()} className="w-full justify-start gap-2" size="sm">
          <Plus className="h-4 w-4" /> New Chat
        </Button>
        <div className="flex flex-wrap gap-1">
          {categories.filter(c => c !== "general").map(cat => {
            const cfg = CATEGORY_CONFIG[cat]
            return (
              <button key={cat} onClick={() => onNewChat(cat)}
                className="flex items-center gap-1 px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50">
                <span>{cfg.icon}</span><span>{cfg.label}</span>
              </button>
            )
          })}
        </div>
      </SidebarHeader>
      <SidebarContent>
        {categories.map(cat => {
          const catSessions = sessions.filter(s => (s.category || "general") === cat)
          if (catSessions.length === 0) return null
          const cfg = CATEGORY_CONFIG[cat]
          return (
            <SidebarGroup key={cat}>
              <SidebarGroupLabel>{cfg.icon} {cfg.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {catSessions.map(session => (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton onClick={() => onSessionSelect(session)}
                        isActive={currentSessionId === session.id}
                        className="w-full justify-start gap-2">
                        <MessageSquare className="h-3 w-3" />
                        <span className="truncate text-sm">{session.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
    </Sidebar>
  )
}
