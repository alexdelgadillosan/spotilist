# Spotilist

Bulk-edit Spotify playlists — merge, dedupe, multi-select ops, and filter-based mixes.

**Live:** https://alexdelgadillosan.github.io/spotilist/

## What works now

- **Connect Spotify** via OAuth **Authorization Code + PKCE** (safe for GitHub Pages)
- Search and browse your playlists (full item load with pagination)
- **Liked Songs** as a virtual library source (browse, multi-select, merge from, unlike)
- Multi-select tracks — bulk **add**, **move**, **delete**, or **new playlist**
- **Merge** playlists with dry-run preview + auto-dedupe
- **Dedupe** the active playlist
- Filter by title/artist/album, duration, date added, explicit
- Unavailable catalog items surfaced clearly

## One-time Spotify setup

1. Create an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)
2. Add **Redirect URIs** (exact):
   - `http://localhost:5173/`
   - `https://alexdelgadillosan.github.io/spotilist/`
3. Copy the **Client ID**

### Local

```bash
cp .env.example .env
# set VITE_SPOTIFY_CLIENT_ID=your_client_id
npm install
npm run dev
```

### GitHub Pages

Add repository secret **`VITE_SPOTIFY_CLIENT_ID`** (Settings → Secrets and variables → Actions), then push or re-run the deploy workflow.

## Scopes requested

`playlist-read-private`, `playlist-read-collaborative`, `playlist-modify-public`, `playlist-modify-private`, `user-library-read`, `user-library-modify`, `user-read-email`

## Stack

Vite · TypeScript · Spotify Web API (PKCE) — uses current `/playlists/{id}/items` and `POST /me/playlists` (not deprecated `/tracks` paths)
