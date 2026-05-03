# Location Share Card — Feature Spec

## What It Is
A shareable card that appears when a user shares their current exhibit/venue location via iMessage, WhatsApp, or any share sheet. Think Apple Maps location share, but for art. Instead of "Sky is at 151 3rd St," it says "Sky is at *Caravaggio: The Last Two Decades* at The Met."

## The Card

```
┌─────────────────────────────────────┐
│  📍 DOCENT                          │
│                                     │
│  ┌─────────────────────────────┐    │
│  │                             │    │
│  │    [Exhibit/Venue Image]    │    │
│  │                             │    │
│  └─────────────────────────────┘    │
│                                     │
│  Meet me at the Caravaggio          │
│                                     │
│  Caravaggio: The Last Two Decades   │
│  The Metropolitan Museum of Art     │
│  Gallery 621, Floor 2               │
│                                     │
│  ┌──────────┐                       │
│  │ Open in  │                       │
│  │ Docent ↗ │                       │
│  └──────────┘                       │
└─────────────────────────────────────┘
```

### Card Elements
- **Header:** Docent logo mark + "DOCENT" in small caps
- **Image:** Exhibit banner or venue image (from `imageUrl`)
- **Custom message:** User-editable, defaults to "Meet me at the [artist/exhibit short name]"
- **Exhibit title:** Full title from exhibit doc
- **Venue name:** From museum/gallery doc
- **Location detail:** `exhibit.location` field (e.g. "Gallery 621, Floor 2") — already in the data model
- **CTA:** "Open in Docent" deep link → opens exhibit detail in app, or App Store if not installed

### Visual Style
- Background: `--ivory` (#F9F8F6)
- Border: 1px `--sand`, rounded 12px
- Font: Lora for the custom message, Inter for metadata
- Image: 16:9 aspect ratio, rounded 8px
- Minimal. No gradients, no shadows. Museum wall label energy.

## User Flow (iOS)

1. User is on ExhibitDetailView or VenueDetailView
2. Taps share button (already exists in nav bar)
3. Share sheet shows "Share Location Card" option
4. Card preview appears with editable message field (pre-filled: "Meet me at the [name]")
5. User taps Send → generates card image + deep link
6. Recipient sees rich preview in iMessage/WhatsApp
7. Tapping the card opens Docent to that exhibit

## Implementation

### iOS (SwiftUI)
- `LocationShareCard` view — renders the card as a SwiftUI view
- `ShareCardRenderer` — converts the view to UIImage via `ImageRenderer`
- Deep link: `docent://exhibit/{exhibitId}` or universal link `docentofficial.com/exhibit/{exhibitId}`
- Share via `UIActivityViewController` with the image + URL
- Data needed: exhibit title, artist, venue name, venue location, exhibit.location, imageUrl

### Data (already available)
- `exhibits.title`, `exhibits.artist`, `exhibits.imageUrl`, `exhibits.location`
- `exhibits.venueId` → look up `museums.name` or `galleries.name`
- `museums.location` / `galleries.location` for address

### Deep Links (new)
- Register URL scheme: `docent://`
- Universal links: `docentofficial.com/exhibit/{id}`, `docentofficial.com/museum/{id}`
- App delegate handles routing to correct detail view

## Reel Integration

For Reel 4 ("The Text"), the card appears in the iMessage thread:
- First text: "Where are you?"
- Second text: the Docent location share card showing the Caravaggio exhibit
- The card IS the reply. No words needed.

The card should look native to iMessage — like a rich link preview, not a screenshot. This means the universal link needs proper Open Graph meta tags on the web so iMessage renders a rich preview automatically.

### Open Graph Tags (docent-web)
```html
<!-- docentofficial.com/exhibit/{id} -->
<meta property="og:title" content="Meet me at the Caravaggio" />
<meta property="og:description" content="Caravaggio: The Last Two Decades · The Met · Gallery 621" />
<meta property="og:image" content="{exhibit.imageUrl}" />
<meta property="og:url" content="https://docentofficial.com/exhibit/{id}" />
```

## Priority
- Phase 1: Share card image generation (iOS) — works with any messaging app
- Phase 2: Universal links + OG tags (web) — rich previews in iMessage
- Phase 3: Deep link handling — tap card → opens exhibit in app
