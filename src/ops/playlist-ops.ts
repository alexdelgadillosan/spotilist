import type { SpotifyTrackItem } from '../api/spotify';

export type TrackFilter = {
  query: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  addedAfter?: string; // YYYY-MM-DD
  addedBefore?: string;
  explicitOnly?: boolean;
  hideUnavailable?: boolean;
};

export function trackUri(item: SpotifyTrackItem): string | null {
  const t = item.item;
  if (!t) return null;
  if (t.uri) return t.uri;
  if (!t.id) return null;
  return `spotify:${t.type === 'episode' ? 'episode' : 'track'}:${t.id}`;
}

export function dedupeUris(uris: string[]): { unique: string[]; duplicateCount: number } {
  const seen = new Set<string>();
  const unique: string[] = [];
  let duplicateCount = 0;
  for (const uri of uris) {
    if (!uri) continue;
    if (seen.has(uri)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(uri);
    unique.push(uri);
  }
  return { unique, duplicateCount };
}

export function urisFromItems(items: SpotifyTrackItem[]): string[] {
  return items.map(trackUri).filter((u): u is string => !!u);
}

export function mergePreview(sourceUriLists: string[][]): {
  unique: string[];
  totalRaw: number;
  duplicateCount: number;
} {
  const flat = sourceUriLists.flat();
  const { unique, duplicateCount } = dedupeUris(flat);
  return { unique, totalRaw: flat.length, duplicateCount };
}

export function applyTrackFilter(
  items: SpotifyTrackItem[],
  filter: TrackFilter
): SpotifyTrackItem[] {
  const q = filter.query.trim().toLowerCase();
  return items.filter((row) => {
    const t = row.item;
    if (!t) {
      return filter.hideUnavailable ? false : !q;
    }
    if (filter.hideUnavailable && t.is_playable === false) return false;

    if (q) {
      const hay = [
        t.name,
        t.album?.name,
        ...(t.artists || []).map((a) => a.name),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }

    if (typeof filter.minDurationMs === 'number' && t.duration_ms < filter.minDurationMs) {
      return false;
    }
    if (typeof filter.maxDurationMs === 'number' && t.duration_ms > filter.maxDurationMs) {
      return false;
    }

    if (filter.explicitOnly && !t.explicit) return false;

    if (filter.addedAfter && row.added_at) {
      if (row.added_at.slice(0, 10) < filter.addedAfter) return false;
    }
    if (filter.addedBefore && row.added_at) {
      if (row.added_at.slice(0, 10) > filter.addedBefore) return false;
    }

    return true;
  });
}

export function parseMinutesToMs(value: string): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || value.trim() === '') return undefined;
  return Math.round(n * 60_000);
}
