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

export type SpotifyPlaylist = {
  id: string;
  name: string;
  images?: { url: string }[] | null;
  tracks?: { total?: number; href?: string } | null;
  owner?: { display_name: string | null; id: string };
  collaborative?: boolean;
  public?: boolean | null;
};

export type SpotifyTrackItem = {
  added_at?: string | null;
  track: {
    id: string;
    name: string;
    duration_ms: number;
    type?: string;
    is_playable?: boolean;
    artists: { name: string }[];
    album: { name: string; images: { url: string }[] };
    restrictions?: { reason?: string };
  } | null;
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

/** /me/playlists often returns tracks.total as 0 — hydrate from playlist detail. */
export async function getPlaylistMeta(
  playlistId: string
): Promise<Pick<SpotifyPlaylist, 'id' | 'name' | 'images' | 'tracks'>> {
  return api(
    `/playlists/${encodeURIComponent(playlistId)}?fields=id,name,images,tracks.total`
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

  // Hydrate totals — list endpoint is unreliable for tracks.total
  const hydrated = await mapPool(all, 6, async (p) => {
    const listedTotal = p.tracks?.total;
    if (typeof listedTotal === 'number' && listedTotal > 0) {
      return p;
    }
    try {
      const meta = await getPlaylistMeta(p.id);
      return {
        ...p,
        name: meta.name || p.name,
        images: meta.images?.length ? meta.images : p.images,
        tracks: {
          ...(p.tracks || {}),
          total: meta.tracks?.total ?? listedTotal ?? 0,
        },
      };
    } catch {
      return p;
    }
  });

  return hydrated;
}

/**
 * Get Playlist Items — https://developer.spotify.com/documentation/web-api/reference/get-playlists-items
 * - Endpoint: GET /playlists/{id}/items (max limit 50)
 * - market=from_token enables track relinking for the user
 * - Removed/unavailable catalog items return track: null (still count toward total)
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
      track?: SpotifyTrackItem['track'] | null;
      episode?: SpotifyTrackItem['track'] | null;
    }>;
    total?: number;
  }>(
    `/playlists/${encodeURIComponent(playlistId)}/items?limit=${capped}&offset=${offset}&market=from_token&additional_types=track,episode`
  );

  const items: SpotifyTrackItem[] = (page?.items || []).map((item) => ({
    added_at: item?.added_at,
    track: item?.track ?? item?.episode ?? null,
  }));

  return {
    items,
    total: typeof page?.total === 'number' ? page.total : items.length,
  };
}
