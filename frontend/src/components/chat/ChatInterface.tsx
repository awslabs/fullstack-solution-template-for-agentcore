"use client"

import { useEffect, useRef, useState } from "react"
import { ChatHeader } from "./ChatHeader"
import { ChatInput } from "./ChatInput"
import { ChatMessages } from "./ChatMessages"
import { Message } from "./types"

import { useGlobal } from "@/app/context/GlobalContext"

/**
 * REMOVE THIS FUNCTION WHEN YOU'RE READY TO INTEGRATE WITH YOUR BACKEND!
 * This is a mock function to simulate a delay in the response from the backend.
 */
const sleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default function ChatInterface() {
  // State for chat messages and user input
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")

  const { isLoading, setIsLoading } = useGlobal()

  // Ref for message container to enable auto-scrolling
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  // Mock function to simulate sending a message to backend
  const sendMessage = async (userMessage: string) => {
    if (!userMessage.trim()) return

    // Add user message to chat
    const newUserMessage: Message = {
      role: "user",
      content: userMessage,
      timestamp: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, newUserMessage])
    setInput("")
    setIsLoading(true)

    // Simulate API delay
    await sleep(5000)

    // Mock assistant response
    const assistantResponse: Message = {
      role: "assistant",
      content: `This is a mock response to: "${userMessage}". In a real implementation, this would be replaced with an actual API call to your GenAI backend.`,
      timestamp: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, assistantResponse])
    setIsLoading(false)
  }

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    sendMessage(input)
  }

  // Start a new chat
  const startNewChat = () => {
    setMessages([])
    setInput("")
  }

  // Check if this is the initial state (no messages)
  const isInitialState = messages.length === 0

  // Check if there are any assistant messages
  const hasAssistantMessages = messages.some((message) => message.role === "assistant")

  return (
    <div className="flex flex-col h-screen w-full">
      {/* Fixed header */}
      <div className="flex-none">
        <ChatHeader onNewChat={startNewChat} canStartNewChat={hasAssistantMessages} />
      </div>

      {/* Conditional layout based on whether there are messages */}
      {isInitialState ? (
        // Initial state - input in the middle
        <>
          {/* Empty space above */}
          <div className="grow" />

          {/* Centered welcome message */}
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800">Welcome to GASP Chat</h2>
            <p className="text-gray-600 mt-2">Ask me anything to get started</p>
          </div>

          {/* Centered input */}
          <div className="px-4 mb-16 max-w-4xl mx-auto w-full">
            <ChatInput
              input={input}
              setInput={setInput}
              handleSubmit={handleSubmit}
              isLoading={isLoading}
            />
          </div>

          {/* Empty space below */}
          <div className="grow" />
        </>
      ) : (
        // Chat in progress - normal layout
        <>
          {/* Scrollable message area */}
          <div className="grow overflow-hidden">
            <div className="max-w-4xl mx-auto w-full h-full">
              <ChatMessages messages={messages} messagesEndRef={messagesEndRef} />
            </div>
          </div>

          {/* Fixed input area at bottom */}
          <div className="flex-none">
            <div className="max-w-4xl mx-auto w-full">
              <ChatInput
                input={input}
                setInput={setInput}
                handleSubmit={handleSubmit}
                isLoading={isLoading}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
