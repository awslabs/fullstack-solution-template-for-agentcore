import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import { resolve } from "path"

const hook = readFileSync(
  resolve(__dirname, "../hooks/useCopilotExamples.tsx"),
  "utf-8"
)

describe("useCopilotExamples — registration smoke test", () => {
  it("imports useTheme", () => {
    expect(hook).toContain("useTheme")
  })

  it("registers pieChart via useComponent", () => {
    expect(hook).toContain('name: "pieChart"')
    expect(hook).toContain("useComponent")
  })

  it("registers barChart via useComponent", () => {
    expect(hook).toContain('name: "barChart"')
  })

  it("registers toggleTheme via useFrontendTool", () => {
    expect(hook).toContain('name: "toggleTheme"')
    expect(hook).toContain("useFrontendTool")
  })

  it("registers default tool renderer via useDefaultRenderTool with ToolReasoning", () => {
    expect(hook).toContain("useDefaultRenderTool")
    expect(hook).toContain("ToolReasoning")
  })

  it("registers scheduleTime via useHumanInTheLoop with MeetingTimePicker", () => {
    expect(hook).toContain('name: "scheduleTime"')
    expect(hook).toContain("useHumanInTheLoop")
    expect(hook).toContain("MeetingTimePicker")
  })
})
