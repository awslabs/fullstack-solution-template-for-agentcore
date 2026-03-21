import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { MeetingTimePicker } from "@/components/generative-ui/MeetingTimePicker"

describe("MeetingTimePicker", () => {
  it("renders the scheduling prompt and reason when status is executing", () => {
    render(
      <MeetingTimePicker
        status="executing"
        respond={vi.fn()}
        reasonForScheduling="Learn about CopilotKit"
      />
    )
    expect(screen.getByText("Learn about CopilotKit")).toBeDefined()
    expect(screen.getByText("Select a time that works for you")).toBeDefined()
  })

  it("calls respond with the selected slot text when a time slot is clicked", () => {
    const respond = vi.fn()
    render(<MeetingTimePicker status="executing" respond={respond} />)
    // Default first slot is "Tomorrow"
    fireEvent.click(screen.getByText("Tomorrow"))
    expect(respond).toHaveBeenCalledWith(expect.stringContaining("Tomorrow"))
  })

  it("shows confirmation state after selecting a slot", () => {
    render(<MeetingTimePicker status="executing" respond={vi.fn()} />)
    fireEvent.click(screen.getByText("Tomorrow"))
    expect(screen.getByText("Meeting Scheduled")).toBeDefined()
  })

  it("shows declined state when 'None of these work' is clicked", () => {
    const respond = vi.fn()
    render(<MeetingTimePicker status="executing" respond={respond} />)
    fireEvent.click(screen.getByText("None of these work"))
    expect(screen.getByText("No Time Selected")).toBeDefined()
    expect(respond).toHaveBeenCalledWith(expect.stringContaining("declined"))
  })

  it("does not render time slots when status is inProgress", () => {
    render(<MeetingTimePicker status="inProgress" respond={vi.fn()} />)
    expect(screen.queryByText("None of these work")).toBeNull()
  })
})
