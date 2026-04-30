import { Button } from "@/components/ui/button"
import { Plus, LayoutDashboard } from "lucide-react"
import { Link } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

type ChatHeaderProps = { title?: string; onNewChat: () => void; canStartNewChat: boolean }

export function ChatHeader({ title, onNewChat, canStartNewChat }: ChatHeaderProps) {
  const { isAuthenticated, signOut } = useAuth()

  return (
    <header className="flex items-center justify-between p-4 border-b w-full">
      <h1 className="text-xl font-bold">{title || "Docent Admin"}</h1>
      <div className="flex items-center gap-2">
        <Link to="/dashboard">
          <Button variant="outline" size="sm"><LayoutDashboard className="h-4 w-4 mr-1" /> Dashboard</Button>
        </Link>
        <Button onClick={onNewChat} variant="outline" className="gap-2" disabled={!canStartNewChat}>
          <Plus className="h-4 w-4" /> New Chat
        </Button>
        {isAuthenticated && (
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="outline">Logout</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirm Logout</AlertDialogTitle>
                <AlertDialogDescription>Are you sure you want to log out?</AlertDialogDescription>
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
