# Spotilist

Bulk-edit Spotify playlists — merge, dedupe, multi-select ops, and genre-based mixes.

**Live:** https://alexdelgadillosan.github.io/spotilist/

## What works now

- **Connect Spotify** via OAuth **Authorization Code + PKCE** (safe for GitHub Pages)
- List your playlists and browse tracks
- Log out

Bulk edit / merge / genre mix come next.

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

`playlist-read-private`, `playlist-modify-public`, `playlist-modify-private`, `user-library-read`, `user-read-email`

## Stack

Vite · TypeScript · Spotify Web API (PKCE)
