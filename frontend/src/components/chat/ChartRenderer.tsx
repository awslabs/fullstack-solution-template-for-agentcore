"use client"

import { useMemo } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, CartesianGrid } from "recharts"

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe", "#818cf8", "#4f46e5"]

interface ChartData {
  type: "bar" | "pie" | "line"
  data: Record<string, unknown>[]
  xKey: string
  yKey: string
  title?: string
}

function tryParseChart(text: string): ChartData | null {
  // Look for ```chart ... ``` blocks
  const match = text.match(/```chart\s*\n([\s\S]*?)\n```/)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch { return null }
}

function ChartBlock({ chart }: { chart: ChartData }) {
  return (
    <div className="my-4 p-4 bg-gray-50 rounded-lg border">
      {chart.title && <p className="text-sm font-medium text-gray-700 mb-3">{chart.title}</p>}
      <ResponsiveContainer width="100%" height={280}>
        {chart.type === "pie" ? (
          <PieChart>
            <Pie data={chart.data} dataKey={chart.yKey} nameKey={chart.xKey} cx="50%" cy="50%" outerRadius={100} label={({ name, value }) => `${name}: ${value}`}>
              {chart.data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        ) : chart.type === "line" ? (
          <LineChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={chart.xKey} tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Line type="monotone" dataKey={chart.yKey} stroke="#6366f1" strokeWidth={2} />
          </LineChart>
        ) : (
          <BarChart data={chart.data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={chart.xKey} tick={{ fontSize: 12 }} angle={-30} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Bar dataKey={chart.yKey} fill="#6366f1" radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

export function ChartRenderer({ content }: { content: string }) {
  const chart = useMemo(() => tryParseChart(content), [content])
  if (!chart) return null
  return <ChartBlock chart={chart} />
}

export function renderContentWithCharts(content: string): { text: string; charts: ChartData[] } {
  const charts: ChartData[] = []
  const text = content.replace(/```chart\s*\n([\s\S]*?)\n```/g, (match, json) => {
    try {
      charts.push(JSON.parse(json))
      return "" // Remove chart block from text
    } catch { return match }
  })
  return { text: text.trim(), charts }
}
