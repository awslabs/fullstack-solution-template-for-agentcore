# Docent — Conversation History

> Last 3 session summaries, most recent first. Updated at the end of each session.

---

## Session 11 — 2026-04-30 to 2026-05-01

### Curators Revenue Engine — Full Spec + Phase 0
- Scoped the entire subscription revenue model: 15% commission, Stripe Connect Express, Substack-style paid tours
- Decisions locked: curator auto-qualify at 5+ reviews, curators set own price ($0.99-$49.99), 1 free tour required before paid
- Created Notion spec page: https://app.notion.com/p/353a11585119811a8be4fdd3fa177812
- Phase 0 built (on `curator-phase-0` branch, not merged to main):
  - User model: role, curatorTagline, curatorBio, curatorLinks, pronouns, almaMater, specialties, favoriteMuseums, bio (general)
  - Curator onboarding flow (4 screens) — iOS + web
  - Journey tracker (6 milestones) — iOS + web
  - Curator card (Spotify-style artist bio) — iOS + web
  - Edit profile with curator fields — web
  - curatorEligible flag stamped by Cloud Function after 5th review
  - CuratorEligibleCard prompt on profile
  - "Become a Curator" / "Curator Settings" in Settings
  - onCuratorApproved Cloud Function (welcome email)
  - Migration: all 50 users backfilled with role field (Sky = admin)

### Tour Builder — Phase 1
- Full tour creation flow on web (`/tours/new`, `/tours/:id/edit`) — on `curator-phase-0` branch
- Full tour creation flow on iOS (TourBuilderView.swift) — step-based: Details → Intro → Stops → Wrap Up → Preview
- ToursRepository write methods: createTour, updateTour, saveStop, deleteStop, deleteDraftTour, archiveTour
- Draft/publish flow, required end date, edit published tours with editedAt timestamp
- Delete drafts (hard delete) vs archive published (with reason + refund acknowledgment)
- Tours page redesigned with filters (All/Popular/Recent/My Tours), venue picker for creation
- Tours added to web navbar
- Firestore rules updated: curators can create/update own tours, delete own drafts

### iOS Design Overhaul
- **Design system components:** PageHeader, SectionHeader, DocentSearchBar, DocentLoader, WarmShadow, CardPressStyle, StaggeredAppear, StaggeredTextBlock, BlurFadeEdge, OysterBackground
- **Navigation bar:** custom back arrow (arrow.left), sans-serif title, oyster background, dark charcoal tint
- **Venue detail hero:** full-width image carousel with gradient overlay, venue name + type on image
- **Discover cards:** hero image with gradient overlay, white text, stars on image, glass effect. Placeholder for venues without images.
- **Photo viewer:** redesigned MediaViewer — solid black background, X button, 20pt margins, pagination dots, caption spacing
- **Gallery grid:** masonry layout (1 large + 2 small alternating), dark background, monospaced photo count
- **Branded loader:** DocentLoader with pulsing logo, replaced ProgressView across all main views
- **Micro-interactions:** staggered list entrance, card press scale (0.98), image fade-in on load, tab switch animations
- **Oyster background:** applied to all tabs, detail views, sub-pages via UIKit appearance + per-view .background(Theme.oyster)
- **Card styling:** warm shadows, softened borders (0.12 opacity), oyster backgrounds
- **Search bars:** unified DocentSearchBar with magnifying glass icon, focus animation, suggestions support
- **Headers:** all page headers use system sans-serif semibold 28pt, section headers 22pt
- **Home feed:** "Welcome back, [Name]" + notification bell, sans-serif section headers
- **Report menu:** rewrote to write to Firestore reports collection (was mailto:), category picker, success confirmation
- **Groups share card:** fixed Instagram sharing (UIActivityViewController instead of ShareLink)

### Groups Enhancements
- Decline invite notification: push to host + activity in host's followActivity
- "My Groups" filter in GroupsDiscoveryView
- Group deep link support (notification tap → GroupDetailView)
- CreateGroupView oyster background

### Notifications
- NotificationsView: shows follows, group invites/joins/declines, review likes
- Accessible from bell icon on Home page

### Cloud Functions Deployed
- onCuratorApproved (welcome email)
- onGroupInviteDeclined (push to host)
- curatorEligible check in submitReview
- Firestore rules: tours write for curators, purchasedTours, purchases

### Web Changes (on main)
- Password eye toggle on login
- Button hover lift, input focus polish
- CSS animations (fadeIn, slideUp, confettiFall)

---

## Session 10 — 2026-04-30

### Database Infrastructure (major architecture work)
- parentGalleryId, healthFlags, lastAuditedAt fields
- exhibitLifecycle, weeklyVenueAudit, batchUpdateDocs Cloud Functions
- Notion Exhibits DB created

### Major Gallery Normalization — Per-Address Venues
- Gagosian (17 venues), Hauser & Wirth, Matthew Marks, Perrotin Paris, David Zwirner NYC, Pace NYC

### Gallery Exhibit Audits
- Perrotin, Gagosian, Jessica Silverman, Pace, David Kordansky, Haines, Regen

---

## Session 9 — 2026-04-26 to 2026-04-27

### Docent Groups — Full Feature Build (Phases 1-3)
- VenueGroup model, GroupsRepository, all CRUD
- VenueGroupsListView, CreateGroupView, GroupDetailView, EditGroupView, GroupPhotoAlbumView, GroupsDiscoveryView, InviteToGroupView
- Cloud Functions: onGroupMemberAdded, onGroupInvite, onGroupPhotoAdded, onGroupMessage, onGroupUpdated
