// Scrape Gagosian past exhibits (2022+), dedupe against existing, write
// proposals to /scrapeDrafts (NOT /exhibits) for manual review.
//
// IMPORTANT:
// - NEVER writes to /exhibits
// - NEVER modifies existing docs
// - NEVER scrapes images
// - All output lands in /scrapeDrafts with status "pending"
//
// Pass --dry-run to preview without writing anything to Firestore.

const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const fs = require('fs');

const DRY_RUN = process.argv.includes('--dry-run');

const MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Sept:9,Oct:10,Nov:11,Dec:12,
  January:1,February:2,March:3,April:4,June:6,July:7,August:8,September:9,October:10,November:11,December:12 };

function parseDate(mo, d, y) {
  const m = MONTHS[mo] || MONTHS[mo[0].toUpperCase() + mo.slice(1).toLowerCase()];
  if (!m) return null;
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

// Map location string from the page title to a venueId from /galleries.
// Returns null if no confident mapping (reviewer will assign manually).
function mapLocationToVenueId(titleLocation) {
  const t = (titleLocation || '').toLowerCase().trim();
  if (!t) return null;

  // London
  if (t.includes('burlington arcade')) return 'gagosian-burlington-arcade';
  if (t.includes('davies street')) return 'gagosian-davies-street';
  if (t.includes('grosvenor hill')) return 'gagosian-grosvenor-hill';
  if (t.includes('britannia street')) return 'gagosian-london';
  if (t.includes('charing cross')) return 'gagosian-london';  // historic

  // Paris
  if (t.includes('rue de castiglione')) return 'gagosian-rue-de-castiglione';
  if (t.includes('rue de ponthieu')) return 'gagosian-rue-de-ponthieu';
  if (t.includes('le bourget')) return 'gagosian-le-bourget';
  // Bare "Paris" — map to parent (reviewer can pick specific space)
  if (t === 'paris') return 'gagosian-paris';

  // New York
  if (t.includes('980 madison')) return 'gagosian-980-madison';
  if (t.includes('976 madison') || t.includes('974 madison')) return 'gagosian-974-madison-avenue';
  if (t.includes('541 west 24th')) return 'gagosian-541-west-24th-street';
  if (t.includes('555 west 24th')) return 'gagosian-555-west-24th';
  if (t.includes('522 west 21st') || t.includes('west 21st')) return 'gagosian-west-21st';
  if (t.includes('park & 75') || t.includes('park and 75')) return 'gagosian-park-75';
  // Bare "New York" — map to parent
  if (t === 'new york') return 'gagosian-new-york';

  // Other cities (bare, no specific address)
  if (t === 'beverly hills' || t === 'los angeles') return 'gagosian-beverly-hills';
  if (t === 'rome') return 'gagosian-rome';
  if (t === 'hong kong') return 'gagosian-hong-kong';
  if (t === 'basel') return 'gagosian-basel';
  if (t === 'gstaad') return 'gagosian-gstaad';
  if (t === 'athens') return 'gagosian-athens';
  // Seoul = APMA Cabinet (Gagosian partner space)
  if (t.includes('apma cabinet') || t === 'seoul') return 'apma-cabinet';

  return null;
}

async function fetchText(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DocentBot/1.0; +https://docentofficial.com)' },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch (e) {
    clearTimeout(t);
    return null;
  }
}

function extractFromGagosianPage(html) {
  if (!html) return null;

  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  if (!titleMatch) return null;
  let fullTitle = titleMatch[1].replace(/\s*\|\s*Gagosian\s*$/, '').trim();
  fullTitle = fullTitle.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

  const cleaned = fullTitle.replace(/–|—/g, '-');

  // Same year: "Month D-Month D, YYYY"
  let dateMatch = cleaned.match(/([A-Z][a-z]+)\s+(\d{1,2})\s*-\s*([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/);
  let sd, ed;
  if (dateMatch) {
    sd = parseDate(dateMatch[1], dateMatch[2], dateMatch[5]);
    ed = parseDate(dateMatch[3], dateMatch[4], dateMatch[5]);
  } else {
    // Cross-year: "Month D, YYYY-Month D, YYYY"
    dateMatch = cleaned.match(/([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})\s*-\s*([A-Z][a-z]+)\s+(\d{1,2}),\s+(\d{4})/);
    if (dateMatch) {
      sd = parseDate(dateMatch[1], dateMatch[2], dateMatch[3]);
      ed = parseDate(dateMatch[4], dateMatch[5], dateMatch[6]);
    }
  }

  if (!sd || !ed) return null;

  const titleWithoutDate = cleaned.replace(dateMatch[0], '').replace(/,\s*$/, '').trim();
  const parts = titleWithoutDate.split(',').map(s => s.trim());

  // Location is typically the last 1-2 parts. If the last part is a known city,
  // the location might be "[address], [city]". Try to combine.
  const KNOWN_CITIES = ['new york', 'london', 'paris', 'rome', 'beverly hills', 'hong kong',
    'basel', 'gstaad', 'geneva', 'athens', 'seoul', 'le bourget'];
  let location = parts[parts.length - 1] || '';
  let titleEndIdx = parts.length - 1;

  if (KNOWN_CITIES.includes(location.toLowerCase()) && parts.length >= 2) {
    const maybeAddress = parts[parts.length - 2];
    // Only combine if it's clearly a street address: starts with a number,
    // or matches specific known gallery location words.
    const looksLikeAddress = /^\d+\s+[A-Z]/.test(maybeAddress) ||
                             /^(Park|Rue|Burlington|Davies|Grosvenor|Britannia|Charing|Sunset|Camden|Madison)\b/i.test(maybeAddress);
    if (looksLikeAddress) {
      location = `${maybeAddress}, ${location}`;
      titleEndIdx = parts.length - 2;
    }
  }

  const titlePart = parts.slice(0, titleEndIdx).join(', ') || titleWithoutDate;

  const descMatch = html.match(/property="og:description"\s+content="([^"]+)"/);
  const description = descMatch
    ? descMatch[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim()
    : '';

  return {
    title: titlePart,
    location,
    startDate: sd,
    endDate: ed,
    description,
  };
}

async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (writes to /scrapeDrafts)'}`);
  console.log('');

  const sitemap = fs.readFileSync('/tmp/gagosian_sitemap.xml', 'utf8');
  const allUrls = [...sitemap.matchAll(/<loc>(https:\/\/[^<]+\/exhibitions\/(202[2-6])\/[^<]+)<\/loc>/g)]
    .map(m => m[1]);

  console.log(`Found ${allUrls.length} Gagosian exhibits from 2022+ in sitemap`);

  // Dedupe against existing /exhibits Gagosian entries
  const existingUrls = new Set();
  const existingTitleDates = new Set();

  const allExhibits = await db.collection('exhibits').where('venueType', '==', 'gallery').get();
  for (const doc of allExhibits.docs) {
    const d = doc.data();
    if (!(d.venueId || '').startsWith('gagosian')) continue;
    if (d.url) existingUrls.add(d.url);
    if (d.title && d.startDateLocal) {
      existingTitleDates.add(`${d.title.toLowerCase()}|${d.startDateLocal}`);
    }
  }

  // Also dedupe against existing drafts
  const drafts = await db.collection('scrapeDrafts').get();
  for (const doc of drafts.docs) {
    const d = doc.data();
    if (d.url) existingUrls.add(d.url);
  }

  console.log(`Dedupe set: ${existingUrls.size} URLs already known`);
  console.log('');

  let proposed = 0, unmapped = 0, failed = 0, dupe = 0, skipped = 0;
  const sample = [];
  const unmappedList = [];

  for (let i = 0; i < allUrls.length; i++) {
    const url = allUrls[i];
    if (i > 0 && i % 25 === 0) {
      console.log(`  progress ${i}/${allUrls.length} (proposed=${proposed}, dupe=${dupe}, failed=${failed}, skipped=${skipped})`);
    }

    if (existingUrls.has(url)) { dupe++; continue; }

    const html = await fetchText(url);
    if (!html) { failed++; continue; }

    const parsed = extractFromGagosianPage(html);
    if (!parsed) { skipped++; continue; }

    const titleKey = `${parsed.title.toLowerCase()}|${parsed.startDate}`;
    if (existingTitleDates.has(titleKey)) { dupe++; continue; }

    const venueId = mapLocationToVenueId(parsed.location);
    if (!venueId) unmapped++;

    const now = Math.floor(Date.now() / 1000);
    const draft = {
      venueId: venueId || 'gagosian',  // parent network as fallback
      venueType: 'gallery',
      title: parsed.title,
      artist: '',
      description: parsed.description,
      url,
      startDate: Math.floor(new Date(parsed.startDate + 'T00:00:00Z').getTime() / 1000),
      startDateLocal: parsed.startDate,
      endDate: Math.floor(new Date(parsed.endDate + 'T00:00:00Z').getTime() / 1000),
      endDateLocal: parsed.endDate,
      imageUrl: '',
      quality: venueId ? 'high' : 'medium',
      issues: venueId ? [] : ['needs-venue-mapping'],
      proposedAction: 'create',
      targetExhibitId: null,
      source: 'scraper',
      scraperVenue: 'gagosian',
      locationHint: parsed.location,
      status: 'pending',
      createdAt: now,
    };

    if (!DRY_RUN) {
      await db.collection('scrapeDrafts').add(draft);
    }
    proposed++;

    if (sample.length < 25) {
      sample.push({
        dates: `${parsed.startDate} → ${parsed.endDate}`,
        title: parsed.title.slice(0, 45),
        venueId: venueId || `(unmapped: ${parsed.location})`,
      });
    }
    if (!venueId) {
      unmappedList.push(`${parsed.location.slice(0, 60).padEnd(62)} | ${parsed.title.slice(0, 40)}`);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log('');
  console.log('=== DONE ===');
  console.log(`Proposed:              ${proposed}`);
  console.log(`  └─ mapped cleanly:   ${proposed - unmapped}`);
  console.log(`  └─ needs venue map:  ${unmapped}`);
  console.log(`Duplicate (skipped):   ${dupe}`);
  console.log(`Couldn't parse dates:  ${skipped}`);
  console.log(`Fetch failed:          ${failed}`);
  console.log('');
  console.log('Sample of proposals:');
  for (const r of sample) {
    console.log(`  ${r.dates}  ${r.title.padEnd(47)} @ ${r.venueId}`);
  }

  if (DRY_RUN) {
    console.log('');
    console.log('(DRY RUN — no drafts written)');
    if (unmappedList.length > 0) {
      console.log('');
      console.log(`Unmapped locations (${unmappedList.length}):`);
      const byLocation = {};
      for (const line of unmappedList) {
        const loc = line.split('|')[0].trim();
        byLocation[loc] = (byLocation[loc] || 0) + 1;
      }
      Object.entries(byLocation).sort((a, b) => b[1] - a[1]).forEach(([loc, count]) => {
        console.log(`  ${count.toString().padStart(3)}  ${loc}`);
      });
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
