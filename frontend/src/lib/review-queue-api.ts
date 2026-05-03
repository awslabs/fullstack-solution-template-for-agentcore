// Client for the review queue HTTP API.
// All requests include a Bearer token from Cognito.

const BASE = "https://us-central1-docent-76d5a.cloudfunctions.net"

export interface ScrapeDraft {
  id: string
  venueId: string
  venueType: "museum" | "gallery"
  title: string
  artist?: string
  description?: string
  url?: string
  startDate?: number
  startDateLocal?: string
  endDate?: number
  endDateLocal?: string
  imageUrl?: string
  quality: "high" | "medium" | "low"
  issues?: string[]
  proposedAction: "create" | "update"
  targetExhibitId?: string | null
  source: "scraper" | "manual-admin"
  scraperVenue?: string
  locationHint?: string
  status: "pending" | "approved" | "rejected" | "published"
  createdAt: number
  rejectedAt?: number
  rejectedBy?: string
  rejectionReason?: string
}

export interface AuditFlag {
  id: string
  type: "museum" | "gallery" | "exhibit"
  venueId?: string
  exhibitId?: string
  venueName?: string
  exhibitTitle?: string
  flags: string[]
  severity: "high" | "medium" | "low"
  status: "open" | "in-progress" | "resolved" | "stale"
  detail?: string
  createdAt: number
}

async function request<T>(path: string, token: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).error || msg } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export async function listScrapeDrafts(
  token: string,
  opts: { venue?: string; status?: string; limit?: number } = {},
): Promise<{ drafts: ScrapeDraft[]; total: number }> {
  const params = new URLSearchParams()
  if (opts.venue) params.set("venue", opts.venue)
  if (opts.status) params.set("status", opts.status)
  if (opts.limit) params.set("limit", String(opts.limit))
  const q = params.toString() ? `?${params.toString()}` : ""
  return request(`/listScrapeDrafts${q}`, token)
}

export async function listAuditFlags(
  token: string,
  opts: { severity?: string; status?: string; limit?: number } = {},
): Promise<{ flags: AuditFlag[] }> {
  const params = new URLSearchParams()
  if (opts.severity) params.set("severity", opts.severity)
  if (opts.status) params.set("status", opts.status)
  if (opts.limit) params.set("limit", String(opts.limit))
  const q = params.toString() ? `?${params.toString()}` : ""
  return request(`/listAuditFlags${q}`, token)
}

export async function approveScrapeDraft(
  token: string,
  draftId: string,
  edits?: Record<string, unknown>,
): Promise<{ ok: true; result: unknown }> {
  return request("/approveScrapeDraft", token, {
    method: "POST",
    body: JSON.stringify({ draftId, edits }),
  })
}

export async function rejectScrapeDraft(
  token: string,
  draftId: string,
  reason?: string,
): Promise<{ ok: true }> {
  return request("/rejectScrapeDraft", token, {
    method: "POST",
    body: JSON.stringify({ draftId, reason }),
  })
}

export async function bulkApproveScrapeDrafts(
  token: string,
  draftIds: string[],
): Promise<{ ok: true; total: number; succeeded: number; results: Array<{ draftId: string; ok: boolean; error?: string }> }> {
  return request("/bulkApproveScrapeDrafts", token, {
    method: "POST",
    body: JSON.stringify({ draftIds }),
  })
}
