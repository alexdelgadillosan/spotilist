export type SelectedTrack = {
  uri: string;
  name: string;
  artists: string;
  sourcePlaylistId: string;
  sourcePlaylistName: string;
};

type Listener = () => void;

const selected = new Map<string, SelectedTrack>();
const listeners = new Set<Listener>();

function notify(): void {
  listeners.forEach((fn) => fn());
}

export function subscribeSelection(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSelection(): SelectedTrack[] {
  return [...selected.values()];
}

export function getSelectionCount(): number {
  return selected.size;
}

export function isSelected(uri: string): boolean {
  return selected.has(uri);
}

export function toggleSelect(track: SelectedTrack): void {
  if (selected.has(track.uri)) {
    selected.delete(track.uri);
  } else {
    selected.set(track.uri, track);
  }
  notify();
}

export function selectMany(tracks: SelectedTrack[]): void {
  for (const t of tracks) {
    if (t.uri) selected.set(t.uri, t);
  }
  notify();
}

export function deselectMany(uris: string[]): void {
  for (const uri of uris) selected.delete(uri);
  notify();
}

export function clearSelection(): void {
  selected.clear();
  notify();
}
