import { getAccessToken, logout } from '../auth/spotify-auth';

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function api<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }

  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (res.status === 401) {
    logout();
    throw new Error('Unauthorized — please Connect Spotify again.');
  }

  if (res.status === 429 && attempt < 4) {
    const retryAfter = Number(res.headers.get('Retry-After') || '1');
    await sleep(Math.max(retryAfter, 1) * 1000);
    return api(path, init, attempt + 1);
  }

  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const j = JSON.parse(text) as { error?: { message?: string; status?: number } };
      if (j.error?.message) detail = j.error.message;
    } catch {
      /* keep raw */
    }
    if (res.status === 403) {
      throw new Error(
        `Forbidden (403): ${detail}. Log out and Connect again, or try another playlist.`
      );
    }
    throw new Error(`Spotify API ${res.status}: ${detail}`);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export type SpotifyUser = {
  id: string;
  display_name: string | null;
  images?: { url: string }[];
};

/** Playlist item count — prefer `items` (tracks is deprecated). */
export type SpotifyPlaylist = {
  id: string;
  name: string;
  images?: { url: string }[] | null;
  items?: { total?: number; href?: string } | null;
  /** @deprecated Use `items` — still returned by some endpoints during transition. */
  tracks?: { total?: number; href?: string } | null;
  owner?: { display_name: string | null; id: string };
  collaborative?: boolean;
  public?: boolean | null;
  /** Virtual Liked Songs collection (not a real playlist id). */
  isLikedSongs?: boolean;
};

/** Sentinel id for the virtual Liked Songs row in the UI. */
export const LIKED_SONGS_ID = '__liked_songs__';

export function isLikedSongs(pl: { id: string; isLikedSongs?: boolean } | string): boolean {
  const id = typeof pl === 'string' ? pl : pl.id;
  return id === LIKED_SONGS_ID || (typeof pl !== 'string' && !!pl.isLikedSongs);
}

export function makeLikedSongsPlaylist(total = 0): SpotifyPlaylist {
  return {
    id: LIKED_SONGS_ID,
    name: 'Liked Songs',
    isLikedSongs: true,
    items: { total },
    public: false,
  };
}

export function playlistItemCount(p: SpotifyPlaylist): number | undefined {
  const n = p.items?.total ?? p.tracks?.total;
  return typeof n === 'number' ? n : undefined;
}

export type SpotifyTrackRef = {
  id: string;
  uri?: string;
  name: string;
  duration_ms: number;
  type?: string;
  explicit?: boolean;
  is_playable?: boolean;
  artists: { name: string; id?: string }[];
  album: { name: string; images: { url: string }[] };
  restrictions?: { reason?: string };
};

export type SpotifyTrackItem = {
  added_at?: string | null;
  /** Playable catalog object, or null if removed / unavailable. */
  item: SpotifyTrackRef | null;
};

/** Build a Spotify URI when the API omits `uri` but returns id + type. */
export function ensureItemUri(t: SpotifyTrackRef | null | undefined): string | null {
  if (!t) return null;
  if (t.uri) return t.uri;
  if (!t.id) return null;
  const kind = t.type === 'episode' ? 'episode' : 'track';
  return `spotify:${kind}:${t.id}`;
}

function mapPlaylistRow(row: {
  added_at?: string | null;
  item?: SpotifyTrackRef | null;
  track?: SpotifyTrackRef | null;
}): SpotifyTrackItem {
  const raw = row?.item ?? row?.track ?? null;
  if (!raw) return { added_at: row?.added_at, item: null };
  const uri = ensureItemUri(raw);
  return {
    added_at: row?.added_at,
    item: uri ? { ...raw, uri } : raw,
  };
}

export async function getMe(): Promise<SpotifyUser> {
  return api<SpotifyUser>('/me');
}

export async function getMyPlaylists(
  limit = 50,
  offset = 0
): Promise<{ items: (SpotifyPlaylist | null)[]; total: number; next: string | null }> {
  return api(`/me/playlists?limit=${limit}&offset=${offset}`);
}

/** Hydrate item count — list endpoint often returns 0 for totals. */
export async function getPlaylistMeta(
  playlistId: string
): Promise<Pick<SpotifyPlaylist, 'id' | 'name' | 'images' | 'items'>> {
  return api(
    `/playlists/${encodeURIComponent(playlistId)}?fields=id,name,images,items.total`
  );
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

export async function getAllPlaylists(): Promise<SpotifyPlaylist[]> {
  const all: SpotifyPlaylist[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await getMyPlaylists(50, offset);
    const items = (page.items || []).filter(
      (p): p is SpotifyPlaylist => !!p && !!p.id
    );
    all.push(...items);
    total = typeof page.total === 'number' ? page.total : all.length;
    offset += (page.items || []).length;
    if (!(page.items || []).length) break;
  }

  const hydrated = await mapPool(all, 6, async (p) => {
    const listedTotal = playlistItemCount(p);
    if (typeof listedTotal === 'number' && listedTotal > 0) {
      return p;
    }
    try {
      const meta = await getPlaylistMeta(p.id);
      const totalItems = meta.items?.total ?? listedTotal ?? 0;
      return {
        ...p,
        name: meta.name || p.name,
        images: meta.images?.length ? meta.images : p.images,
        items: {
          ...(p.items || {}),
          total: totalItems,
        },
      };
    } catch {
      return p;
    }
  });

  return hydrated;
}

/**
 * Get Playlist Items (one page)
 * https://developer.spotify.com/documentation/web-api/reference/get-playlists-items
 */
export async function getPlaylistTracks(
  playlistId: string,
  limit = 50,
  offset = 0
): Promise<{ items: SpotifyTrackItem[]; total: number; next: string | null }> {
  const capped = Math.min(Math.max(limit, 1), 50);
  const page = await api<{
    items?: Array<{
      added_at?: string | null;
      item?: SpotifyTrackRef | null;
      track?: SpotifyTrackRef | null;
    }>;
    total?: number;
    next?: string | null;
  }>(
    `/playlists/${encodeURIComponent(playlistId)}/items?limit=${capped}&offset=${offset}&market=from_token`
  );

  const items = (page?.items || []).map(mapPlaylistRow);
  return {
    items,
    total: typeof page?.total === 'number' ? page.total : items.length,
    next: page?.next ?? null,
  };
}

export async function getAllPlaylistItems(
  playlistId: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<{ items: SpotifyTrackItem[]; total: number }> {
  const all: SpotifyTrackItem[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const page = await getPlaylistTracks(playlistId, 50, offset);
    all.push(...page.items);
    total = page.total;
    offset += page.items.length;
    onProgress?.(all.length, total);
    if (!page.items.length || !page.next) break;
  }

  return { items: all, total: typeof total === 'number' && total !== Infinity ? total : all.length };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** POST /me/playlists — https://developer.spotify.com/documentation/web-api/reference/create-playlist */
export async function createPlaylist(opts: {
  name: string;
  public?: boolean;
  description?: string;
}): Promise<SpotifyPlaylist & { uri?: string; external_urls?: { spotify?: string } }> {
  const created = await api<SpotifyPlaylist & { uri?: string; external_urls?: { spotify?: string } }>(
    '/me/playlists',
    {
      method: 'POST',
      body: JSON.stringify({
        name: opts.name,
        // Spotify default is public; private playlists are easy to miss in the app UI
        public: opts.public ?? true,
        description: opts.description ?? '',
      }),
    }
  );

  // Feb 2026+: created playlists may not appear in Your Library until saved
  const playlistUri = created.uri || (created.id ? `spotify:playlist:${created.id}` : null);
  if (playlistUri) {
    try {
      await saveToLibrary([playlistUri]);
    } catch {
      /* still return created playlist; open URL can recover */
    }
  }

  return created;
}

/**
 * PUT /playlists/{id} — rename / change details
 * https://developer.spotify.com/documentation/web-api/reference/change-playlist-details
 */
export async function renamePlaylist(playlistId: string, name: string): Promise<void> {
  await api(`/playlists/${encodeURIComponent(playlistId)}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

/**
 * PUT /me/library — save playlists/tracks/etc. to Your Library
 * https://developer.spotify.com/documentation/web-api/reference/save-library-items
 */
export async function saveToLibrary(uris: string[]): Promise<void> {
  const list = [...new Set(uris.filter(Boolean))];
  for (const batch of chunk(list, 40)) {
    const qs = encodeURIComponent(batch.join(','));
    await api(`/me/library?uris=${qs}`, { method: 'PUT' });
  }
}

/**
 * DELETE /me/library — unlike / remove from library
 * https://developer.spotify.com/documentation/web-api/reference/remove-library-items
 */
export async function removeFromLibrary(uris: string[]): Promise<void> {
  const list = [...new Set(uris.filter(Boolean))];
  for (const batch of chunk(list, 40)) {
    const qs = encodeURIComponent(batch.join(','));
    await api(`/me/library?uris=${qs}`, { method: 'DELETE' });
  }
}

/** Unfollow / remove playlist from Your Library (Spotify has no hard delete). */
export async function deletePlaylistFromLibrary(playlistId: string): Promise<void> {
  await removeFromLibrary([`spotify:playlist:${playlistId}`]);
}

export function playlistOpenUrl(
  pl: { id: string; external_urls?: { spotify?: string }; isLikedSongs?: boolean }
): string {
  if (isLikedSongs(pl)) return 'https://open.spotify.com/collection/tracks';
  return pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}`;
}

/**
 * GET /me/tracks — Liked Songs (Your Music)
 * https://developer.spotify.com/documentation/web-api/reference/get-users-saved-tracks
 */
export async function getLikedSongsPage(
  limit = 50,
  offset = 0
): Promise<{ items: SpotifyTrackItem[]; total: number; next: string | null }> {
  const capped = Math.min(Math.max(limit, 1), 50);
  const page = await api<{
    items?: Array<{
      added_at?: string | null;
      track?: SpotifyTrackRef | null;
    }>;
    total?: number;
    next?: string | null;
  }>(`/me/tracks?limit=${capped}&offset=${offset}&market=from_token`);

  const items: SpotifyTrackItem[] = (page?.items || []).map((row) => {
    const raw = row?.track ?? null;
    if (!raw) return { added_at: row?.added_at, item: null };
    const uri = ensureItemUri(raw);
    return { added_at: row?.added_at, item: uri ? { ...raw, uri } : raw };
  });

  return {
    items,
    total: typeof page?.total === 'number' ? page.total : items.length,
    next: page?.next ?? null,
  };
}

export async function getLikedSongsTotal(): Promise<number> {
  const page = await getLikedSongsPage(1, 0);
  return page.total;
}

export async function getAllLikedSongs(
  onProgress?: (loaded: number, total: number) => void
): Promise<{ items: SpotifyTrackItem[]; total: number }> {
  const all: SpotifyTrackItem[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const page = await getLikedSongsPage(50, offset);
    all.push(...page.items);
    total = page.total;
    offset += page.items.length;
    onProgress?.(all.length, total);
    if (!page.items.length || !page.next) break;
  }

  return {
    items: all,
    total: typeof total === 'number' && total !== Infinity ? total : all.length,
  };
}

/** POST /playlists/{id}/items — max 100 uris per request */
export async function addPlaylistItems(
  playlistId: string,
  uris: string[]
): Promise<void> {
  const unique = [...new Set(uris.filter(Boolean))];
  for (const batch of chunk(unique, 100)) {
    await api(`/playlists/${encodeURIComponent(playlistId)}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: batch }),
    });
  }
}

/** DELETE /playlists/{id}/items — max 100 items per request */
export async function removePlaylistItems(
  playlistId: string,
  uris: string[]
): Promise<void> {
  const unique = [...new Set(uris.filter(Boolean))];
  for (const batch of chunk(unique, 100)) {
    await api(`/playlists/${encodeURIComponent(playlistId)}/items`, {
      method: 'DELETE',
      body: JSON.stringify({
        items: batch.map((uri) => ({ uri })),
      }),
    });
  }
}

/**
 * PUT /playlists/{id}/items — replace entire playlist contents (for dedupe).
 * Max 100 uris per request; first call replaces, subsequent append.
 */
export async function replacePlaylistItems(
  playlistId: string,
  uris: string[]
): Promise<void> {
  const batches = chunk(uris.filter(Boolean), 100);
  if (!batches.length) {
    await api(`/playlists/${encodeURIComponent(playlistId)}/items`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [] }),
    });
    return;
  }
  for (let i = 0; i < batches.length; i++) {
    if (i === 0) {
      await api(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: 'PUT',
        body: JSON.stringify({ uris: batches[i] }),
      });
    } else {
      await api(`/playlists/${encodeURIComponent(playlistId)}/items`, {
        method: 'POST',
        body: JSON.stringify({ uris: batches[i] }),
      });
    }
  }
}
