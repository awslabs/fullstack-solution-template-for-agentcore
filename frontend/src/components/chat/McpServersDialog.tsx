"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { fetchMcpServers, saveMcpServers, type McpServer } from "@/services/mcpServerService"
import { useAuth } from "@/hooks/useAuth"

interface McpServersDialogProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Settings dialog listing the deployment's MCP servers with per-user on/off
 * toggles. Saved preferences take effect on the user's next message.
 */
export function McpServersDialog({ isOpen, onClose }: McpServersDialogProps) {
  const { token } = useAuth()
  const [servers, setServers] = useState<McpServer[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen || !token) return
    setIsLoading(true)
    setError(null)
    fetchMcpServers(token)
      .then(setServers)
      .catch(() => setError("Failed to load MCP servers."))
      .finally(() => setIsLoading(false))
  }, [isOpen, token])

  const toggle = (id: string) => {
    setServers(prev => prev.map(s => (s.id === id ? { ...s, enabled: !s.enabled } : s)))
  }

  const handleSave = async () => {
    if (!token) return
    setIsSaving(true)
    setError(null)
    try {
      await saveMcpServers(
        servers.filter(s => s.enabled).map(s => s.id),
        token
      )
      onClose()
    } catch {
      setError("Failed to save preferences.")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>MCP Servers</DialogTitle>
          <DialogDescription>
            Choose which tool servers the assistant can use. Changes apply to your next message.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-72 overflow-y-auto">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && servers.length === 0 && !error && (
            <p className="text-sm text-muted-foreground">
              No additional MCP servers are configured for this deployment.
            </p>
          )}
          {servers.map(server => (
            <label
              key={server.id}
              className="flex items-start gap-3 rounded-md border p-3 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={server.enabled}
                onChange={() => toggle(server.id)}
                className="mt-1 h-4 w-4 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium">{server.name}</span>
                {server.description && (
                  <span className="block text-xs text-muted-foreground">{server.description}</span>
                )}
              </span>
            </label>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isLoading || servers.length === 0}
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
