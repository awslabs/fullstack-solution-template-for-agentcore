import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Plus, Settings } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { McpServersDialog } from "./McpServersDialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

type ChatHeaderProps = {
  title?: string | undefined
  onNewChat: () => void
  canStartNewChat: boolean
}

export function ChatHeader({ title, onNewChat, canStartNewChat }: ChatHeaderProps) {
  const { isAuthenticated, signOut } = useAuth()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  return (
    <header className="flex items-center justify-between p-4 border-b w-full">
      <div className="flex items-center">
        <h1 className="text-xl font-bold">{title || "Fullstack AgentCore Solution Template"}</h1>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={onNewChat} variant="outline" className="gap-2" disabled={!canStartNewChat}>
          <Plus className="h-4 w-4" />
          New Chat
        </Button>
        {isAuthenticated && (
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label="MCP server settings"
              onClick={() => setIsSettingsOpen(true)}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <McpServersDialog isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
          </>
        )}
        {isAuthenticated && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Logout</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Logout</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to log out? You will need to sign in again to access your
                  account.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => signOut()}>Confirm</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </header>
  )
}
