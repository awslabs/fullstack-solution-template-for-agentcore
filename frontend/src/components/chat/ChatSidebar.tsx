"use client"

import { MessageSquare, Plus } from "lucide-react"
import { ChatSession, ChatCategory, AGENTS } from "./types"
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
  const categories: ChatCategory[] = ["general", "dev", "analytics", "content", "qa", "marketing"]

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <Button onClick={() => onNewChat()} className="w-full justify-start gap-2" size="sm">
          <Plus className="h-4 w-4" /> New Chat
        </Button>
      </SidebarHeader>
      <SidebarContent>
        {categories.map(cat => {
          const catSessions = sessions.filter(s => (s.category || "general") === cat)
          if (catSessions.length === 0) return null
          const agent = AGENTS[cat]
          return (
            <SidebarGroup key={cat}>
              <SidebarGroupLabel>{agent.avatar} {agent.name}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {catSessions.map(session => (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton onClick={() => onSessionSelect(session)} isActive={currentSessionId === session.id} className="w-full justify-start gap-2">
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
