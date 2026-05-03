# Docent MCP Server

MCP server for managing the Docent app's Firestore data and Firebase Storage images.

## Setup

1. Generate a Firebase service account key from the [Firebase Console](https://console.firebase.google.com/project/docent-76d5a/settings/serviceaccounts/adminsdk) and save it to this directory as `service-account.json`.

2. Install and build:
   ```bash
   cd ~/Desktop/Docent/mcp-server
   npm install
   npm run build
   ```

3. Add to your Kiro MCP config (`~/.kiro/settings/mcp.json`):
   ```json
   {
     "mcpServers": {
       "docent": {
         "command": "node",
         "args": ["/Users/skyjung/Desktop/Docent/mcp-server/dist/index.js"],
         "env": {
           "GOOGLE_APPLICATION_CREDENTIALS": "/Users/skyjung/Desktop/Docent/mcp-server/service-account.json"
         }
       }
     }
   }
   ```

4. Restart Kiro CLI.

## Tools (59 total)

### Browse Data

> "List all museums"
> "Show me all galleries"
> "Get the details for museum abc123"
> "List all reviews for SFMOMA"
> "Show me all exhibits at gallery xyz"
> "What tours are published?"
> "List the stops for tour abc"

### Add Venues

> "Add a new museum called The Met in New York, NY"
> "Add a gallery called Pace Gallery in New York, NY with description 'Contemporary art gallery founded in 1960'"
> "Add an exhibit called 'Impressionist Dreams' to gallery xyz by Claude Monet"

### Update Content

> "Update the about text for museum abc123 to 'The San Francisco Museum of Modern Art...'"
> "Change the description on gallery xyz to 'A contemporary art space in Chelsea'"
> "Update the name of museum abc123 to 'SF MOMA'"

### Image Management

> "Upload ~/Downloads/sfmoma.jpg as the image for museum abc123"
> "Upload ~/Desktop/pace-exterior.png as the image for gallery xyz"
> "Upload ~/Photos/exhibit-banner.jpg to Firebase Storage"

### User Data

> "List saved museums for user uid123"
> "Show me who user uid123 is following"
> "List completed tours for user uid123"
> "What galleries has user uid123 saved?"

### Flexible Queries

> "Find all reviews with rating 5"
> "Show me reviews by user uid123 sorted by date"
> "Find all exhibits at museum abc123"
> "List galleries that have no description"
> "Find all museums in San Francisco, CA"

### Manage Data

> "Delete review abc123"
> "Remove the saved museum entry for user uid123"
> "Delete tour stop 3 from tour xyz"

## Tool Reference

| Category | Tools | Description |
|----------|-------|-------------|
| Museums | `list_museums`, `get_museum`, `create_museum`, `update_museum`, `delete_museum`, `add_museum` | Full CRUD + quick-add |
| Galleries | `list_galleries`, `get_gallery`, `create_gallery`, `update_gallery`, `delete_gallery`, `add_gallery` | Full CRUD + quick-add |
| Exhibits | `list_exhibits`, `get_exhibit`, `create_exhibit`, `update_exhibit`, `delete_exhibit`, `add_exhibit` | Full CRUD + quick-add |
| Reviews | `list_reviews`, `get_review`, `create_review`, `update_review`, `delete_review` | Full CRUD |
| Tours | `list_tours`, `get_tour`, `create_tour`, `update_tour`, `delete_tour` | Full CRUD |
| Tour Stops | `list_tour_stops`, `get_tour_stop`, `set_tour_stop`, `delete_tour_stop` | Subcollection CRUD |
| Users | `list_users`, `get_user`, `create_user`, `update_user`, `delete_user` | Full CRUD |
| User Subs | `list_user_*`, `set_user_*_item`, `delete_user_*_item` | savedMuseums, savedGalleries, savedTours, completedTours, following, stopUploads |
| Images | `upload_image`, `update_image` | Upload to Storage, optionally set on document |
| Content | `update_about` | Quick description update |
| Queries | `query_collection` | Flexible where/orderBy/limit on any collection |
