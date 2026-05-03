# Docent — TODO / PLAN

> Auto-loaded at the start of every Kiro session. Update this file as features are added, completed, or bugs are found.

## In Progress
- **Gallery Audit & Per-Address Normalization** — Session 10 progress
  - ✅ Gagosian (17 venues split), Hauser & Wirth, Matthew Marks, Perrotin Paris, David Zwirner NYC, Pace NYC
  - ✅ Gallery exhibit URL fixes: Perrotin, Gagosian, Jessica Silverman, Pace, David Kordansky, Haines, Regen
  - ⏳ Remaining: Fraenkel (Diane Arbus URL), Night Gallery (3 exhibits, JS-rendered site), David Zwirner LA/London/Paris/HK URLs, Blum (when first exhibits added)
- **Notion Exhibits DB pipeline** — DB created + views (Ready for Review, Published, By Venue), but publish command not yet built. Need: command that reads Notion row → validates → writes to Firestore → stamps Firestore ID back on Notion row.
- **Cloud Functions deploy pending** — `exhibitLifecycle`, `weeklyVenueAudit`, `batchUpdateDocs` written in `functions/index.js` but not deployed. Also Groups functions still undeployed from Session 9.
- **New Venue + Exhibit Data Pipeline** — 21 US museums from venues-data/new-venues.txt (Batches 1-4 complete, Dia Beacon long-term exhibits remaining)
- **Docent Groups** — Feature complete, needs QA testing + Cloud Functions deploy
- **Docent Agent Admin Dashboard v2** — deployed at https://main.d18arph3fn9yih.amplifyapp.com; next: deploy updated backend with sub-agents
- **SF Venue Outreach** — Asian Art Museum emailed. 5 venues remaining.
- **Embodiment Essay** — Full draft on Notion, needs editing pass.

## TODO

### 1. Deploy Agent v2 Backend
- [ ] Build and push updated Docker image with sub-agents, self-learning, automations
- [ ] Test sub-agent routing (analytics, qa, content, dev intents)
- [ ] Test self-learning tools (log_lesson, get_lessons, search_lessons)
- [ ] Test automation tools (audit_missing_fields, audit_stale_exhibits, etc.)
- [ ] Verify dashboard page loads and renders charts

### 2. Custom Domain
- [ ] admin.docentofficial.com via Amplify

### 3. Scheduled Automations (Cloud Functions)
- [ ] Weekly data audit (trigger QA agent headlessly)
- [ ] Weekly KPI snapshot → update Notion sprint page
- [ ] Exhibit freshness check (flag past endDates)

### 4. Integrations
- [ ] Notion read/write from backend agent (via API)
- [ ] Slack bot → agent API bridge

### 5. Marketing — This Week
- [ ] DM 10-15 SF museum Instagram accounts
- [ ] Film short museum walkthrough reels
- [ ] Draft April newsletter
- [ ] Send outreach emails to remaining SF venues

### 6. Shareable Review Cards (Backlog)
- Styled card export from reviews, spec in Notion

### 7. Populate Test Reviews (Low effort)
- Write review text for 24 venues, push via Ava/Kyle accounts

### 8. Museum-Specific Landing Pages (Backlog)
- Public web pages per venue for SEO

### 9. Reply to Comments — needs Cloud Functions deploy

### 10. Populate More Exhibits (Ongoing)

### 11. Curators Revenue Engine
- **Spec:** https://app.notion.com/p/353a11585119811a8be4fdd3fa177812
- **Phase 0 (May — before DCP launch):**
  - [x] Add role/curatorTagline/curatorBio/curatorLinks/pronouns/almaMater/specialties/favoriteMuseums to user model (iOS + web)
  - [x] Curator profile display on ProfileView + FriendsView (iOS) and Profile.tsx (web)
  - [x] Curator onboarding flow — 4 screens (iOS: CuratorOnboardingView.swift, Web: /curator-onboarding)
  - [x] Journey tracker — 6 milestones, own-profile only (iOS: JourneyTrackerView.swift, Web: JourneyTracker.tsx)
  - [x] Firestore rules for purchasedTours subcollection + purchases collection
  - [x] onCuratorApproved Cloud Function (welcome email on role change)
  - [x] Migration script: scripts/migrate-curator-role.js
  - [ ] Run migration script (migrate isCurator → role)
  - [ ] Deploy Cloud Functions (firebase deploy --only functions)
  - [ ] Deploy Firestore rules (firebase deploy --only firestore:rules)
  - [ ] Test curator onboarding end-to-end (web + iOS)
- **Phase 1 (Jun–Aug — during DCP):**
  - [ ] Tour creation flow for curators (free tours only)
  - [ ] Curator discovery page (web + iOS)
  - [ ] Free tour requirement tracking
- **Phase 2 (Sep–Oct):**
  - [ ] Stripe Connect Express integration
  - [ ] Checkout + webhook Cloud Functions
  - [ ] purchases collection + purchasedTours subcollection
  - [ ] Paid tour publishing + price picker
  - [ ] Curator earnings dashboard
  - [ ] Auto-qualify curators at 5+ reviews
- **Phase 3 (Q4+):**
  - [ ] Curator analytics
  - [ ] Tipping / one-time support
  - [ ] Curator subscriptions (recurring)
  - [ ] Expand welcome kit to all curators

## Done
- [2026-04-26] 21 new US museums added to Firestore from new-venues.txt (4 batches: DC/NYC/NY, Philly/Houston/Dallas/KC, Minneapolis/Detroit/Cleveland/Cincinnati, Atlanta/Pittsburgh/MA/AR/Miami/San Jose)
- [2026-04-26] All 21 venues marked Live in Notion Docent Venues DB with Firestore IDs
- [2026-04-26] 80+ exhibits added across all 21 venues (current, permanent, upcoming, past) — full data file populated
- [2026-04-23] Admin Portal v2: Dashboard page with live KPI cards, 14-day activity chart, review analytics
- [2026-04-23] Sub-agent orchestration: router + 4 specialized agents (Analytics, QA, Content, Dev)
- [2026-04-23] Self-learning tools: log_lesson, get_lessons, search_lessons (agentLessons collection)
- [2026-04-23] Automation tools: audit_missing_fields, audit_stale_exhibits, audit_orphaned_exhibits, venue_health_check, review_integrity_check
- [2026-04-23] Frontend: Dashboard link in header, /dashboard route, QA + Automations chat categories
- [2026-04-22] Home feed redesign: featured carousel, Exhibits Near You, RichActivityCard with photos
- [2026-04-22] ReviewDetailView — tap feed item to see full review + venue link
- [2026-04-22] Curator badge on profile pages (isCurator flag on user doc)
- [2026-04-22] Tappable venue name on exhibit and tour detail pages
- [2026-04-22] Friend activity digest push notifications (Cloud Function)
- [2026-04-22] Image performance: CachedAsyncImage in MediaGrid, prefetching on feed/detail load
- [2026-04-22] Home feed reads from reviews collection directly (skipped feedItems)
- [2026-04-22] Growth Roadmap: 50K Users created in Notion
- [2026-04-21] Exhibit location field added to model and detail view
- [2026-04-21] 5 legacy exhibits cleaned up, stale review data fixed
- [2026-04-21] Profile photo tap → navigate to profile (fullscreen only on friend profile)
- [2026-04-21] Captions hide when zooming photos in fullscreen viewer
- [2026-04-21] App version 1.5, WhatsNewView updated, iPad support added
- [2026-04-15] Docent Agent deployed: FAST + Strands + 18 Firestore tools + Cognito + Amplify
- [2026-04-15] Firebase credentials in SSM, Bedrock Claude Sonnet 4.5 access enabled
- [2026-04-15] Frontend branded as Docent Admin with quick actions
- [2026-04-15] Weekly Sprints + SF Venue Outreach databases in Notion
- [2026-04-15] DCP checklist steps 1–8 complete, DM templates drafted
- [2026-04-14] Baseline KPIs: 43 users, 72 reviews, 12 reviewers, 2 tours, 25 likes
- [2026-04-13] Mobile navbar, journal spacing, preview snippets, About → Footer
- [2026-04-13] Embodiment essay drafted on Notion
- [2026-04-10] Full venue audit, 7 new venues, exhibit features, mobile fixes
- [2026-04-07] DCP web page + Cloud Function
- [2026-04-04] Marketing: community section, activity feed, Journal → Featured
