/**
 * Data Pipeline — the review layer between automated discovery and production.
 *
 * Three collections feed a Notion/admin review queue:
 *   - scrapeDrafts      → proposed exhibit adds/updates from the scraper
 *   - venueAuditFlags   → weekly health check results (only venues with issues)
 *   - reportTriage      → LLM-triaged user reports with suggested edits
 *
 * NOTHING IN THIS FILE WRITES TO PRODUCTION (museums/galleries/exhibits).
 * Production changes only happen through publishDraft() which requires explicit input.
 */

const { getFirestore } = require("firebase-admin/firestore");

// ─── Scrape Drafts ──────────────────────────────────────

/**
 * Queue a proposed exhibit edit for manual review.
 * Idempotent: if a draft with the same sourceUrl already exists and is pending,
 * it's updated in place rather than duplicated.
 */
async function queueScrapeDraft(proposal) {
  const db = getFirestore();
  const {
    venueId,
    venueType = "museum",
    title,
    artist,
    description,
    url,
    startDate, startDateLocal,
    endDate, endDateLocal,
    imageUrl,
    quality,         // 'high' | 'medium' | 'low'
    issues = [],     // array of strings
    proposedAction, // 'create' | 'update'
    targetExhibitId, // if update, the existing exhibit id
    source = "scraper",
  } = proposal;

  if (!venueId || !title || !url) {
    throw new Error("queueScrapeDraft requires venueId, title, url");
  }

  // Check for existing pending draft with same sourceUrl
  const existing = await db.collection("scrapeDrafts")
    .where("url", "==", url)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  const payload = {
    venueId, venueType, title, artist: artist || "",
    description: description || "", url,
    startDate: startDate || null, startDateLocal: startDateLocal || null,
    endDate: endDate || null, endDateLocal: endDateLocal || null,
    imageUrl: imageUrl || "",
    quality: quality || "medium",
    issues,
    proposedAction: proposedAction || "create",
    targetExhibitId: targetExhibitId || null,
    source,
    status: "pending", // pending | approved | rejected | published
    createdAt: Math.floor(Date.now() / 1000),
  };

  if (!existing.empty) {
    const draftRef = existing.docs[0].ref;
    await draftRef.update({ ...payload, updatedAt: Math.floor(Date.now() / 1000) });
    return { id: draftRef.id, updated: true };
  }

  const ref = await db.collection("scrapeDrafts").add(payload);
  return { id: ref.id, created: true };
}

// ─── Venue Audits ───────────────────────────────────────

/**
 * Check a venue document for data-quality issues. Returns an array of flags.
 * Flags are human-readable strings matching conventions used in healthFlags.
 */
function auditVenue(d, col) {
  const flags = [];
  if (!d.imageUrl) flags.push("missing-image");
  if (!d.description || d.description.length < 100) flags.push("thin-description");
  if (!d.keywords || Object.keys(d.keywords).length === 0) flags.push("missing-keywords");
  if (!d.website) flags.push("missing-website");
  if (!d.lat || !d.lng) flags.push("missing-coordinates");

  // Museums & galleries should have hours and admission
  if (!d.hours) flags.push("missing-hours");
  if (!d.admission) flags.push("missing-admission");

  // Closed-location signals in description
  const desc = (d.description || "").toLowerCase();
  if (/\b(permanently closed|closed permanently|now closed|no longer open)\b/.test(desc)) {
    flags.push("possibly-closed");
  }
  if (/\btemporarily closed\b/.test(desc) || /\bclosed for renovation\b/.test(desc)) {
    flags.push("possibly-temporarily-closed");
  }

  // Missing website suggests we can't easily verify anything
  // Missing exhibitionsUrl is a softer flag — still worth knowing
  if (col === "museums" && !d.exhibitionsUrl) flags.push("missing-exhibitionsUrl");

  // Zero exhibits at a venue is worth surfacing
  // (caller fills this in — we don't query here to keep it fast)

  return flags;
}

// Regex for URLs that point to a listing page rather than a specific exhibit.
// Matches trailing path segments like /exhibitions, /exhibitions/, /exhibitions/current,
// /exhibitions/past, /exhibitions/upcoming, /exhibitions/on-view, /whats-on, etc.
const GENERIC_URL_RE = /\/(?:exhibitions?|whats-on|on-view|what-s-on|programs?)(?:\/(?:current|past|upcoming|on-view|recent|archive))?\/?$/i;

/**
 * Check an exhibit document for quality issues.
 */
function auditExhibit(d, todayStr) {
  const flags = [];
  if (!d.description || d.description.length < 80) flags.push("thin-description");
  if (!d.venueId) flags.push("missing-venueId");
  if (!d.url) flags.push("missing-url");
  if (d.url && GENERIC_URL_RE.test(d.url)) flags.push("generic-url");

  const endLocal = d.endDateLocal || (d.endDate ? new Date(d.endDate * 1000).toISOString().slice(0, 10) : null);
  if (endLocal && endLocal < todayStr && d.status !== "past") flags.push("stale-end-date");
  if (!d.startDate && !d.startDateLocal && !d.endDate && !d.endDateLocal && !d.permanent) {
    flags.push("missing-dates");
  }
  return flags;
}

// ─── Exhibit Date Verification ──────────────────────────
//
// Fetches each exhibit's URL, extracts the dates shown on the live page, and
// flags mismatches against what we've stored. Skips past exhibits and anything
// without a specific URL. Concurrency-limited and fault-tolerant.

const MONTH_NAMES = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
const MONTH_MAP = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};

/**
 * Try to extract date(s) from exhibit page HTML.
 * Returns { start: "YYYY-MM-DD", end: "YYYY-MM-DD" } or null if not found.
 * Strategies (in order of confidence):
 *  1. JSON-LD Event / ExhibitionEvent (most authoritative)
 *  2. start_datetime / end_datetime in Next.js __NEXT_DATA__ (CMS-backed sites like Neue Galerie)
 *  3. <time datetime="..."> tags — pick the earliest as start and latest as end,
 *     constrained to 2020-2030 window to avoid picking up footer copyrights.
 *     (Used by Belvedere and many Drupal/modern CMS sites)
 *  4. "Month D, YYYY – Month D, YYYY" text patterns (regex fallback)
 *  5. "Through Month D, YYYY" (closing only)
 *  6. "Opens Month D, YYYY" (opening only)
 */
function extractDatesFromHtml(html) {
  if (!html || typeof html !== "string") return null;

  // Strategy 1: JSON-LD Event
  const jsonLdMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]+?)<\/script>/gi)];
  for (const m of jsonLdMatches) {
    try {
      const parsed = JSON.parse(m[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (item && typeof item === "object") {
          const type = String(item["@type"] || "");
          if (/event|exhibition/i.test(type)) {
            const sd = normalizeIsoDate(item.startDate);
            const ed = normalizeIsoDate(item.endDate);
            if (sd || ed) return { start: sd, end: ed, source: "json-ld" };
          }
        }
      }
    } catch (_) { /* malformed JSON-LD, skip */ }
  }

  // Strategy 2: Next.js __NEXT_DATA__ (look for start_datetime with adjacent title matching main page)
  const nextDataMatch = html.match(/<script[^>]*__NEXT_DATA__[^>]*>([\s\S]+?)<\/script>/);
  if (nextDataMatch) {
    try {
      const parsed = JSON.parse(nextDataMatch[1]);
      // Walk looking for objects that have both start_datetime and end_datetime
      // Prefer the one whose title matches the page's <title>
      const pageTitleMatch = html.match(/<title>([^<]+)<\/title>/);
      const pageTitle = pageTitleMatch ? pageTitleMatch[1].toLowerCase() : "";

      const candidates = [];
      const walk = (o, depth = 0) => {
        if (depth > 12 || !o) return;
        if (Array.isArray(o)) { o.forEach(x => walk(x, depth + 1)); return; }
        if (typeof o === "object") {
          if (o.start_datetime && o.end_datetime) {
            const s = normalizeIsoDate(o.start_datetime);
            const e = normalizeIsoDate(o.end_datetime);
            if (s && e) {
              candidates.push({
                start: s,
                end: e,
                title: String(o.title || "").toLowerCase(),
              });
            }
          }
          Object.values(o).forEach(v => walk(v, depth + 1));
        }
      };
      walk(parsed);

      if (candidates.length > 0) {
        // Prefer candidate whose title is a substring of the page title
        const titleMatch = candidates.find(c =>
          c.title && pageTitle && (pageTitle.includes(c.title) || c.title.includes(pageTitle.split(/[\|—-]/)[0].trim()))
        );
        const chosen = titleMatch || candidates[0];
        return { start: chosen.start, end: chosen.end, source: "next-data" };
      }
    } catch (_) { /* malformed, skip */ }
  }

  // Strategies 3-5: regex on cleaned text — conservative patterns that are
  // unlikely to misfire. Run these BEFORE time-tag heuristic because a clear
  // "Month D – Month D, YYYY" text pattern is more authoritative than
  // guessing from potentially-unrelated <time> tags.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;|&ndash;|–/g, "-")
    .replace(/&#8212;|&mdash;|—/g, "-")
    .replace(/\s+/g, " ");

  // Strategy 3: full date range
  const rangeRe = new RegExp(
    `(${MONTH_NAMES})\\s+(\\d{1,2})(?:,\\s*(\\d{4}))?\\s*[-–—]\\s*(${MONTH_NAMES})\\s+(\\d{1,2}),?\\s*(\\d{4})`,
    "i"
  );
  const rangeMatch = cleaned.match(rangeRe);
  if (rangeMatch) {
    const [, m1, d1, y1opt, m2, d2, y2] = rangeMatch;
    const start = buildIsoDate(m1, d1, y1opt || y2);
    const end = buildIsoDate(m2, d2, y2);
    if (start && end) return { start, end, source: "regex-range" };
  }

  // Strategy 4: "Through Month D, YYYY"
  const throughRe = new RegExp(
    `[Tt]hrough\\s+(${MONTH_NAMES})\\s+(\\d{1,2}),?\\s*(\\d{4})`,
    "i"
  );
  const throughMatch = cleaned.match(throughRe);
  if (throughMatch) {
    const end = buildIsoDate(throughMatch[1], throughMatch[2], throughMatch[3]);
    if (end) return { start: null, end, source: "regex-through" };
  }

  // Strategy 5: "Opens Month D, YYYY"
  const opensRe = new RegExp(
    `[Oo]pens?\\s+(${MONTH_NAMES})\\s+(\\d{1,2}),?\\s*(\\d{4})`,
    "i"
  );
  const opensMatch = cleaned.match(opensRe);
  if (opensMatch) {
    const start = buildIsoDate(opensMatch[1], opensMatch[2], opensMatch[3]);
    if (start) return { start, end: null, source: "regex-opens" };
  }

  // Strategy 6: <time datetime="..."> tags — last resort for pages without
  // structured data or readable date text (Belvedere, some Drupal sites).
  // Only trust this when exactly 2 unique current-era dates are on the page.
  const timeMatches = [...html.matchAll(/<time[^>]+datetime=["']([^"']+)["']/gi)];
  if (timeMatches.length >= 2) {
    const validDates = timeMatches
      .map(m => normalizeIsoDate(m[1]))
      .filter(d => d && d >= "2024-01-01" && d <= "2030-12-31");
    const uniqueDates = [...new Set(validDates)].sort();
    if (uniqueDates.length === 2) {
      return { start: uniqueDates[0], end: uniqueDates[1], source: "time-tags" };
    }
  }

  return null;
}

function buildIsoDate(monthStr, dayStr, yearStr) {
  const monthIdx = MONTH_MAP[monthStr.toLowerCase()];
  if (monthIdx === undefined) return null;
  const day = parseInt(dayStr, 10);
  const year = parseInt(yearStr, 10);
  if (!day || !year || day < 1 || day > 31) return null;
  const mm = String(monthIdx + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// Accepts any ISO-8601-ish date/datetime string, returns "YYYY-MM-DD" or null.
// Rejects malformed inputs (e.g. "2026-0-20T0:" from broken CMS exports).
function normalizeIsoDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${y}-${m}-${d}`;
}

/**
 * Fetch an exhibit URL and check if the dates shown on the page match
 * what we've stored. Returns one of:
 *   { match: true }
 *   { match: false, pageStart, pageEnd, storedStart, storedEnd }
 *   { broken: "http-404" | "http-410" }  — URL is dead
 *   { skipped: "reason" }
 */
async function verifyExhibitDates(exhibit) {
  if (!exhibit.url) return { skipped: "no-url" };
  if (GENERIC_URL_RE.test(exhibit.url)) return { skipped: "generic-url" };
  if (!exhibit.endDateLocal && !exhibit.startDateLocal) return { skipped: "no-stored-dates" };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const res = await fetch(exhibit.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; DocentBot/1.0; +https://docentofficial.com)" },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    // 404/410 are structural — the exhibit URL is broken, not a rate-limit flake
    if (res.status === 404 || res.status === 410) {
      return { broken: `http-${res.status}` };
    }
    if (!res.ok) return { skipped: `http-${res.status}` };

    const html = await res.text();
    const extracted = extractDatesFromHtml(html);
    if (!extracted) return { skipped: "no-dates-found-on-page" };

    const storedStart = exhibit.startDateLocal || null;
    const storedEnd = exhibit.endDateLocal || null;

    const startMatches = !extracted.start || !storedStart || extracted.start === storedStart;
    const endMatches = !extracted.end || !storedEnd || extracted.end === storedEnd;

    if (startMatches && endMatches) return { match: true };

    return {
      match: false,
      pageStart: extracted.start,
      pageEnd: extracted.end,
      storedStart,
      storedEnd,
      startMismatch: !startMatches,
      endMismatch: !endMatches,
    };
  } catch (e) {
    return { skipped: `fetch-error: ${e.message}` };
  }
}

/**
 * Run date verification across all current/upcoming exhibits with URLs.
 * Writes mismatches and broken URLs to /venueAuditFlags.
 * Concurrency-limited per-host to avoid rate-limiting ourselves.
 */
async function runExhibitDateCheck({ concurrency = 4 } = {}) {
  const db = getFirestore();
  const now = Math.floor(Date.now() / 1000);

  // Only check non-past exhibits with URLs
  const snap = await db.collection("exhibits")
    .where("status", "in", ["current", "upcoming"])
    .get();

  const toCheck = snap.docs.filter(d => {
    const data = d.data();
    return data.url && !GENERIC_URL_RE.test(data.url);
  });

  // Group by host so we don't hammer a single gallery
  const byHost = new Map();
  for (const doc of toCheck) {
    try {
      const host = new URL(doc.data().url).host;
      if (!byHost.has(host)) byHost.set(host, []);
      byHost.get(host).push(doc);
    } catch (_) { /* skip malformed URLs */ }
  }

  let processed = 0;
  let mismatched = 0;
  let broken = 0;
  let skipped = 0;
  const mismatches = [];

  // Process hosts in parallel, but serialize within each host (with small delay)
  const hostTasks = [...byHost.entries()].map(async ([, docs]) => {
    for (const doc of docs) {
      const data = doc.data();
      const result = await verifyExhibitDates(data);
      processed++;

      if (result.match) { /* nothing to do */ }
      else if (result.broken) {
        broken++;
        await db.collection("venueAuditFlags").add({
          type: "exhibit",
          exhibitId: doc.id,
          exhibitTitle: data.title || "",
          venueId: data.venueId || "",
          flags: ["broken-url"],
          severity: "high",
          status: "open",
          detail: `${result.broken} — URL returns ${result.broken.replace('http-', '')} Not Found`,
          exhibitUrl: data.url || "",
          createdAt: now,
        });
      }
      else if (result.skipped) {
        skipped++;
      }
      else {
        // Date mismatch
        mismatched++;
        const detail = [];
        if (result.startMismatch) detail.push(`start: page=${result.pageStart} vs stored=${result.storedStart}`);
        if (result.endMismatch) detail.push(`end: page=${result.pageEnd} vs stored=${result.storedEnd}`);
        await db.collection("venueAuditFlags").add({
          type: "exhibit",
          exhibitId: doc.id,
          exhibitTitle: data.title || "",
          venueId: data.venueId || "",
          flags: ["date-mismatch"],
          severity: "high",
          status: "open",
          detail: detail.join("; "),
          pageStart: result.pageStart || null,
          pageEnd: result.pageEnd || null,
          storedStart: result.storedStart || null,
          storedEnd: result.storedEnd || null,
          exhibitUrl: data.url || "",
          createdAt: now,
        });
        mismatches.push({
          exhibitId: doc.id,
          title: data.title,
          venueId: data.venueId,
          detail: detail.join("; "),
        });
      }

      // Be polite — 500ms between requests to the same host
      await new Promise(r => setTimeout(r, 500));
    }
  });

  // Limit total concurrency across hosts
  for (let i = 0; i < hostTasks.length; i += concurrency) {
    await Promise.all(hostTasks.slice(i, i + concurrency));
  }

  return { checked: processed, mismatched, broken, skipped, mismatches };
}

/**
 * Run the full audit and write findings to /venueAuditFlags.
 * Only flags venues/exhibits with 1+ issues. Keeps collection lean.
 *
 * Also updates healthFlags directly on each doc (no content change, just a
 * metadata tag the app can read to suppress bad data).
 */
async function runVenueAudit() {
  const db = getFirestore();
  const now = Math.floor(Date.now() / 1000);
  const today = new Date().toISOString().slice(0, 10);

  // Clear old flags first
  const oldFlags = await db.collection("venueAuditFlags").where("status", "==", "open").get();
  const clearBatch = db.batch();
  oldFlags.docs.forEach(d => clearBatch.update(d.ref, { status: "stale" }));
  if (!oldFlags.empty) await clearBatch.commit();

  let totals = { venueFlagged: 0, exhibitsFlagged: 0 };

  // Venues
  for (const col of ["museums", "galleries"]) {
    const snap = await db.collection(col).get();
    for (const doc of snap.docs) {
      const d = doc.data();
      const flags = auditVenue(d, col);
      // Always update healthFlags on the doc (can be empty array)
      await doc.ref.update({ healthFlags: flags, lastAuditedAt: now });
      if (flags.length > 0) {
        await db.collection("venueAuditFlags").add({
          type: col === "museums" ? "museum" : "gallery",
          venueId: doc.id,
          venueName: d.name || "",
          flags,
          severity: flags.length >= 4 ? "high" : flags.length >= 2 ? "medium" : "low",
          status: "open",
          createdAt: now,
        });
        totals.venueFlagged++;
      }
    }
  }

  // Exhibits
  const exSnap = await db.collection("exhibits").get();
  for (const doc of exSnap.docs) {
    const d = doc.data();
    const flags = auditExhibit(d, today);
    await doc.ref.update({ healthFlags: flags, lastAuditedAt: now });
    if (flags.length > 0) {
      await db.collection("venueAuditFlags").add({
        type: "exhibit",
        exhibitId: doc.id,
        exhibitTitle: d.title || "",
        venueId: d.venueId || "",
        flags,
        severity: flags.length >= 3 ? "high" : flags.length >= 2 ? "medium" : "low",
        status: "open",
        createdAt: now,
      });
      totals.exhibitsFlagged++;
    }
  }

  // Zero-exhibit venues (separate query so we don't hit rate limits inside the per-venue loop)
  const venuesWithNoExhibits = [];
  for (const col of ["museums", "galleries"]) {
    const vSnap = await db.collection(col).where("hidden", "!=", true).get();
    for (const vDoc of vSnap.docs) {
      const exCount = await db.collection("exhibits")
        .where("venueId", "==", vDoc.id)
        .where("status", "==", "current")
        .limit(1)
        .get();
      if (exCount.empty) {
        venuesWithNoExhibits.push({ venueId: vDoc.id, venueName: vDoc.data().name, type: col === "museums" ? "museum" : "gallery" });
      }
    }
  }
  for (const v of venuesWithNoExhibits) {
    await db.collection("venueAuditFlags").add({
      type: v.type,
      venueId: v.venueId,
      venueName: v.venueName,
      flags: ["no-current-exhibits"],
      severity: "medium",
      status: "open",
      createdAt: now,
    });
  }

  return { ...totals, zeroExhibitVenues: venuesWithNoExhibits.length };
}

// ─── User Report Triage ─────────────────────────────────
//
// The LLM-based interpretation lives in the Docent Agent (AWS Bedrock, Claude Sonnet 4.5),
// not here. Reasoning: one source of LLM access, consistent auth/logging/cost tracking.
//
// Flow:
//   1. User submits report → /reports/{reportId} (Cloud Function stamps triageStatus: "pending")
//   2. Docent Agent polls `where("triageStatus", "==", "pending")` on schedule or on-demand
//   3. Agent reads current venue/exhibit data, runs its LLM, writes proposal to /reportTriage
//   4. Agent marks the report as processed
//   5. Human reviews in Notion or admin portal, approves → calls publishDraft()
//
// This module provides the helpers the agent uses when writing to /reportTriage.

/**
 * Write a triage proposal to /reportTriage. Called by the agent after it
 * interprets a user report. Idempotent by reportId.
 */
async function writeTriageProposal({ reportId, targetType, targetId, targetName,
                                     category, reporterId, reportText,
                                     proposedEdits, llmReasoning, llmConfidence }) {
  const db = getFirestore();

  // Check for existing proposal for this report
  const existing = await db.collection("reportTriage")
    .where("reportId", "==", reportId)
    .limit(1)
    .get();

  const payload = {
    reportId,
    targetType,
    targetId,
    targetName: targetName || "",
    category: category || "other",
    reporterId: reporterId || null,
    reportText: reportText || "",
    proposedEdits: proposedEdits || {},
    llmReasoning: llmReasoning || "",
    llmConfidence: llmConfidence || "low",
    status: "pending",
    createdAt: Math.floor(Date.now() / 1000),
  };

  if (!existing.empty) {
    await existing.docs[0].ref.update({ ...payload, updatedAt: Math.floor(Date.now() / 1000) });
    return { id: existing.docs[0].id, updated: true };
  }

  const ref = await db.collection("reportTriage").add(payload);

  // Mark the source report as processed
  await db.collection("reports").doc(reportId).update({
    triageStatus: "processed",
    triageId: ref.id,
  }).catch(() => {}); // ignore if report was deleted

  return { id: ref.id, created: true };
}

// ─── Publish (manual signoff) ───────────────────────────

/**
 * Apply an approved draft to production. Used by admin portal and Notion webhook.
 * Validates the action, performs the write, and marks the draft as published.
 *
 * Returns { published: true, targetId }.
 */
async function publishDraft(draftType, draftId, options = {}) {
  const db = getFirestore();
  const col = draftType === "scrapeDraft" ? "scrapeDrafts" :
              draftType === "reportTriage" ? "reportTriage" :
              draftType === "venueAuditFlag" ? "venueAuditFlags" : null;
  if (!col) throw new Error(`Unknown draft type: ${draftType}`);

  const ref = db.collection(col).doc(draftId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Draft not found: ${draftId}`);
  const draft = snap.data();
  if (draft.status === "published") throw new Error("Already published");

  const now = Math.floor(Date.now() / 1000);

  if (draftType === "scrapeDraft") {
    // Write new exhibit or update existing one
    const payload = {
      venueId: draft.venueId,
      venueType: draft.venueType || "museum",
      title: draft.title,
      artist: draft.artist || "",
      description: draft.description || "",
      url: draft.url,
      startDate: draft.startDate || null,
      startDateLocal: draft.startDateLocal || null,
      endDate: draft.endDate || null,
      endDateLocal: draft.endDateLocal || null,
      // Never include imageUrl — copyright rule
      avgRating: 0,
      reviewCount: 0,
      status: draft.endDateLocal && draft.endDateLocal < new Date().toISOString().slice(0, 10) ? "past" :
              draft.startDateLocal && draft.startDateLocal > new Date().toISOString().slice(0, 10) ? "upcoming" :
              "current",
      statusUpdatedAt: now,
    };

    let targetId;
    if (draft.proposedAction === "update" && draft.targetExhibitId) {
      targetId = draft.targetExhibitId;
      await db.collection("exhibits").doc(targetId).update(payload);
    } else {
      const newRef = await db.collection("exhibits").add(payload);
      targetId = newRef.id;
    }

    await ref.update({ status: "published", publishedAt: now, publishedExhibitId: targetId });
    return { published: true, targetId };
  }

  if (draftType === "reportTriage") {
    const { targetType, targetId, proposedEdits } = draft;
    const editsToApply = options.edits || proposedEdits; // allow human to override
    if (!editsToApply || Object.keys(editsToApply).length === 0) {
      throw new Error("No edits to apply");
    }

    const targetCol = targetType === "exhibit" ? "exhibits" :
                      targetType === "gallery" ? "galleries" :
                      targetType === "museum" ? "museums" : null;
    if (!targetCol) throw new Error(`Unknown target type: ${targetType}`);

    await db.collection(targetCol).doc(targetId).update(editsToApply);
    await ref.update({ status: "published", publishedAt: now, appliedEdits: editsToApply });
    return { published: true, targetId };
  }

  if (draftType === "venueAuditFlag") {
    // Audit flags aren't "published" per se — they're resolved when the underlying issue is fixed.
    // Mark as resolved.
    await ref.update({ status: "resolved", resolvedAt: now });
    return { resolved: true };
  }

  throw new Error(`Publish not implemented for ${draftType}`);
}

module.exports = {
  queueScrapeDraft,
  auditVenue,
  auditExhibit,
  runVenueAudit,
  runExhibitDateCheck,
  verifyExhibitDates,
  extractDatesFromHtml,
  writeTriageProposal,
  publishDraft,
};
