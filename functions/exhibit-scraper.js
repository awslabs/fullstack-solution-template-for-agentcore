/**
 * Exhibit Research Tool — deep-reads museum exhibition pages like a human would.
 * 
 * NOT a bulk scraper. Reads each page thoroughly, extracts structured data,
 * and queues everything for manual review. Quality over speed.
 * 
 * Flow: Puppeteer renders page → extract ALL text content → parse structured fields
 *       → validate → queue for review in agentTasks (never writes directly to exhibits)
 */

const { getFirestore } = require("firebase-admin/firestore");

// ── Date Parsing ──

function parseDateString(s) {
  if (!s) return null;
  for (const fmt of [
    /(\w+)\s+(\d{1,2}),?\s+(\d{4})/,  // "May 13, 2026"
  ]) {
    const m = s.match(fmt);
    if (m) {
      const d = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
      if (!isNaN(d)) return {
        local: d.toISOString().slice(0, 10),
        ts: Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime() / 1000),
      };
    }
  }
  return null;
}

function parseDateRange(text) {
  if (!text) return {};
  const cleaned = text.replace(/\s+/g, " ").trim();

  // "February 15, 2026–October 11, 2026" or with em dash
  const range = cleaned.match(/(\w+ \d{1,2},?\s+\d{4})\s*[–—-]\s*(\w+ \d{1,2},?\s+\d{4})/);
  if (range) return { start: parseDateString(range[1]), end: parseDateString(range[2]) };

  // "Opens October 4, 2026"
  const opens = cleaned.match(/[Oo]pens?\s+(\w+ \d{1,2},?\s+\d{4})/);
  if (opens) return { start: parseDateString(opens[1]) };

  // "Through July 26, 2026"
  const through = cleaned.match(/[Tt]hrough\s+(\w+ \d{1,2},?\s+\d{4})/);
  if (through) return { end: parseDateString(through[1]) };

  // Two standalone dates on the page — first is start, second is end
  const allDates = [...cleaned.matchAll(/(\w+ \d{1,2},?\s+\d{4})/g)].map(m => parseDateString(m[1])).filter(Boolean);
  if (allDates.length >= 2) return { start: allDates[0], end: allDates[1] };
  if (allDates.length === 1) return { end: allDates[0] };

  return {};
}

// ── Deep Page Reader ──

/**
 * Reads a single exhibit page thoroughly using Puppeteer.
 * Extracts: title, full description, dates, artist, URL.
 * Returns structured data or null if the page doesn't look like an exhibit.
 */
async function deepReadExhibitPage(page, url) {
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20000 });

    const data = await page.evaluate(() => {
      // Title: h1 or og:title
      const h1 = document.querySelector("h1")?.textContent?.trim() || "";
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim() || "";
      const title = h1 || ogTitle;

      // Description: og:description, then meta description, then first long paragraph
      const ogDesc = document.querySelector('meta[property="og:description"]')?.content?.trim() || "";
      const metaDesc = document.querySelector('meta[name="description"]')?.content?.trim() || "";
      
      // Get all paragraph text for a richer description
      const paragraphs = [...document.querySelectorAll("p, .field-body p, .exhibition-description p, article p, .content p")]
        .map(p => p.textContent?.trim())
        .filter(t => t && t.length > 50)
        .slice(0, 5);
      const bodyDesc = paragraphs.join(" ").slice(0, 1000);

      // Use the longest description available
      const descriptions = [ogDesc, metaDesc, bodyDesc].filter(Boolean).sort((a, b) => b.length - a.length);
      const description = descriptions[0] || "";

      // Dates: look for date-related elements
      const dateEls = document.querySelectorAll(".dateline, .exhibition-dates, .date-range, time, [class*='date']");
      const dateTexts = [...dateEls].map(el => el.textContent?.trim()).filter(Boolean);
      // Also check the full page for date patterns
      const bodyText = document.body?.innerText || "";
      const dateMatches = bodyText.match(/(?:Opens?\s+)?\w+ \d{1,2},?\s+\d{4}(?:\s*[–—-]\s*\w+ \d{1,2},?\s+\d{4})?/g) || [];

      // Artist: look for common patterns
      const artistEl = document.querySelector(".artist-name, [class*='artist'], .exhibition-artist");
      const artist = artistEl?.textContent?.trim() || "";

      return {
        title,
        description,
        dateTexts: [...new Set([...dateTexts, ...dateMatches])].slice(0, 5),
        artist,
        bodyLength: bodyText.length,
      };
    });

    if (!data.title) return null;

    // Parse dates from all collected date text
    let dates = {};
    for (const dt of data.dateTexts) {
      const parsed = parseDateRange(dt);
      if (parsed.start && !dates.start) dates.start = parsed.start;
      if (parsed.end && !dates.end) dates.end = parsed.end;
    }

    return {
      title: data.title,
      description: data.description,
      artist: data.artist,
      url,
      dates,
      _bodyLength: data.bodyLength,
      _dateTextsFound: data.dateTexts,
    };
  } catch (e) {
    return { error: e.message, url };
  }
}

// ── Quality Assessment ──

function assessQuality(exhibit) {
  const issues = [];
  const desc = exhibit.description || "";

  if (!exhibit.title) issues.push("missing title");
  if (desc.length < 200) issues.push(`description too short (${desc.length} chars, need 200+)`);
  if (!exhibit.dates?.start && !exhibit.dates?.end) issues.push("no dates found");
  if (desc.includes("©") || desc.includes("all rights reserved")) issues.push("possible copyright text");
  if (desc.includes("click here") || desc.includes("buy tickets") || desc.includes("learn more")) issues.push("contains boilerplate/CTA text");

  // Check if it looks like a permanent collection gallery (no dates, generic title)
  const permanentSignals = ["galleries", "collection", "permanent", "ongoing"];
  if (permanentSignals.some(s => exhibit.title?.toLowerCase().includes(s)) && !exhibit.dates?.end) {
    issues.push("likely permanent collection gallery, not temporary exhibit");
  }

  return {
    quality: issues.length === 0 ? "high" : issues.length <= 1 ? "medium" : "low",
    issues,
    ready: issues.length === 0,
  };
}

// ── Main Pipeline ──

/**
 * Research exhibits for a venue. Deep-reads each page, assesses quality,
 * queues ALL results for manual review in /scrapeDrafts.
 * Never writes directly to exhibits.
 */
async function researchVenueExhibits(venueId, exhibitUrls, page) {
  const db = getFirestore();
  const { queueScrapeDraft } = require("./data-pipeline");

  // Check existing exhibits to detect updates vs. new adds
  const existing = await db.collection("exhibits").where("venueId", "==", venueId).get();
  const existingByTitle = new Map();
  existing.docs.forEach(d => {
    const t = d.data().title?.toLowerCase();
    if (t) existingByTitle.set(t, { id: d.id, data: d.data() });
  });

  const results = { researched: 0, queued: 0, updates: 0, errors: [] };

  for (const url of exhibitUrls) {
    const exhibit = await deepReadExhibitPage(page, url);
    results.researched++;

    if (!exhibit || exhibit.error) {
      results.errors.push({ url, error: exhibit?.error || "empty page" });
      continue;
    }

    const quality = assessQuality(exhibit);
    const existingMatch = existingByTitle.get(exhibit.title?.toLowerCase());

    const draft = {
      venueId,
      venueType: "museum",
      title: exhibit.title,
      artist: exhibit.artist || "",
      description: exhibit.description || "",
      url: exhibit.url,
      startDate: exhibit.dates?.start?.ts || null,
      startDateLocal: exhibit.dates?.start?.local || null,
      endDate: exhibit.dates?.end?.ts || null,
      endDateLocal: exhibit.dates?.end?.local || null,
      quality: quality.quality,
      issues: quality.issues,
      proposedAction: existingMatch ? "update" : "create",
      targetExhibitId: existingMatch ? existingMatch.id : null,
      source: "scraper",
    };

    await queueScrapeDraft(draft);
    results.queued++;
    if (existingMatch) results.updates++;
  }

  return results;
}

module.exports = { parseDateRange, parseDateString, deepReadExhibitPage, assessQuality, researchVenueExhibits };
