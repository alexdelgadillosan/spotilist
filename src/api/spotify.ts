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
    throw new Error(`Spotify API ${res.status}: ${text}`);
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
  images: { url: string }[];
  tracks: { total: number };
  owner: { display_name: string | null; id: string };
};

export type SpotifyTrackItem = {
  track: {
    id: string;
    name: string;
    duration_ms: number;
    artists: { name: string }[];
    album: { name: string; images: { url: string }[] };
  } | null;
};

export async function getMe(): Promise<SpotifyUser> {
  return api<SpotifyUser>('/me');
}

export async function getMyPlaylists(
  limit = 50,
  offset = 0
): Promise<{ items: SpotifyPlaylist[]; total: number; next: string | null }> {
  return api(`/me/playlists?limit=${limit}&offset=${offset}`);
}

export async function getAllPlaylists(): Promise<SpotifyPlaylist[]> {
  const all: SpotifyPlaylist[] = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await getMyPlaylists(50, offset);
    all.push(...page.items);
    total = page.total;
    offset += page.items.length;
    if (!page.items.length) break;
  }
  return all;
}

export async function getPlaylistTracks(
  playlistId: string,
  limit = 50,
  offset = 0
): Promise<{ items: SpotifyTrackItem[]; total: number }> {
  return api(
    `/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}&fields=total,items(track(id,name,duration_ms,artists(name),album(name,images)))`
  );
}
