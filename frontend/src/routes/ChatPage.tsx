"use client"

import ChatInterface from "@/components/chat/ChatInterface"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { GlobalContextProvider } from "@/app/context/GlobalContext"

export default function ChatPage() {
  const { isAuthenticated, signIn } = useAuth()

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <h1 className="text-3xl font-bold" style={{ fontFamily: 'Lora, serif' }}>Docent HQ</h1>
        <p className="text-gray-500">Sign in to manage the Docent platform</p>
        <Button onClick={() => signIn()}>Sign In</Button>
      </div>
    )
  }

  return (
    <GlobalContextProvider>
      <ChatInterface />
    </GlobalContextProvider>
  )
}
