import { initializeApp } from "firebase/app"
import { getFirestore, collection, getDocs, query, orderBy, limit, where } from "firebase/firestore"

const app = initializeApp({
  projectId: "docent-76d5a",
  apiKey: "AIzaSyBxYfNRHqRvCvHGfaHnRVfFJOqwINOqKMo",
  authDomain: "docent-76d5a.firebaseapp.com",
})

const db = getFirestore(app)

export async function getCollectionCount(col: string): Promise<number> {
  try {
    const snap = await getDocs(collection(db, col))
    return snap.size
  } catch {
    return 0
  }
}

export async function getStats() {
  const publicCols = ["reviews", "tours", "museums", "galleries", "exhibits"]
  const counts = await Promise.all(publicCols.map(c => getCollectionCount(c)))
  const stats = Object.fromEntries(publicCols.map((c, i) => [c, counts[i]]))
  // Users requires auth — derive from unique review authors
  const reviewSnap = await getDocs(query(collection(db, "reviews"), orderBy("createdAt", "desc"), limit(500)))
  const uniqueAuthors = new Set(reviewSnap.docs.map(d => d.data().userId).filter(Boolean))
  stats.uniqueReviewers = uniqueAuthors.size
  stats.users = await getCollectionCount("users") || 0
  return stats
}

export interface ReviewDoc {
  targetName?: string
  targetType?: string
  rating?: number
  displayName?: string
  createdAt?: number
  text?: string
  userId?: string
}

export async function getReviews(max = 100): Promise<ReviewDoc[]> {
  const q = query(collection(db, "reviews"), orderBy("createdAt", "desc"), limit(max))
  const snap = await getDocs(q)
  return snap.docs.map(d => d.data() as ReviewDoc)
}

export async function getRecentActivity(days: number) {
  const startTs = Math.floor((Date.now() - days * 86400000) / 1000)
  const [users, reviews] = await Promise.all([
    getDocs(query(collection(db, "users"), where("createdAt", ">=", startTs))).catch(() => ({ docs: [] })),
    getDocs(query(collection(db, "reviews"), where("createdAt", ">=", startTs))),
  ])

  const daily: Record<string, { users: number; reviews: number }> = {}
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 86400000)
    const key = d.toISOString().slice(0, 10)
    daily[key] = { users: 0, reviews: 0 }
  }

  for (const doc of users.docs) {
    const ts = doc.data().createdAt
    if (ts) { const key = new Date(ts * 1000).toISOString().slice(0, 10); if (daily[key]) daily[key].users++ }
  }
  for (const doc of reviews.docs) {
    const ts = doc.data().createdAt
    if (ts) { const key = new Date(ts * 1000).toISOString().slice(0, 10); if (daily[key]) daily[key].reviews++ }
  }

  return Object.entries(daily).map(([date, d]) => ({ date: date.slice(5), ...d }))
}

// ── Review Queue Digest (server-side aggregated) ──

export interface ReviewQueueDigest {
  counts: {
    pendingReports: number
    pendingScrapeDrafts: number
    openAuditFlags: number
    pendingTriage: number
  }
  severityBreakdown: { high: number; medium: number; low: number }
  topFlagTypes: { flag: string; count: number }[]
  recentScrapeDrafts: {
    id: string
    title: string
    venueId: string
    quality: string
    proposedAction: string
    createdAt: number
  }[]
  recentAuditFlags: {
    id: string
    type: string
    venueName: string
    venueId: string
    flags: string[]
    severity: string
    createdAt: number
  }[]
  recentTriage: {
    id: string
    targetType: string
    targetName: string
    category: string
    confidence: string
    hasProposal: boolean
    createdAt: number
  }[]
  generatedAt: number
}

export async function getReviewQueueDigest(): Promise<ReviewQueueDigest | null> {
  try {
    const res = await fetch("https://us-central1-docent-76d5a.cloudfunctions.net/getReviewQueueDigest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: {} }),
    })
    if (!res.ok) return null
    const json = await res.json()
    return json.result as ReviewQueueDigest
  } catch (e) {
    console.error("getReviewQueueDigest failed:", e)
    return null
  }
}

// ── Ticket Click Analytics ──

export interface TicketClickDoc {
  venueId: string
  venueName: string
  url: string
  source: string
  ts: { seconds: number } | null
  referrer?: string
}

export async function getTicketClicks(): Promise<TicketClickDoc[]> {
  try {
    const snap = await getDocs(collection(db, "ticketClicks"))
    return snap.docs.map(d => ({ ...d.data() } as TicketClickDoc))
  } catch { return [] }
}

// ── Agent Tasks (via agent backend — admin SDK bypasses rules) ──

export interface AgentTaskDoc {
  id: string
  title: string
  agent: string
  status: "queued" | "running" | "done" | "failed"
  result?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
}

// Local cache with Firestore sync via agent
const TASKS_KEY = "docent-ops-tasks"
function loadLocalTasks(): AgentTaskDoc[] { try { return JSON.parse(localStorage.getItem(TASKS_KEY) || "[]") } catch { return [] } }
function saveLocalTasks(t: AgentTaskDoc[]) { localStorage.setItem(TASKS_KEY, JSON.stringify(t)) }

let tasksCache = loadLocalTasks()
let taskListeners: ((tasks: AgentTaskDoc[]) => void)[] = []

function notifyListeners() { taskListeners.forEach(cb => cb([...tasksCache])) }

export function createTaskLocal(task: Omit<AgentTaskDoc, "id">): string {
  const id = crypto.randomUUID()
  tasksCache = [{ ...task, id }, ...tasksCache]
  saveLocalTasks(tasksCache)
  notifyListeners()
  return id
}

export function updateTaskLocal(id: string, data: Partial<AgentTaskDoc>) {
  tasksCache = tasksCache.map(t => t.id === id ? { ...t, ...data } : t)
  saveLocalTasks(tasksCache)
  notifyListeners()
}

export function deleteTaskLocal(id: string) {
  tasksCache = tasksCache.filter(t => t.id !== id)
  saveLocalTasks(tasksCache)
  notifyListeners()
}

export function getTasksLocal(): AgentTaskDoc[] { return [...tasksCache] }

export function onTasksChange(callback: (tasks: AgentTaskDoc[]) => void) {
  taskListeners.push(callback)
  callback([...tasksCache])
  return () => { taskListeners = taskListeners.filter(cb => cb !== callback) }
}
