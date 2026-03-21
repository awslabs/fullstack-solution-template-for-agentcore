import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { BarChart } from "@/components/generative-ui/BarChart"

const SAMPLE_DATA = [
  { label: "Engineering", value: 42000 },
  { label: "Marketing", value: 12000 },
  { label: "Infrastructure", value: 8200 },
]

describe("BarChart", () => {
  it("renders title and description", () => {
    render(
      <BarChart title="Expenses" description="By category" data={SAMPLE_DATA} />
    )
    expect(screen.getByText("Expenses")).toBeDefined()
    expect(screen.getByText("By category")).toBeDefined()
  })

  it("renders empty state when data is empty array", () => {
    render(<BarChart title="Empty" description="No data" data={[]} />)
    expect(screen.getByText("No data available")).toBeDefined()
  })

  it("renders empty state when data prop is missing", () => {
    // @ts-expect-error testing missing data
    render(<BarChart title="Empty" description="No data" />)
    expect(screen.getByText("No data available")).toBeDefined()
  })
})
