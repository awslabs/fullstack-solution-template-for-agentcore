"use client"

import { useEffect, useState } from "react"
import { getStats, getReviews, getRecentActivity, getTicketClicks, getReviewQueueDigest, type ReviewDoc, type TicketClickDoc, type ReviewQueueDigest } from "@/lib/firebase"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from "recharts"
import { Link } from "react-router-dom"
import { MessageSquare, RefreshCw, AlertTriangle, FileText, Flag, Inbox } from "lucide-react"
import { Button } from "@/components/ui/button"

const COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#818cf8", "#4f46e5", "#3730a3"]

function formatRelative(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Record<string, number>>({})
  const [reviews, setReviews] = useState<ReviewDoc[]>([])
  const [activity, setActivity] = useState<{ date: string; users: number; reviews: number }[]>([])
  const [clicks, setClicks] = useState<TicketClickDoc[]>([])
  const [queue, setQueue] = useState<ReviewQueueDigest | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setLoading(true)
    Promise.all([getStats(), getReviews(100), getRecentActivity(14), getTicketClicks(), getReviewQueueDigest()])
      .then(([s, r, a, c, q]) => { setStats(s); setReviews(r); setActivity(a); setClicks(c); setQueue(q) })
      .catch(e => console.error("Dashboard fetch failed:", e))
      .finally(() => setLoading(false))
  }, [refreshKey])

  // Venue review distribution
  const venueCounts: Record<string, number> = {}
  reviews.forEach(r => { if (r.targetName) venueCounts[r.targetName] = (venueCounts[r.targetName] || 0) + 1 })
  const venueData = Object.entries(venueCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name: name.length > 20 ? name.slice(0, 18) + "…" : name, count }))

  // Rating distribution
  const ratingCounts = [1, 2, 3, 4, 5].map(r => ({ rating: `${r}★`, count: reviews.filter(rv => rv.rating === r).length }))

  // Review type distribution
  const typeCounts: Record<string, number> = {}
  reviews.forEach(r => { if (r.targetType) typeCounts[r.targetType] = (typeCounts[r.targetType] || 0) + 1 })
  const typeData = Object.entries(typeCounts).map(([name, value]) => ({ name, value }))

  // Top reviewers
  const reviewerCounts: Record<string, number> = {}
  reviews.forEach(r => { if (r.displayName) reviewerCounts[r.displayName] = (reviewerCounts[r.displayName] || 0) + 1 })
  const topReviewers = Object.entries(reviewerCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)

  // Recent reviews
  const recentReviews = reviews.slice(0, 5)

  const kpiCards = [
    { label: stats.users ? "Users" : "Reviewers", value: stats.users || stats.uniqueReviewers || 0, icon: "👤" },
    { label: "Reviews", value: stats.reviews, icon: "✍️" },
    { label: "Museums", value: stats.museums, icon: "🏛" },
    { label: "Galleries", value: stats.galleries, icon: "🖼" },
    { label: "Exhibits", value: stats.exhibits, icon: "🎨" },
    { label: "Tours", value: stats.tours, icon: "🗺" },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold" style={{ fontFamily: "Lora, serif" }}>Docent Dashboard</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setRefreshKey(k => k + 1)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Link to="/">
            <Button variant="outline" size="sm"><MessageSquare className="h-4 w-4 mr-1" /> Chat</Button>
          </Link>
        </div>
      </header>

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {kpiCards.map(c => (
            <div key={c.label} className="bg-white rounded-lg border p-4 text-center">
              <p className="text-2xl mb-1">{c.icon}</p>
              {loading ? <div className="h-8 bg-gray-100 rounded animate-pulse mx-auto w-12" /> : (
                <p className="text-2xl font-bold text-gray-800">{c.value ?? "—"}</p>
              )}
              <p className="text-xs text-gray-500 mt-1">{c.label}</p>
            </div>
          ))}
        </div>

        {/* Review Queue — data-quality items awaiting manual review */}
        <div className="bg-white rounded-lg border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Inbox className="h-4 w-4" /> Review Queue
            </h3>
            {queue && (
              <span className="text-xs text-gray-400">
                Updated {formatRelative(queue.generatedAt)}
              </span>
            )}
          </div>

          {loading ? (
            <div className="h-40 bg-gray-50 rounded animate-pulse" />
          ) : !queue ? (
            <p className="text-sm text-gray-400 py-4">Queue unavailable.</p>
          ) : (
            <>
              {/* Queue counts */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                <div className="bg-indigo-50 rounded p-3">
                  <div className="flex items-center gap-2 text-indigo-700 mb-1">
                    <FileText className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Scrape drafts</span>
                  </div>
                  <p className="text-2xl font-bold text-indigo-900">{queue.counts.pendingScrapeDrafts}</p>
                  <p className="text-[11px] text-indigo-600 mt-0.5">new exhibits to review</p>
                </div>
                <div className="bg-amber-50 rounded p-3">
                  <div className="flex items-center gap-2 text-amber-700 mb-1">
                    <Flag className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Audit flags</span>
                  </div>
                  <p className="text-2xl font-bold text-amber-900">{queue.counts.openAuditFlags}</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">
                    {queue.severityBreakdown.high > 0 && `${queue.severityBreakdown.high} high · `}
                    {queue.severityBreakdown.medium} medium · {queue.severityBreakdown.low} low
                  </p>
                </div>
                <div className="bg-rose-50 rounded p-3">
                  <div className="flex items-center gap-2 text-rose-700 mb-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">User reports</span>
                  </div>
                  <p className="text-2xl font-bold text-rose-900">{queue.counts.pendingReports}</p>
                  <p className="text-[11px] text-rose-600 mt-0.5">awaiting agent triage</p>
                </div>
                <div className="bg-violet-50 rounded p-3">
                  <div className="flex items-center gap-2 text-violet-700 mb-1">
                    <Inbox className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Triaged proposals</span>
                  </div>
                  <p className="text-2xl font-bold text-violet-900">{queue.counts.pendingTriage}</p>
                  <p className="text-[11px] text-violet-600 mt-0.5">ready to approve</p>
                </div>
              </div>

              {/* Top flag types — tells you what's most broken this week */}
              {queue.topFlagTypes.length > 0 && (
                <div className="mb-5">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Most common issues</p>
                  <div className="flex flex-wrap gap-2">
                    {queue.topFlagTypes.map(ft => (
                      <span key={ft.flag} className="inline-flex items-center gap-1.5 text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1">
                        <span>{ft.flag}</span>
                        <span className="font-semibold text-gray-900">{ft.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent activity feed */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Recent scrape drafts</p>
                  {queue.recentScrapeDrafts.length === 0 ? (
                    <p className="text-xs text-gray-400">Nothing new this week</p>
                  ) : (
                    <ul className="space-y-2">
                      {queue.recentScrapeDrafts.slice(0, 5).map(d => (
                        <li key={d.id} className="text-xs border-b last:border-0 pb-1.5">
                          <p className="font-medium text-gray-800 truncate">{d.title}</p>
                          <p className="text-gray-500 mt-0.5">
                            {d.venueId} · <span className={`capitalize ${d.quality === "high" ? "text-green-600" : d.quality === "medium" ? "text-amber-600" : "text-gray-400"}`}>{d.quality}</span> · {formatRelative(d.createdAt)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Recent audit flags</p>
                  {queue.recentAuditFlags.length === 0 ? (
                    <p className="text-xs text-gray-400">Clean this week 🎉</p>
                  ) : (
                    <ul className="space-y-2">
                      {queue.recentAuditFlags.slice(0, 5).map(f => (
                        <li key={f.id} className="text-xs border-b last:border-0 pb-1.5">
                          <p className="font-medium text-gray-800 truncate">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${f.severity === "high" ? "bg-rose-500" : f.severity === "medium" ? "bg-amber-500" : "bg-gray-400"}`} />
                            {f.venueName || f.venueId}
                          </p>
                          <p className="text-gray-500 mt-0.5 truncate">
                            {f.flags.slice(0, 3).join(", ")}{f.flags.length > 3 && ` +${f.flags.length - 3}`}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Recent triage proposals</p>
                  {queue.recentTriage.length === 0 ? (
                    <p className="text-xs text-gray-400">No reports to review</p>
                  ) : (
                    <ul className="space-y-2">
                      {queue.recentTriage.slice(0, 5).map(t => (
                        <li key={t.id} className="text-xs border-b last:border-0 pb-1.5">
                          <p className="font-medium text-gray-800 truncate">{t.targetName}</p>
                          <p className="text-gray-500 mt-0.5">
                            {t.category} · <span className={t.confidence === "high" ? "text-green-600" : t.confidence === "medium" ? "text-amber-600" : "text-gray-400"}>{t.confidence}</span>
                            {!t.hasProposal && <span className="text-gray-400"> · no edit</span>}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg border p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">14-Day Activity</h3>
            {loading ? <div className="h-64 bg-gray-50 rounded animate-pulse" /> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={activity}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="users" fill="#6366f1" name="New Users" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="reviews" fill="#a78bfa" name="New Reviews" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white rounded-lg border p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Reviews by Venue (Top 8)</h3>
            {loading ? <div className="h-64 bg-gray-50 rounded animate-pulse" /> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={venueData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg border p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Rating Distribution</h3>
            {loading ? <div className="h-48 bg-gray-50 rounded animate-pulse" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={ratingCounts}>
                  <XAxis dataKey="rating" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white rounded-lg border p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Review Types</h3>
            {loading ? <div className="h-48 bg-gray-50 rounded animate-pulse" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, value }) => `${name}: ${value}`}>
                    {typeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="bg-white rounded-lg border p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Top Reviewers</h3>
            {loading ? <div className="h-48 bg-gray-50 rounded animate-pulse" /> : (
              <div className="space-y-3">
                {topReviewers.map(([name, count], i) => (
                  <div key={name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-400 w-4">{i + 1}</span>
                      <span className="text-sm text-gray-700">{name}</span>
                    </div>
                    <span className="text-sm font-semibold text-gray-800">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Reviews */}
        <div className="bg-white rounded-lg border p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Recent Reviews</h3>
          {loading ? <div className="h-32 bg-gray-50 rounded animate-pulse" /> : (
            <div className="space-y-3">
              {recentReviews.map((r, i) => (
                <div key={i} className="flex items-start gap-3 pb-3 border-b last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800">{r.displayName || "Anonymous"}</span>
                      <span className="text-xs text-gray-400">→</span>
                      <span className="text-sm text-gray-600 truncate">{r.targetName}</span>
                      {r.rating && <span className="text-xs text-yellow-600">{"★".repeat(r.rating)}</span>}
                    </div>
                    {r.text && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{r.text}</p>}
                  </div>
                  {r.createdAt && (
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {new Date(r.createdAt * 1000).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ticket Clicks — Revenue Pipeline */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg border p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">🎟 Ticket Clicks</h3>
            {loading ? <div className="h-32 bg-gray-50 rounded animate-pulse" /> : (
              <div className="text-center py-4">
                <p className="text-4xl font-bold text-gray-800">{clicks.length}</p>
                <p className="text-xs text-gray-500 mt-1">Total Clicks</p>
                <div className="flex justify-center gap-6 mt-4">
                  <div>
                    <p className="text-lg font-semibold text-gray-700">{clicks.filter(c => c.ts && c.ts.seconds > Date.now() / 1000 - 7 * 86400).length}</p>
                    <p className="text-xs text-gray-400">Last 7 days</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-gray-700">{clicks.filter(c => c.ts && c.ts.seconds > Date.now() / 1000 - 30 * 86400).length}</p>
                    <p className="text-xs text-gray-400">Last 30 days</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-gray-700">{new Set(clicks.map(c => c.venueId)).size}</p>
                    <p className="text-xs text-gray-400">Venues</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Clicks by Venue</h3>
            {loading ? <div className="h-32 bg-gray-50 rounded animate-pulse" /> : (() => {
              const venueCounts: Record<string, number> = {}
              clicks.forEach(c => { venueCounts[c.venueName || c.venueId] = (venueCounts[c.venueName || c.venueId] || 0) + 1 })
              const data = Object.entries(venueCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name: name.length > 25 ? name.slice(0, 23) + "…" : name, count }))
              return data.length === 0 ? (
                <p className="text-sm text-gray-400 py-8 text-center">No ticket clicks yet. Data will appear as users click "Buy Tickets" on venue pages.</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}
