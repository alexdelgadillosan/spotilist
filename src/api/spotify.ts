import { getAccessToken, logout } from '../auth/spotify-auth';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
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

  return (await res.json()) as T;
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
};

export function playlistItemCount(p: SpotifyPlaylist): number | undefined {
  const n = p.items?.total ?? p.tracks?.total;
  return typeof n === 'number' ? n : undefined;
}

export type SpotifyTrackRef = {
  id: string;
  name: string;
  duration_ms: number;
  type?: string;
  is_playable?: boolean;
  artists: { name: string }[];
  album: { name: string; images: { url: string }[] };
  restrictions?: { reason?: string };
};

export type SpotifyTrackItem = {
  added_at?: string | null;
  /** Playable catalog object, or null if removed / unavailable. */
  item: SpotifyTrackRef | null;
};

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
 * Get Playlist Items
 * https://developer.spotify.com/documentation/web-api/reference/get-playlists-items
 *
 * - GET /playlists/{id}/items (limit max 50)
 * - Response field is `item` (not deprecated `track`)
 * - market=from_token enables track relinking for the signed-in user
 * - Removed catalog entries return item: null (still count toward total)
 */
export async function getPlaylistTracks(
  playlistId: string,
  limit = 50,
  offset = 0
): Promise<{ items: SpotifyTrackItem[]; total: number }> {
  const capped = Math.min(Math.max(limit, 1), 50);
  const page = await api<{
    items?: Array<{
      added_at?: string | null;
      /** Current field per Web API docs. */
      item?: SpotifyTrackRef | null;
      /** @deprecated Use `item`. */
      track?: SpotifyTrackRef | null;
    }>;
    total?: number;
  }>(
    `/playlists/${encodeURIComponent(playlistId)}/items?limit=${capped}&offset=${offset}&market=from_token`
  );

  const items: SpotifyTrackItem[] = (page?.items || []).map((row) => ({
    added_at: row?.added_at,
    // Prefer `item`; fall back to deprecated `track` only if needed
    item: row?.item ?? row?.track ?? null,
  }));

  return {
    items,
    total: typeof page?.total === 'number' ? page.total : items.length,
  };
}
