import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TodoList } from "@/components/canvas/TodoList"
import type { Todo } from "@/components/canvas/types"

const SAMPLE_TODOS: Todo[] = [
  {
    id: "1",
    title: "Learn CopilotKit",
    description: "Read the docs",
    emoji: "🎯",
    status: "pending",
  },
  {
    id: "2",
    title: "Build agent",
    description: "Create LangGraph agent",
    emoji: "🚀",
    status: "completed",
  },
]

describe("TodoList", () => {
  it("renders pending todos in the To Do column", () => {
    render(<TodoList todos={SAMPLE_TODOS} onUpdate={vi.fn()} isAgentRunning={false} />)
    expect(screen.getByText("Learn CopilotKit")).toBeDefined()
  })

  it("renders completed todos in the Done column", () => {
    render(<TodoList todos={SAMPLE_TODOS} onUpdate={vi.fn()} isAgentRunning={false} />)
    expect(screen.getByText("Build agent")).toBeDefined()
  })

  it("shows empty state with Add a task button when todos list is empty", () => {
    render(<TodoList todos={[]} onUpdate={vi.fn()} isAgentRunning={false} />)
    expect(screen.getByText("No tasks yet")).toBeDefined()
    expect(screen.getByRole("button", { name: /add your first todo task/i })).toBeDefined()
  })

  it("calls onUpdate with a new pending todo when Add a task is clicked", () => {
    const onUpdate = vi.fn()
    render(<TodoList todos={[]} onUpdate={onUpdate} isAgentRunning={false} />)
    fireEvent.click(screen.getByRole("button", { name: /add your first todo task/i }))
    expect(onUpdate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ title: "New Todo", status: "pending" }),
      ])
    )
  })

  it("disables the Add a task button when the agent is running", () => {
    render(<TodoList todos={[]} onUpdate={vi.fn()} isAgentRunning={true} />)
    const btn = screen.getByRole("button", { name: /add your first todo task/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })
})
