"use client"

import { useEffect, useState } from "react"
import { useAuth } from "react-oidc-context"
import { AgentCoreClient } from "@/lib/agentcore-client"
import type { AgentPattern } from "@/lib/agentcore-client"

interface Stats {
  users?: number
  reviews?: number
  tours?: number
  museums?: number
  galleries?: number
  exhibits?: number
}

export function StatsCards() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const auth = useAuth()

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/aws-exports.json")
        const config = await res.json()
        const client = new AgentCoreClient({
          runtimeArn: config.agentRuntimeArn,
          region: config.awsRegion || "us-east-1",
          pattern: (config.agentPattern || "strands-single-agent") as AgentPattern,
        })
        const token = auth.user?.access_token
        if (!token) return

        let result = ""
        await client.invoke(
          "Run get_stats and return ONLY the raw JSON object, nothing else.",
          crypto.randomUUID(),
          token,
          event => { if (event.type === "text") result += event.content }
        )
        const match = result.match(/\{[^}]+\}/)
        if (match) setStats(JSON.parse(match[0]))
      } catch (e) {
        console.error("Stats fetch failed:", e)
      } finally {
        setLoading(false)
      }
    }
    if (auth.user?.access_token) fetchStats()
  }, [auth.user?.access_token])

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-3 w-full max-w-2xl mx-auto mb-8">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 bg-gray-50 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (!stats) return null

  const cards = [
    { label: "Users", value: stats.users },
    { label: "Reviews", value: stats.reviews },
    { label: "Tours", value: stats.tours },
    { label: "Museums", value: stats.museums },
    { label: "Galleries", value: stats.galleries },
    { label: "Exhibits", value: stats.exhibits },
  ]

  return (
    <div className="grid grid-cols-3 gap-3 w-full max-w-2xl mx-auto mb-8">
      {cards.map(c => (
        <div key={c.label} className="bg-gray-50 rounded-lg p-3 text-center">
          <p className="text-2xl font-semibold text-gray-800">{c.value ?? "—"}</p>
          <p className="text-xs text-gray-500 mt-0.5">{c.label}</p>
        </div>
      ))}
    </div>
  )
}
