import type { SpotifyTrackItem } from '../api/spotify';
import { trackUri } from './playlist-ops';

export const EXPORT_VERSION = 2 as const;

export type ExportTrack = {
  uri: string;
  name: string;
  artists: string;
  album: string;
  duration_ms: number;
  added_at: string;
};

export type ExportPlaylist = {
  id: string;
  name: string;
  tracks: ExportTrack[];
};

/** Current multi-playlist export format. */
export type SpotilistExportV2 = {
  version: 2;
  exportedAt: string;
  playlists: ExportPlaylist[];
};

/** Legacy single-playlist export (still accepted on import). */
export type SpotilistExportV1 = {
  version: 1;
  exportedAt: string;
  source: { id: string; name: string };
  tracks: ExportTrack[];
};

export type ImportPlaylistBundle = {
  name: string;
  uris: string[];
};

export type ImportParseResult = {
  playlists: ImportPlaylistBundle[];
  skipped: number;
  errors: string[];
};

const URI_RE = /^spotify:(track|episode):[A-Za-z0-9]+$/;

export function isValidSpotifyUri(uri: string): boolean {
  return URI_RE.test(uri.trim());
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'playlist'
  );
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Minimal RFC4180-ish CSV line parser. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function itemsToExportTracks(items: SpotifyTrackItem[]): ExportTrack[] {
  const out: ExportTrack[] = [];
  for (const row of items) {
    const uri = trackUri(row);
    if (!uri) continue;
    const t = row.item!;
    out.push({
      uri,
      name: t.name || '',
      artists: (t.artists || []).map((a) => a.name).join(', '),
      album: t.album?.name || '',
      duration_ms: t.duration_ms || 0,
      added_at: row.added_at || '',
    });
  }
  return out;
}

function dedupeUris(uris: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of uris) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function nameHintFromFilename(filename: string): string {
  const base = filename.replace(/\.(json|csv)$/i, '').replace(/^spotilist-/i, '');
  return base.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-/g, ' ').trim() || 'Imported playlist';
}

export function buildMultiExport(
  sources: Array<{ id: string; name: string; items: SpotifyTrackItem[] }>
): {
  json: string;
  csv: string;
  filenameBase: string;
  playlistCount: number;
  trackCount: number;
} {
  const playlists: ExportPlaylist[] = sources.map((s) => ({
    id: s.id,
    name: s.name,
    tracks: itemsToExportTracks(s.items),
  }));

  const payload: SpotilistExportV2 = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    playlists,
  };

  const header = 'playlist,uri,name,artists,album,duration_ms,added_at';
  const rows: string[] = [];
  let trackCount = 0;
  for (const pl of playlists) {
    for (const t of pl.tracks) {
      trackCount += 1;
      rows.push(
        [
          pl.name,
          t.uri,
          t.name,
          t.artists,
          t.album,
          String(t.duration_ms),
          t.added_at,
        ]
          .map(csvEscape)
          .join(',')
      );
    }
  }
  const csv = [header, ...rows].join('\n') + '\n';
  const date = payload.exportedAt.slice(0, 10);
  const filenameBase =
    playlists.length === 1
      ? `spotilist-${slugify(playlists[0].name)}-${date}`
      : `spotilist-${playlists.length}-playlists-${date}`;

  return {
    json: JSON.stringify(payload, null, 2),
    csv,
    filenameBase,
    playlistCount: playlists.length,
    trackCount,
  };
}

/** Single-playlist helper (wraps buildMultiExport). */
export function buildExport(
  source: { id: string; name: string },
  items: SpotifyTrackItem[]
): {
  json: string;
  csv: string;
  filenameBase: string;
  playlistCount: number;
  trackCount: number;
} {
  return buildMultiExport([{ ...source, items }]);
}

function tracksFromUnknown(rows: unknown[]): { uris: string[]; skipped: number } {
  const raw: string[] = [];
  let skipped = 0;
  for (const row of rows) {
    const uri =
      row && typeof row === 'object' && typeof (row as ExportTrack).uri === 'string'
        ? (row as ExportTrack).uri.trim()
        : '';
    if (uri && isValidSpotifyUri(uri)) raw.push(uri);
    else skipped += 1;
  }
  return { uris: dedupeUris(raw), skipped };
}

function parseJsonImport(text: string, filename: string): ImportParseResult {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      playlists: [],
      skipped: 0,
      errors: ['Invalid JSON file.'],
    };
  }

  const obj = data as Record<string, unknown>;

  // v2 multi-playlist
  if (Array.isArray(obj.playlists)) {
    const playlists: ImportPlaylistBundle[] = [];
    let skipped = 0;
    for (const entry of obj.playlists) {
      if (!entry || typeof entry !== 'object') {
        skipped += 1;
        continue;
      }
      const pl = entry as { name?: unknown; tracks?: unknown };
      const name =
        typeof pl.name === 'string' && pl.name.trim()
          ? pl.name.trim()
          : nameHintFromFilename(filename);
      if (!Array.isArray(pl.tracks)) {
        errors.push(`Playlist “${name}” missing tracks array.`);
        continue;
      }
      const { uris, skipped: s } = tracksFromUnknown(pl.tracks);
      skipped += s;
      if (uris.length) playlists.push({ name, uris });
    }
    if (obj.version != null && obj.version !== 1 && obj.version !== 2) {
      errors.push(`Unrecognized export version ${String(obj.version)}; importing URIs anyway.`);
    }
    return { playlists, skipped, errors };
  }

  // v1 single playlist
  const source = obj.source as { name?: string } | undefined;
  const nameHint =
    (source && typeof source.name === 'string' ? source.name : '') ||
    nameHintFromFilename(filename);

  if (!Array.isArray(obj.tracks)) {
    return {
      playlists: [],
      skipped: 0,
      errors: ['JSON missing playlists or tracks array.'],
    };
  }

  const { uris, skipped } = tracksFromUnknown(obj.tracks);
  return {
    playlists: uris.length ? [{ name: nameHint, uris }] : [],
    skipped,
    errors,
  };
}

function parseCsvImport(text: string, filename: string): ImportParseResult {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (!lines.length) {
    return {
      playlists: [],
      skipped: 0,
      errors: ['CSV file is empty.'],
    };
  }

  const headerCells = parseCsvLine(lines[0]).map((c) => c.trim().toLowerCase());
  let uriIdx = headerCells.indexOf('uri');
  const playlistIdx = headerCells.indexOf('playlist');
  const start = uriIdx >= 0 ? 1 : 0;
  if (uriIdx < 0) {
    uriIdx = playlistIdx >= 0 ? 1 : 0;
  }

  const byName = new Map<string, string[]>();
  let skipped = 0;
  const defaultName = nameHintFromFilename(filename);

  for (let i = start; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const uri = (cells[uriIdx] || '').trim();
    if (!uri || !isValidSpotifyUri(uri)) {
      skipped += 1;
      continue;
    }
    const plName =
      playlistIdx >= 0
        ? (cells[playlistIdx] || '').trim() || defaultName
        : defaultName;
    const list = byName.get(plName) || [];
    list.push(uri);
    byName.set(plName, list);
  }

  const playlists: ImportPlaylistBundle[] = [...byName.entries()].map(([name, uris]) => ({
    name,
    uris: dedupeUris(uris),
  }));

  return { playlists, skipped, errors: [] };
}

export function parseImportFile(text: string, filename: string): ImportParseResult {
  const trimmed = text.trim();
  const lower = filename.toLowerCase();
  const asJson =
    lower.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[');
  if (asJson && !lower.endsWith('.csv')) {
    return parseJsonImport(text, filename);
  }
  return parseCsvImport(text, filename);
}

export function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
