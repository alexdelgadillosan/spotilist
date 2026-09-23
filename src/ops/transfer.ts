import type { SpotifyTrackItem } from '../api/spotify';
import { trackUri } from './playlist-ops';

export const EXPORT_VERSION = 1 as const;

export type ExportTrack = {
  uri: string;
  name: string;
  artists: string;
  album: string;
  duration_ms: number;
  added_at: string;
};

export type SpotilistExport = {
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  source: { id: string; name: string };
  tracks: ExportTrack[];
};

export type ImportParseResult = {
  nameHint: string;
  uris: string[];
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

export function buildExport(
  source: { id: string; name: string },
  items: SpotifyTrackItem[]
): { json: string; csv: string; filenameBase: string; trackCount: number } {
  const tracks = itemsToExportTracks(items);
  const payload: SpotilistExport = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    source: { id: source.id, name: source.name },
    tracks,
  };

  const header = 'uri,name,artists,album,duration_ms,added_at';
  const rows = tracks.map((t) =>
    [
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
  const csv = [header, ...rows].join('\n') + '\n';
  const date = payload.exportedAt.slice(0, 10);
  const filenameBase = `spotilist-${slugify(source.name)}-${date}`;

  return {
    json: JSON.stringify(payload, null, 2),
    csv,
    filenameBase,
    trackCount: tracks.length,
  };
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

function parseJsonImport(text: string, filename: string): ImportParseResult {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      nameHint: nameHintFromFilename(filename),
      uris: [],
      skipped: 0,
      errors: ['Invalid JSON file.'],
    };
  }

  const obj = data as Partial<SpotilistExport> & { tracks?: unknown };
  const nameHint =
    (obj.source && typeof obj.source === 'object' && typeof obj.source.name === 'string'
      ? obj.source.name
      : '') || nameHintFromFilename(filename);

  if (!Array.isArray(obj.tracks)) {
    return { nameHint, uris: [], skipped: 0, errors: ['JSON missing tracks array.'] };
  }

  const raw: string[] = [];
  let skipped = 0;
  for (const row of obj.tracks) {
    const uri =
      row && typeof row === 'object' && typeof (row as ExportTrack).uri === 'string'
        ? (row as ExportTrack).uri.trim()
        : '';
    if (uri && isValidSpotifyUri(uri)) raw.push(uri);
    else skipped += 1;
  }

  if (obj.version != null && obj.version !== EXPORT_VERSION) {
    errors.push(`Unrecognized export version ${String(obj.version)}; importing URIs anyway.`);
  }

  return { nameHint, uris: dedupeUris(raw), skipped, errors };
}

function parseCsvImport(text: string, filename: string): ImportParseResult {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (!lines.length) {
    return {
      nameHint: nameHintFromFilename(filename),
      uris: [],
      skipped: 0,
      errors: ['CSV file is empty.'],
    };
  }

  const headerCells = parseCsvLine(lines[0]).map((c) => c.trim().toLowerCase());
  let uriIdx = headerCells.indexOf('uri');
  const start = uriIdx >= 0 ? 1 : 0;
  if (uriIdx < 0) {
    // No header — assume first column is uri
    uriIdx = 0;
  }

  const raw: string[] = [];
  let skipped = 0;
  for (let i = start; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const uri = (cells[uriIdx] || '').trim();
    if (uri && isValidSpotifyUri(uri)) raw.push(uri);
    else skipped += 1;
  }

  return {
    nameHint: nameHintFromFilename(filename),
    uris: dedupeUris(raw),
    skipped,
    errors: [],
  };
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
