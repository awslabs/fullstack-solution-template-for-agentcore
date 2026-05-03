# Docent — Domain Knowledge

> This file encodes everything the agent needs to know about Docent. Read at the start of every session alongside PLAN.md and HISTORY.md.

---

## 1. What Docent Is

Docent is a social museum and gallery guide. It helps people discover, review, and discuss art in museums. Think Letterboxd for museums.

**Core value proposition:** Using Docent is a signal of cultural taste. The brand should feel editorial, intentional, and intellectual — never like a tech product.

**Target users:** Museumgoers, art writers, curators, and people who want a reason to go to museums more often.

**Platforms:** iOS (SwiftUI), Web (React/TypeScript on Vite), Cloud Functions (Firebase)

---

## 2. Data Model (Firestore)

Firebase project: `docent-76d5a`
Storage bucket: `docent-76d5a.firebasestorage.app`

### Collections

**museums**
- id (string, often slug like "sfmoma"), name, location, lat, lng, description, imageUrl, website, exhibitionsUrl, hours, admission, ticketUrl, keywords (map), reviewCount, avgRating, imageAttribution

**galleries**
- Same schema as museums. Separate collection.

**exhibits**
- id (auto or slug like "sfmoma-kaws-family"), title, artist, description, venueId, venueType ("museum"|"gallery"), imageUrl, startDate (unix), endDate (unix), addedAt (unix), permanent (bool), location (room/floor string)
- Bucketing: current = has endDate in future (or no dates); upcoming = has startDate in future; past = endDate in past

**groups**
- id (auto), title, venueId, venueType, venueName, hostId, hostDisplayName, hostPhotoUrl
- type ("private"|"open"), date (unix), dateLocal, time, meetingSpot, bannerUrl
- maxSize (default 8), memberIds (array), memberCount, linkedTourId, exhibitIds (array)
- status ("active"|"cancelled"|"completed"), createdAt (unix)
- Subcollections: `groups/{id}/messages`, `groups/{id}/photos`
- User subcollection: `users/{id}/groups` (groupId, venueName, role, addedBy, joinedAt)
- Feed collection: `groupActivity` (userId, displayName, photoUrl, action, groupId, groupTitle, venueName, createdAt)

**tours**
- id (slug), title, museumId, theme, intro (array), wrapUp (array), groupSize, durationLabel, status ("published"), createdBy (userId), bannerUrl, startDate, endDate, reviewCount, avgRating
- Subcollection: `tours/{id}/stops` — each stop has title, description, artworkTitle, artworkArtist, imageUrl, order, activities, discussion prompts

**reviews**
- id (often `{userId}_{targetId}`), targetId, targetName, targetType ("museum"|"gallery"|"exhibit"|"tour"), text, rating (1-5), userId, displayName, photoUrl, username, createdAt (unix), photoUrls (array), photoCaptions (array), videoUrls (array), visitedAt (unix), likes (number), likedBy (array of userIds)

**users**
- id = Firebase Auth UID, displayName, username, photoUrl, location, createdAt (unix), fcmToken, isGuest, phone
- Subcollections: savedMuseums, savedGalleries, savedTours, completedTours, following, stopUploads

**journalEntries**
- id (auto), title, author, slug, category ("Essay"), body (HTML string), imageUrl, subtitle, createdAt (unix), publishedAt (unix)
- Subcollection: `journalEntries/{id}/replies` — text, userId, displayName, photoUrl, createdAt

### Key Conventions
- Timestamps are Unix seconds (not milliseconds)
- Venue IDs are slugs (e.g. "sfmoma", "de-young", "hosfelt-gallery")
- Exhibit IDs often follow pattern: `{venueId}-{exhibit-slug}`
- Review IDs often follow pattern: `{userId}_{targetId}`
- Images stored in Firebase Storage under paths like `museums/`, `galleries/`, `reviewPhotos/`, `profilePhotos/`

---

## 3. Web App (docent-web/)

**Stack:** React + TypeScript + Vite, deployed to Netlify via `git push origin main`
**URL:** https://docentofficial.com
**Repo:** https://github.com/skyjung/docent-web

### Key Pages
- `/` — Landing
- `/discover` — Browse museums/galleries
- `/calendar` — Exhibit calendar
- `/featured` — Featured content
- `/journal` — Journal essays
- `/journal/:slug` — Journal entry detail
- `/dcp` — Docent Curators Program application
- `/about` — About page (linked from footer, not navbar)
- `/profile/:userId` — User profile
- `/login` — Auth

### Design System
- Fonts: `--font-sans` (Inter/system), `--font-serif` (Lora/Georgia)
- Colors: `--ivory: #F9F8F6`, `--warm-white: #F3F1ED`, `--ink` (near-black), `--charcoal`, `--stone`, `--sand`, `--accent`
- Mobile breakpoint: 768px
- Mobile navbar: logo toggles dropdown menu, opaque ivory background
- Desktop navbar: horizontal links (Discover, Calendar, Featured, Journal, Profile/Login)
- Footer: Follow (Instagram, X, Substack) + More (About, Privacy Policy)

### Editorial Style
- Journal body HTML uses `<p>` tags with `<br>` between paragraphs for visible spacing
- Article body CSS: `p { margin-bottom: 0.4em }`, `br { margin: 0.4em 0 }`, `article-body { margin-top: 8px }`
- Preview snippets on /journal: 30 words, word-boundary truncation, ellipsis

### Writing Rules
- Minimize em dashes. Use periods or commas instead.
- Never use "not X, but Y" constructions.
- Never use "\u2014one that..." or similar appositives after em dashes.
- Do not repeat the same idea using synonyms (no fluff, no padding).
- Do not use rule of three lists (e.g. "art, culture, and beauty"). Pick the strongest word.
- Avoid colons when possible. Restructure the sentence instead.
- Avoid repetition across sentences and paragraphs.
- Use transitions. Sentences should flow into each other, not stand alone.
- Every sentence should add new information. If it doesn't, cut it.

---

## 4. iOS App (Docent/Docent/)

**Stack:** SwiftUI, Firebase SDK
**Features:** Museum/gallery browsing, exhibit details, reviews with photos/video, tour playback, user profiles, following, saved venues, push notifications

---

## 5. Cloud Functions (functions/)

- `submitDCPApplication` — Handles DCP applications (Firestore + Google Sheets + Gmail confirmation)
- Firebase secrets: `SMTP_PASS`, `DCP_SHEET_ID`

---

## 6. Notion Workspace

### Key Databases/Pages
- **Document Hub** — Main doc database (categories: Doc, Planning, Marketing, Wiki, etc.)
- **Journal** — Essay drafts and publishing pipeline (collection://1b2ceee1-7b0a-4a48-8367-ea362081461a)
- **Docent v2.0** — Product roadmap and implementation plan
- **Docent 2.0 Timeline** — Calendar view of phases (Phase 1-3 + Backlog)
- **SF Venue Outreach** — Museum/gallery partnership tracker (under Docent v2.0)
- **Weekly Sprints** — Week-by-week goals with KPI tracking
- **Docent Curators Program** — Implementation checklist (steps 1-8 complete, step 9 next)
- **Docent Marketing** — Marketing strategy docs

### Notion Conventions
- Journal essays are drafted in Notion first, then published to Firestore
- Use Notion for planning/tracking, Firestore for production data

---

## 7. Brand & Marketing

### Positioning
- "Letterboxd for museums" — the comp everyone understands
- Using Docent = cultural signal, high taste, intellectual
- The brand should feel earned, not marketed
- Exclusivity compounds the effect (small cohorts, curator badges, selective)

### Docent Curators Program (DCP)
- Cohort 01: 5 people, 3 months (June-August 2026), applications due May 6
- Reimbursement: ticket + $10 transport, 1 visit/month
- Requirement: 1 review or tour per visit
- Budget: $600 total
- Separate Amex Business Checking for program spending
- Payout: Venmo, processed every Friday

### Curators Revenue Engine (decided 2026-04-30)
- **Model:** Curators publish free/paid tours (Substack model). Docent takes 15% commission via Stripe Connect Express.
- **Curator approval:** Manual for DCP Cohort 01. Auto-qualify at 5+ published reviews after that.
- **Welcome kit:** Tote bag + handwritten founder note. DCP cohort only for now; expand when revenue supports it.
- **Pricing:** Curators set their own price. Platform enforces $0.99–$49.99 range.
- **Free tier gate:** Every curator must publish 1+ free tour before they can publish paid tours.
- **User role field:** `role: "user" | "curator" | "admin"` replaces boolean `isCurator`.
- **Curator profile fields:** curatorTagline (80 char), curatorBio (500 char), curatorLinks (map), pronouns, almaMater, specialties (array), favoriteMuseums (array, max 5 venueIds).
- **Journey tracker:** 6 milestones (First Visit, Regular, Curator Eligible, Complete Profile, Connector, Tour Guide). Visible only to the user on their own profile. Computed client-side, not stored.
- **Curator onboarding:** 4-screen flow (Welcome → Profile → Links & Favorites → Confirmation). Triggered when user hits 5 reviews and taps "Unlock". iOS: CuratorOnboardingView.swift. Web: /curator-onboarding route.
- **New collection:** `purchases` (userId, tourId, creatorId, amount, platformFee, creatorPayout, stripePaymentId, status, createdAt).
- **New subcollection:** `users/{id}/purchasedTours`.
- **Tour fields added:** pricing, price (cents), currency, creatorId, creatorDisplayName, creatorPhotoUrl, creatorUsername, purchaseCount, revenue.
- **Stripe Connect:** Express accounts. `application_fee_amount` = 15% on each Checkout Session. Stripe handles curator payouts.
- **Phases:** 0 = data model + curator profile (May), 1 = free tour creation + discovery (Jun–Aug), 2 = Stripe + paid tours (Sep–Oct), 3 = analytics + subscriptions (Q4+).
- **Notion spec:** https://app.notion.com/p/353a11585119811a8be4fdd3fa177812

### Growth Strategy
- SF-first: invest in local scene (SFMOMA, de Young, Legion of Honor)
- Content as distribution: journal essays, curator cross-posting
- SEO: museum-specific landing pages, exhibit reviews
- Social: Instagram DMs to museum accounts, short walkthrough reels
- Word of mouth: ask active users to invite one friend

### Instagram Video Essays (3x/week)
- NOT walkthrough reels. Mini-essays on video.
- Voiceover-driven, 45-90 seconds, one idea per video
- Pull from existing essays, reviews, and book notes
- Same editorial voice as captions and journal
- Topics: artist deep-dives, book recommendations, art concepts, exhibit previews
- Books referenced: Night Studio (Philip Guston memoir), On Photography (Sontag), Faux Pas, Daybrook (Anne Truitt)
- Backlog of 10 video essay ideas in Marketing Tracker

### Instagram Daily Post Style
- **Format:** Artist/venue name as title line, then 2-3 short paragraphs
- **Tone:** Editorial, informative, respectful. Not casual, not academic. Like a museum wall label written by someone who actually cares.
- **Structure:** (1) Context/hook — why now (opening, closing, anticipation), (2) Bio/background — who they are, what they're known for, signature style, (3) Influences/legacy — what shaped them, why they matter today
- **Length:** 3 short paragraphs is the sweet spot. Sometimes shorter is fine.
- **Details:** Include birthplace/era, artistic movement, materials/medium, key influences (other artists, literature, music), where they live/work now if alive
- **Tag the venue** (@sfmoma, @harvardartmuseums, etc.)
- **Emoji:** Minimal — one heart or similar at most, never multiple
- **Reference caption (Kiefer post 4/16):**
  > Anselm Kiefer
  > In anticipation of the Fisher Collection reopening this weekend @sfmoma, we are featuring Mr. Anselm Kiefer today. 🩶
  > Born in post-war West Germany, Kiefer has dedicated much of his career to exploring identity, mythology, and material processes through a Neo-expressionist style. Kiefer's signature works are layered in straw, ash, and shellac, depicting jagged landscapes of war-torn trauma and psychological tension...
  > Throughout his career, Kiefer was influenced by a variety of mediums, including poems by Paul Celan, operas by Richard Wagner, and paintings by Vincent van Gogh...

### Active Users (top reviewers)
- Sky (skyjung) — founder, most reviews
- Ben (sitterstill) — SF, thoughtful long-form reviews
- El (el.eliot) — SF, strong Abramović review
- Anna (anna) — LA/travel, photos
- Nathan (nthanzhng) — SF
- Da-In (dainosaur) — LA
- Jeff (munjae) — tour reviews
- Kyle (kyle) — SF, recent signups

---

## 8. Current Metrics (baseline Apr 14, 2026)

- 43 total users
- 72 reviews (12 unique reviewers)
- 2 published tours
- 65 museums, 3 galleries
- 100+ exhibits
- 25 total likes
- 1 journal entry published ("Art That Moves the World")

---

## 9. AWS Infrastructure (docent-agent)

- Account: 180745325292 (docentofficial)
- Stack: docent-agent (us-east-1)
- AgentCore Runtime: Strands agent with Firebase tools
- Frontend: Amplify at https://main.d18arph3fn9yih.amplifyapp.com
- Cognito: us-east-1_0pnwGeJBH
- Firebase creds in SSM: /docent-agent/firebase_credentials
- Container runtime: Finch (Docker Desktop broken)
- Note: High latency on cold starts, not suitable as daily driver yet

---

## 10. Sub-Agent Architecture

Docent agent delegates to specialized sub-agents based on task type. Sky handles all creative direction, branding, and strategy. Agents handle execution, tracking, and busywork.

**Notion Ops Hub:** https://www.notion.so/344a1158511981008ef8f0878760cee3

### 🛠 Dev (default mode)
- Features, bug fixes, deploys, code changes
- Works with: docent-web/, Docent/Docent/, functions/, docent-agent/
- Firestore CRUD, web component changes, push to main
- On-demand

### ⚙️ Automations
- Cron jobs: exhibit scraping, data freshness checks, stale content cleanup
- Automated workflows: new venue setup pipeline, exhibit import from museum APIs
- Triggered or weekly cadence
- Future: scheduled Cloud Functions for recurring tasks

### 🧪 QA
- **Notion DB:** QA / Bug Tracker (collection://ce6d7fcc-9a2e-4841-b785-07e3ccf62705)
- Data integrity audits: missing fields, broken image URLs, orphaned exhibits
- Web/iOS testing: layout issues, broken links, mobile responsiveness
- Firestore rules validation
- Weekly cadence

### 📊 Analytics
- **Notion DB:** Weekly Sprints (collection://31647369-8fb8-4f93-8e3c-ed423ef910b0)
- KPIs: total users, new users, reviews, tours completed, likes, web sessions
- Growth analysis: week-over-week deltas, user retention signals
- Pull from Firestore using `get_stats` and `activity_summary` tools
- Weekly cadence (update sprint page every Monday)

### 💰 Business Ops
- **Notion DB:** Spending Log (collection://c3e0dcae-3321-4a8f-9514-cdc6d8be1ff0)
- Track all spending: DCP reimbursements, infra costs (AWS, Netlify, Firebase), tools
- DCP budget: $600 total, Amex Business Checking
- AWS cost monitoring: Bedrock usage, AgentCore runtime
- Monthly cadence

### ⚖️ Legal (later)
- Copyright management for museum images (track imageAttribution field)
- Compliance: privacy policy, data handling
- Tax records
- As-needed

### 📣 Marketing
- **Notion DB:** Marketing Tracker (collection://4fa0d34d-fedc-4dcf-95ff-7af13220e05a)
- Content calendar: journal essays, social posts, newsletter
- Outreach tracking: museum partnerships (SF Venue Outreach DB), Instagram DMs
- KPI analysis: follower growth, engagement, web traffic sources
- Campaign planning: break into subtasks, track status
- Weekly cadence
- **Sky decides:** what to post, brand voice, creative direction, partnerships strategy
- **Agent does:** schedule tracking, KPI pulls, draft templates, status updates, outreach logging

### How delegation works
When a task comes in, route to the appropriate sub-agent context:
- "Fix the navbar" → Dev
- "Run a data audit" → QA
- "What are this week's numbers?" → Analytics
- "Log the DCP reimbursement" → Business Ops
- "Draft the newsletter outline" → Marketing
- "Scrape new exhibits from SFMOMA" → Automations

---

## 11. Decision Log

- **Navbar:** About moved to footer to reduce crowding. Mobile uses logo-toggle dropdown.
- **Journal spacing:** `<br>` tags between `</p><p>` in Firestore HTML body, not CSS-only.
- **Exhibits:** `addedAt` field + "New" badge (7 days). Permanent exhibits use `permanent: true`.
- **Reviews:** ID pattern `{userId}_{targetId}` for user-venue reviews. Likes stored as `likedBy` array + `likes` count.
- **Deploy:** Web pushes to `main` branch → Netlify auto-deploys. No Firebase Hosting for web.
- **Agent:** AgentCore dashboard is a learning project, not daily driver. Kiro CLI is primary ops tool.
- **Ops:** Notion is single source of truth for all operations. Docent Ops Hub centralizes all sub-agent databases.
- **Roles:** Sky = creative director + strategist. Agent = execution, tracking, busywork.

## 12. Admin Portal v2 Architecture

### Dashboard (/dashboard)
- Live KPI cards: users, reviews, museums, galleries, exhibits, tours
- 14-day activity chart (new users + reviews per day)
- Reviews by venue (top 8, horizontal bar)
- Rating distribution, review type pie chart, top reviewers
- Recent reviews feed
- All data fetched via AgentCore API (same backend as chat)

### Sub-Agent Orchestration
- `basic_agent.py` is now an orchestrator that routes to specialized sub-agents
- Intent classification via keyword matching in `tools/subagents.py`
- 4 sub-agents: Analytics, QA, Content, Dev — each with scoped tools and system prompts
- Orchestrator adds sub-agent context to system prompt, not separate agent instances
- All share the same Bedrock model and session manager

### Self-Learning (agentLessons collection)
- `log_lesson(lesson, category, source)` — stores corrections and patterns
- `get_lessons(category, limit)` — retrieves recent lessons for context
- `search_lessons(keyword)` — finds relevant past lessons
- Categories: general, data_model, writing, operations, bug
- Sources: user_correction, auto_detected, decision_outcome

### Automation Tools
- `audit_missing_fields(collection, required_fields)` — checks for incomplete docs
- `audit_stale_exhibits()` — finds past-endDate exhibits
- `audit_orphaned_exhibits()` — finds exhibits with invalid venueIds
- `venue_health_check()` — checks museums/galleries for completeness
- `review_integrity_check()` — validates review data integrity

### Frontend Chat Categories
- general, features (Dev), analytics, content, qa, automations
- Each maps to a system hint that helps the backend route correctly

---

## Lessons

### 2026-04-20 08:01
Never push code to GitHub until after it has been tested locally (Xcode build for iOS, local dev server for web). Always wait for Sky to confirm before pushing.

### 2026-04-20 08:16
Bugs go in the QA / Bug Tracker database (https://www.notion.so/314a115851198073b748fc915cd065e8), not Feature Requests. Feature Requests is for new features only.

### 2026-04-22 13:09
Avoid massive database queries to derive flags. Instead, store flags directly on the relevant document (e.g. `isCurator` on the user doc). Minimize latency without causing stale/out-of-sync data or writing the same data in multiple places. Prefer single-source-of-truth fields over computed queries.

### 2026-04-23 11:41
Data Pipeline for Venues/Exhibits — When new data is written to the database, follow this validation pipeline before marking it live:
1. Verify core properties are populated (name/title, location, venueId, dates)
2. Cross-verify with official links (museum website, exhibition page)
3. Ensure descriptions are not too short and do not contain plagiarized/directly copied text
4. Verify images are not copyrighted (check source, attribution)
5. Define keywords (for search/discovery)
6. Verify images are not broken (URL returns 200)
7. Verify links are not broken (website, ticketUrl, exhibitionsUrl)
8. Omit data that is unconfirmed or low confidence — track these in Notion for manual audit
This prevents the need for frequent retroactive audits. Validate on write, not after the fact.

### 2026-04-23 11:51
Exhibit dates: always store local date strings (`startDateLocal`/`endDateLocal` like "2026-05-13") alongside Unix timestamps (`startDate`/`endDate`). Some venues only list end dates or start dates, not both — that's expected. Never change existing timestamp fields or frontend date logic — the mobile app depends on them. Timezone conversion bugs are common; the local date string is the source of truth.

### 2026-04-23 11:53
Exhibit data rules:
1. Do NOT add exhibit images (imageUrl) — they are copyrighted. Leave imageUrl empty. The app falls back to venue images.
2. Do NOT delete existing exhibits or overwrite them if they have existing reviews (reviewCount > 0).
3. Do NOT create duplicate exhibits — always check if an exhibit already exists for that venue before adding.
4. Only update metadata fields (dates, URLs, descriptions) on existing exhibits. Never overwrite user-generated data (reviews, ratings).

### 2026-04-23 11:58
Exhibit scraping lessons:
- FAMSF (de Young/Legion) works with curl — dates in HTML, OG tags for descriptions
- MFA Boston works with curl — dates in `date-display-range` spans, OG tags for images/descriptions
- ICA Boston works with curl — dates in page body, OG tags for descriptions
- SFMOMA partially works — exhibition slugs extractable but Cloudflare blocks API endpoints
- The Met, MoMA, Guggenheim, Whitney, Brooklyn Museum are all JS-rendered — curl gets empty pages. Need headless browser or manual entry for these.
- Best approach for JS-rendered sites: check existing DB first, then manually verify/add from the museum website. Don't waste time trying to scrape them.
- Always store `startDateLocal`/`endDateLocal` alongside timestamps. Always add `url` to the exhibit.
- Never add `imageUrl` — copyright. Leave empty, app falls back to venue image.

### 2026-04-23 12:05
Exhibit Scraper Architecture:
- `functions/exhibit-scraper.js` — scraping logic, date parsing, validation, dedup
- `functions/index.js` — `scrapeExhibits` (callable, single venue) + `weeklyExhibitScrape` (scheduled, all venues)
- Uses Puppeteer for JS-rendered sites (Met, MoMA, Guggenheim, Brooklyn Museum, SFMOMA)
- Curl-friendly sites (FAMSF, MFA, ICA, Whitney) can be scraped without Puppeteer
- Pipeline: scrape → dedup (check existing titles) → validate (description length, no copyright images) → write or flag
- Low-confidence exhibits get written to `agentTasks` for manual review, NOT to `exhibits`
- Never adds imageUrl (copyright). Never overwrites exhibits with reviews.
- Runs weekly on Monday 6am PT. Can also be triggered on-demand from admin portal.
- Scrape configs stored in SCRAPE_CONFIGS — CSS selectors per museum site.
- Requires `puppeteer` npm dependency in functions/. Deploy with `firebase deploy --only functions`.

### 2026-04-23 12:11
Notion Docent Venues DB (collection://31109839-2434-489d-9f02-f0f4b1e4798e) is the single source of truth for tracking all venue/exhibit data changes. Every venue/exhibit write must be reflected here. Fields: Name, Firestore ID, Type (Museum/Gallery), City, Country, Status (Not started/In progress/Live), Website, Exhibitions URL, Ticket URL, Admission, Reviews, Avg Rating. This prevents loose Notion pages/files for data auditing. Exhibit scrapes should also update this DB.

### 2026-04-23 13:06
Venue vs Exhibit image rules:
- VENUES (museums/galleries): ALWAYS add a working Wikimedia Commons / copyright-free imageUrl. Verify the URL returns 200 before writing. If the first image found is broken, find another.
- EXHIBITS: NEVER add imageUrl (copyright). Leave empty — the app falls back to the venue image.
- Keywords: ALWAYS populate keywords when adding a venue or exhibit. Keywords are a map of term → definition. Include the venue's signature artists, architectural features, and notable collections.

### 2026-04-23 13:22
Always verify ticket URLs and admission prices against the museum's actual plan-your-visit page. Don't guess or use outdated data. Admission pricing varies by residency status (e.g. Denver Art Museum has non-resident vs resident pricing) — use non-resident pricing as the default since most Docent users are visitors.

### 2026-04-23 13:35
Automated scraping produces mediocre data. Problems observed:
- Thin/empty descriptions (one sentence or boilerplate)
- Missing dates on most scraped exhibits
- Permanent collection galleries scraped as temporary exhibits
- Duplicates when manual + scraped entries overlap
- No keywords populated
- Validation pipeline minimum (80 chars) is too low — should be 200+ chars
FIX: Raise description minimum to 200 chars. Scraper should flag (not write) anything without dates. Permanent galleries should be detected and marked `permanent: true`. Scraper output should ALWAYS go to review queue first, never directly to Firestore. Manual curation is required for quality.

### 2026-04-23 13:42
Data pipeline philosophy: The pipeline must be robust enough that "add venue X" is a single trusted command. Puppeteer is a research tool, not a bulk writer. It should read each exhibit page thoroughly — extracting full descriptions, exact dates, artist names, and verifying links — the same way a human would. All scraped data goes to review queue. Quality > speed. Every exhibit in the database should be one you'd be proud to show a user.

### 2026-04-23 13:46
Weekly automated exhibit scrape DISABLED. All exhibit data entry is manual until the research tool is proven 100% reliable. The `scrapeExhibits` callable function still exists for on-demand research, but it only queues results for review — never writes to Firestore. No automated writes to production data.

### 2026-04-26 17:00
Firebase deploys rules from the project root (`/Docent/firestore.rules` and `/Docent/storage.rules`), not from the iOS app folder (`Docent/Docent/Docent/`). The iOS folder has a copy for reference, but the root copy is what gets deployed. Always update the root copy, or copy from iOS to root before deploying.

### 2026-04-29 08:53
The `ticketClicks` Firestore rule keeps getting lost during file edits. Always verify it exists after any change to `firestore.rules`. The rule must be: `match /ticketClicks/{clickId} { allow read: if true; allow create: ... }`

### 2026-04-29 09:03
Use Ocula (ocula.com/art-galleries/) as a research and discovery reference for galleries and exhibits. It has rich data on global gallery locations, current/upcoming exhibits, and press. Do NOT scrape or copy their content — use it as a discovery tool to find what to look for, then verify on the gallery's own website and write original descriptions. Same manual curation approach as museums.

### 2026-04-29 09:33
NEVER fabricate exhibit data. All exhibits must be verified against the gallery/museum's actual website or a trusted source like Ocula/Artforum. If the website is JS-rendered and can't be scraped, ask the user for the data or flag it for manual entry. Making up exhibit titles, artists, or dates is a critical data quality violation.

### 2026-04-29 09:35 — CRITICAL
NEVER fabricate exhibits, shows, or any venue data. EVER. Every exhibit must have a verifiable source of truth — the gallery/museum's own website, a trusted aggregator (Ocula, Artforum), or data provided directly by the user. If a source can't be verified, do NOT add the data. Flag it for manual entry instead. Delete any data that cannot be traced to a real source. This is a zero-tolerance policy.

### 2026-04-30 09:57
Multi-location gallery architecture: Use `parentGalleryId` on child gallery docs to link locations to a parent org. The parent holds canonical description, keywords, and website. Child locations override only location-specific fields (hours, address, image, lat/lng). The iOS app merges at read time in `GalleriesRepository.fetchGallery()` — if a child has empty description/keywords/website, it inherits from the parent. Parent galleries: david-zwirner (NYC), gagosian-new-york, hauser-wirth-la, perrotin-paris, matthew-marks-gallery.

### 2026-04-30 12:44 — Per-address venue normalization (major architecture change)
Multi-location galleries with multiple physical spaces in the same city are now stored as SEPARATE venue docs per address. Each has its own lat/lng for map pins, its own hours, own gallery page. Rationale: "Gagosian NYC" as a single umbrella was confusing — NYC alone has 5+ physical spaces (980 Madison, 974 Madison, Park & 75, 555 W 24th, 541 W 24th, 522 W 21st). Users need to know which specific location to visit.

**Pattern:**
- Parent umbrella doc (e.g., `gagosian-new-york`, `gagosian-london`, `gagosian-paris`, `perrotin-paris`, `matthew-marks-gallery`, `hauser-wirth`, `pace-gallery-new-york`, `david-zwirner`) stays in Firestore with canonical org info (description, keywords, website) but has `hidden: true` so it doesn't appear in discover/list views.
- Each physical space is a separate gallery doc with its own slug (e.g., `gagosian-980-madison`, `gagosian-park-75`, `perrotin-76-rue-de-turenne`, `matthew-marks-523-west-24th-street`, `pace-540-west-25th-street`), own lat/lng, own hours, and `parentGalleryId` pointing to the umbrella.
- Name format: `Gallery · Specific Address` (dot separator, e.g., "Gagosian · 980 Madison Avenue").
- Each exhibit points to the specific child venue, NOT the umbrella parent.
- iOS `GalleriesRepository.fetchGallery()` auto-merges shared fields (description, keywords, website) from the parent via `parentGalleryId`.

**Venues normalized so far (2026-04-30):**
- Gagosian: NYC (6 addresses), London (3), Paris (2), plus standalone Rome, Athens, Basel, HK, Le Bourget, Beverly Hills, Gstaad
- David Zwirner NYC: 525 West 19th flagship + 537 West 20th + 34 East 69th + 52 Walker Street (all 4 NYC locations active per latest site data — earlier "temporarily closed" note from description was outdated)
- Hauser & Wirth: created `hauser-wirth` org parent, LA 901 E 3rd (was `hauser-wirth-la`), LA 717 S Alameda, NY 443 W 18th (was `hauser-wirth-new-york`)
- Perrotin Paris: 76 rue de Turenne, Matignon
- Matthew Marks: NY (3 addresses: 522 W 22nd, 526 W 22nd, 523 W 24th), LA (2: 1050 + 1062 N Orange Grove)
- Pace Gallery: NYC (540 West 25th, 125 Newbury)

**Still to normalize:** Blum (LA flagship, Tokyo, NY — when first exhibits added), other multi-address galleries as they come up.

### 2026-04-30 12:48 — Slug naming pitfall
When using `create_gallery` with an `id` field in the data payload, the tool IGNORES the provided id and auto-generates a slug from the `name`. Example: name "Gagosian · 980 Madison Avenue" → slug `gagosian-980-madison-avenue`. Always verify the returned id after creation. If creating sibling venues that need specific slugs, check which version exists in Firestore before linking exhibits to them via `venueId`.

### 2026-04-30 12:50 — Gallery site scraping patterns
Gallery websites generally fall into 3 patterns for programmatic data access:
1. **Embedded JSON (easy to scrape):** Perrotin (Inertia.js `data-page` attr), Gagosian (`__NEXT_DATA__` with `exhibitions` array), Pace (server-rendered HTML with clean patterns). These all expose titles, dates, artists, slugs, cities, and thumbnails.
2. **Client-rendered JS (hard to scrape):** David Zwirner (Sanity CMS, empty pageProps), Night Gallery. Would require Puppeteer/headless browser.
3. **Simple HTML listings (easy grep):** David Kordansky, Haines Gallery, Regen Projects, Fraenkel Gallery. Numbered URL patterns (e.g. `99-andy-goldsworthy-for-olle`).

For live-site verification, use approach #1 first (fast, structured), fall back to #3 with grep. Don't bother with #2 without Puppeteer.

### 2026-04-30 09:57
Venue/exhibit health auditing: `healthFlags` (string array) and `lastAuditedAt` (unix timestamp) fields on all museums, galleries, and exhibits. Stamped weekly by `weeklyVenueAudit` Cloud Function (Mondays 7am PT). Flags include: missing-image, thin-description, missing-keywords, missing-website, missing-coordinates, missing-venueId, past-endDate, missing-dates. Query unhealthy docs with `where healthFlags != []`.

### 2026-04-30 09:57
Batch update tool: `batchUpdateDocs` callable Cloud Function. Takes `{ collection, where: [{field, op, value}], updates: {field: value} }`. Applies updates to all matching docs in batches of 500. Use for bulk operations like "update all Zwirner locations" or "clear healthFlags after fixing issues".

## Data Pipeline Architecture (2026-04-30)

The golden rule: **automation never writes to production.** All edits flow through review queues.

### Three review collections (write-protected from clients)
- `/scrapeDrafts` — proposed exhibit adds/updates from the weekly scraper
- `/venueAuditFlags` — weekly health-check findings (missing hours, possibly-closed, etc.)
- `/reportTriage` — LLM-interpreted user reports with structured edit proposals

### Cloud Functions (all in `/functions/index.js` + `/functions/data-pipeline.js`)
- `weeklyExhibitScrape` (Mondays 6am PT) — Puppeteer deep-reads known venue pages, writes to `/scrapeDrafts`
- `weeklyVenueAudit` (Mondays 7am PT) — checks every venue/exhibit for data-quality issues, writes to `/venueAuditFlags`, updates `healthFlags` on the docs themselves
- `exhibitLifecycle` (daily 2am PT) — derives exhibit `status` field from dates (this is the only field automation touches on production)
- `onUserReport` (triggered) — fires on `/reports/{reportId}`, stamps `triageStatus: "pending"`. No LLM call — the agent picks it up.
- `publishDraft` (admin-only callable) — applies an approved draft to production. Requires `isAdmin: true` on user doc or UID in `ADMIN_UIDS` env var. Returns `{ published: true, targetId }`.
- `createScrapeDraft` (admin-only callable) — lets admin portal create drafts manually for tips/corrections not from the scraper

### User-writable: `/reports`
iOS "Report incorrect info" button writes `{ reporterId, targetType, targetId, category, text }` to `/reports`. Firestore rules enforce:
- signed-in users only, reporterId must match auth uid
- `targetType` in ['museum','gallery','exhibit']
- `category` is a string (client-side controlled vocabulary)
- no client reads, updates, or deletes

### LLM interpretation — lives in the Docent Agent, not Firebase
The Docent Agent (AWS Bedrock + Claude Sonnet 4.5 via AgentCore) handles all LLM work. Firebase just stamps `triageStatus: "pending"` on incoming reports.

Agent has these Strands tools (`/docent-agent/patterns/strands-single-agent/tools/report_triage.py`):
- `list_pending_reports(limit)` — fetch pending reports
- `get_report_context(reportId)` — fetch report + current venue/exhibit doc for context
- `write_triage_proposal(reportId, proposedEditsJson, reasoning, confidence)` — writes to `/reportTriage` and marks source report processed. Includes safety guard that drops any `imageUrl` edits (copyright).
- `count_pending_work()` — quick status check across all four review queues

Agent can be invoked from the admin dashboard chat ("triage the pending reports") or on a cron if we want. No separate API key; uses the agent's existing Bedrock access.

Rules the agent follows (in its orchestrator prompt):
- Only propose edits when confident the report is accurate
- Preserve existing data formats
- Never propose imageUrl edits
- For "closed" category: propose `{"hidden": true}`
- Uncertain reports: empty edits `{}` with reasoning explaining why

### Notion review interface
Three databases under Ops Hub:
- **Data Quality Flags** (`collection://5fa08d6d-60ff-4f83-9fb1-b6abb1dff32d`) — mirrors `/venueAuditFlags`
- **Report Triage** (`collection://fb498fb0-dcc1-42b2-a4cd-37f1b60e9f84`) — mirrors `/reportTriage`
- **Docent Exhibits** (existing, `collection://8edcce9b-cc69-406a-9ebd-bd54d9cd6e09`) — mirrors `/scrapeDrafts` staging

Not yet built: the Notion↔Firestore sync worker. For now, review happens in Firestore directly via admin portal or MCP tools, and Notion DBs are staging/communication tools.

### Publishing flow
1. Review draft in Notion or admin portal
2. Approve → status: `approved`
3. Call `publishDraft({ draftType, draftId, edits })` from admin portal
4. Draft status → `published`, production doc updated

### Deploy
```
firebase deploy --only functions
firebase deploy --only firestore:rules
```
No API keys needed — agent handles LLM work using existing Bedrock access via AgentCore.

### 2026-04-30 20:49
Don't push to main unless Sky explicitly says to. Build and commit locally, but wait for confirmation before `git push`.

### 2026-05-01 10:05
Don't delete exhibits just because the URL 404s or the title isn't in the venue's standard exhibitions sitemap. Galleries use multiple paths — Jessica Silverman puts in-person shows at `/exhibitions/` and online/hybrid shows at `/online-shows/`. Before deleting an exhibit with a broken URL, check: (1) alternate venue paths (online-shows, past-exhibitions, events, archive), (2) whether the title plus dates makes sense as a real exhibit, (3) whether the venue's full sitemap (wp-sitemap-posts-*-1.xml) contains the slug anywhere. Deleting based on one 404 alone caused me to lose Oliver Osborne at Jessica Silverman, which was real — it was just at `/online-shows/oliver-osborne/` not `/exhibitions/oliver-osborne/`. When in doubt, flag rather than delete.

### 2026-05-01 12:50
Dates should always be stored as local date strings (e.g. "2026-08-15"), never as Unix timestamps. This applies to all new date fields across tours, exhibits, events, etc. Existing timestamp fields on legacy data stay as-is (mobile app depends on them), but all new writes use local strings.

### 2026-05-01 12:55
Don't run Xcode builds. Sky builds and tests iOS himself.

### 2026-05-01 14:35
Don't run xcodebuild or vite build after every change. Sky builds locally himself. Only build when explicitly asked or when verifying a complex change before pushing.

### 2026-05-02 18:40
When scraping ICA Boston exhibit dates, always extract from the specific `class="field field-name-exhibition-date"` container on the page — not from generic text pattern matching. Major ICA shows often tour to other venues (MoMA PS1, High Museum, LACMA/CAAM), and those tour dates appear in paragraphs on the same page. Grabbing the first date range with regex can pick up a touring-venue run instead of the ICA Boston run. Pattern: `field-name-exhibition-date[\s\S]{0,600}?field-item[^>]*>([^<]+)<`. This fixed 8 of 32 initially-scraped ICA past exhibits this session.
