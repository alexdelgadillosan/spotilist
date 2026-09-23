import {
  addPlaylistItems,
  createPlaylist,
  getAllPlaylistItems,
  getAllPlaylists,
  getMe,
  getPlaylistMeta,
  playlistItemCount,
  removePlaylistItems,
  replacePlaylistItems,
  type SpotifyPlaylist,
  type SpotifyTrackItem,
  type SpotifyUser,
} from '../api/spotify';
import { logout } from '../auth/spotify-auth';
import {
  applyTrackFilter,
  dedupeUris,
  mergePreview,
  parseMinutesToMs,
  urisFromItems,
  type TrackFilter,
} from '../ops/playlist-ops';
import {
  clearSelection,
  deselectMany,
  getSelection,
  getSelectionCount,
  isSelected,
  selectMany,
  subscribeSelection,
  toggleSelect,
  type SelectedTrack,
} from '../state/selection';
import {
  confirmModal,
  escapeHtml,
  mergeModal,
  newPlaylistModal,
  pickPlaylistModal,
  toast,
} from '../ui/modals';

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

type AppCtx = {
  root: HTMLElement;
  playlists: SpotifyPlaylist[];
  activeId: string | null;
  activeItems: SpotifyTrackItem[];
  filter: TrackFilter;
  mergeChecked: Set<string>;
  lastCheckIndex: number;
};

export async function renderApp(root: HTMLElement): Promise<void> {
  root.innerHTML = `
    <div class="app-shell">
      <header class="app-top">
        <div class="brand">
          <span class="logo" aria-hidden="true"></span>
          <span class="name">Spotilist</span>
        </div>
        <div class="app-top-right">
          <span class="user-chip" id="user-chip">Loading…</span>
          <button type="button" class="btn ghost-btn" id="logout">Log out</button>
        </div>
      </header>
      <div class="app-body">
        <aside class="sidebar">
          <h2>Your playlists</h2>
          <input
            type="search"
            id="playlist-search"
            class="field sidebar-search"
            placeholder="Search playlists…"
            autocomplete="off"
          />
          <div class="sidebar-actions">
            <button type="button" class="ghost-btn small" id="merge-btn" disabled>Merge</button>
            <button type="button" class="ghost-btn small" id="dedupe-btn" disabled>Dedupe</button>
          </div>
          <div id="playlist-list" class="playlist-list"><p class="muted">Loading playlists…</p></div>
        </aside>
        <section class="main-pane">
          <div id="track-pane" class="track-pane">
            <p class="muted">Select a playlist to view tracks.</p>
          </div>
        </section>
      </div>
      <div id="bulk-bar" class="bulk-bar" hidden></div>
    </div>
  `;

  root.querySelector('#logout')?.addEventListener('click', () => {
    logout();
    window.location.assign(import.meta.env.BASE_URL || '/');
  });

  let user: SpotifyUser;
  let playlists: SpotifyPlaylist[];
  try {
    [user, playlists] = await Promise.all([getMe(), getAllPlaylists()]);
  } catch (e) {
    root.querySelector('#playlist-list')!.innerHTML = `<p class="banner error">${
      e instanceof Error ? e.message : String(e)
    }</p>`;
    return;
  }

  const chip = root.querySelector('#user-chip')!;
  chip.textContent = user.display_name || user.id;

  const ctx: AppCtx = {
    root,
    playlists,
    activeId: null,
    activeItems: [],
    filter: { query: '', hideUnavailable: false },
    mergeChecked: new Set(),
    lastCheckIndex: -1,
  };

  renderPlaylistList(ctx);
  wireSidebar(ctx);
  subscribeSelection(() => renderBulkBar(ctx));
  renderBulkBar(ctx);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clearSelection();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      const pane = root.querySelector('#track-pane');
      if (!pane || !ctx.activeId) return;
      e.preventDefault();
      const filtered = applyTrackFilter(ctx.activeItems, ctx.filter);
      const pl = ctx.playlists.find((p) => p.id === ctx.activeId);
      selectMany(
        filtered
          .filter((i) => i.item?.uri && i.item.is_playable !== false)
          .map((i) => toSelected(i, pl!))
      );
    }
  });
}

function toSelected(row: SpotifyTrackItem, pl: SpotifyPlaylist): SelectedTrack {
  const t = row.item!;
  return {
    uri: t.uri,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name).join(', '),
    sourcePlaylistId: pl.id,
    sourcePlaylistName: pl.name,
  };
}

function wireSidebar(ctx: AppCtx): void {
  const search = ctx.root.querySelector('#playlist-search') as HTMLInputElement;
  search.addEventListener('input', () => renderPlaylistList(ctx));

  ctx.root.querySelector('#merge-btn')?.addEventListener('click', () => void runMerge(ctx));
  ctx.root.querySelector('#dedupe-btn')?.addEventListener('click', () => void runDedupe(ctx));
}

function renderPlaylistList(ctx: AppCtx): void {
  const listEl = ctx.root.querySelector('#playlist-list')!;
  const q = (
    (ctx.root.querySelector('#playlist-search') as HTMLInputElement)?.value || ''
  )
    .trim()
    .toLowerCase();

  const filtered = ctx.playlists.filter((p) =>
    q ? (p.name || '').toLowerCase().includes(q) : true
  );

  if (!filtered.length) {
    listEl.innerHTML = `<p class="muted">${q ? 'No playlists match.' : 'No playlists found.'}</p>`;
    updateSidebarActions(ctx);
    return;
  }

  listEl.innerHTML = filtered
    .map((p) => {
      const img = p.images?.[0]?.url;
      const total = playlistItemCount(p);
      const countLabel = typeof total === 'number' ? `${total} tracks` : '… tracks';
      const active = p.id === ctx.activeId ? 'active' : '';
      const checked = ctx.mergeChecked.has(p.id) ? 'checked' : '';
      return `
      <div class="playlist-row ${active}" data-id="${p.id}">
        <label class="merge-check" title="Select for merge">
          <input type="checkbox" data-merge="${p.id}" ${checked} />
        </label>
        <button type="button" class="playlist-item" data-id="${p.id}">
          ${
            img
              ? `<img src="${img}" alt="" class="playlist-art" />`
              : `<span class="playlist-art placeholder"></span>`
          }
          <span class="playlist-meta">
            <span class="playlist-name">${escapeHtml(p.name || 'Untitled')}</span>
            <span class="playlist-count" data-count-for="${p.id}">${countLabel}</span>
          </span>
        </button>
      </div>`;
    })
    .join('');

  listEl.querySelectorAll<HTMLInputElement>('input[data-merge]').forEach((cb) => {
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      const id = cb.dataset.merge!;
      if (cb.checked) ctx.mergeChecked.add(id);
      else ctx.mergeChecked.delete(id);
      updateSidebarActions(ctx);
    });
  });

  listEl.querySelectorAll<HTMLButtonElement>('.playlist-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id!;
      const pl = ctx.playlists.find((p) => p.id === id);
      if (!pl) return;
      ctx.activeId = id;
      renderPlaylistList(ctx);
      void loadTracks(ctx, pl);
    });
  });

  updateSidebarActions(ctx);
}

function updateSidebarActions(ctx: AppCtx): void {
  const mergeBtn = ctx.root.querySelector('#merge-btn') as HTMLButtonElement;
  const dedupeBtn = ctx.root.querySelector('#dedupe-btn') as HTMLButtonElement;
  mergeBtn.disabled = ctx.mergeChecked.size < 2;
  dedupeBtn.disabled = !ctx.activeId;
}

async function loadTracks(ctx: AppCtx, playlist: SpotifyPlaylist): Promise<void> {
  const pane = ctx.root.querySelector('#track-pane')!;
  pane.innerHTML = `<h2>${escapeHtml(playlist.name || 'Playlist')}</h2><p class="muted" id="load-status">Loading tracks…</p>`;
  updateSidebarActions(ctx);

  try {
    const { items, total } = await getAllPlaylistItems(playlist.id, (loaded, t) => {
      const status = pane.querySelector('#load-status');
      if (status) status.textContent = `Loading ${loaded}/${t}…`;
    });
    ctx.activeItems = items;
    ctx.filter = { query: '', hideUnavailable: false };
    ctx.lastCheckIndex = -1;

    const countEl = ctx.root.querySelector(`[data-count-for="${playlist.id}"]`);
    if (countEl) countEl.textContent = `${total} tracks`;
    const pl = ctx.playlists.find((p) => p.id === playlist.id);
    if (pl) pl.items = { ...(pl.items || {}), total };

    renderTrackPane(ctx);
  } catch (e) {
    pane.innerHTML = `<p class="banner error">${
      e instanceof Error ? e.message : String(e)
    }</p>`;
  }
}

function renderTrackPane(ctx: AppCtx): void {
  const pl = ctx.playlists.find((p) => p.id === ctx.activeId);
  if (!pl) return;
  const pane = ctx.root.querySelector('#track-pane')!;
  const filtered = applyTrackFilter(ctx.activeItems, ctx.filter);
  const available = ctx.activeItems.filter(
    (i) => i?.item && i.item.is_playable !== false
  );
  const unavailable = ctx.activeItems.filter(
    (i) => !i?.item || i.item.is_playable === false
  );

  const f = ctx.filter;
  pane.innerHTML = `
    <div class="track-header">
      <h2>${escapeHtml(pl.name || 'Playlist')}</h2>
      <p class="muted">
        ${ctx.activeItems.length} items
        · ${available.length} available
        ${unavailable.length ? ` · ${unavailable.length} unavailable` : ''}
        ${filtered.length !== ctx.activeItems.length ? ` · showing ${filtered.length}` : ''}
      </p>
    </div>
    <div class="filter-row">
      <input type="search" class="field" id="track-filter" placeholder="Filter title, artist, album…" value="${escapeHtml(f.query)}" />
      <input type="number" class="field narrow" id="min-dur" placeholder="Min min" min="0" step="0.5" value="${f.minDurationMs != null ? f.minDurationMs / 60000 : ''}" />
      <input type="number" class="field narrow" id="max-dur" placeholder="Max min" min="0" step="0.5" value="${f.maxDurationMs != null ? f.maxDurationMs / 60000 : ''}" />
      <input type="date" class="field" id="added-after" value="${f.addedAfter || ''}" title="Added after" />
      <label class="check-row inline"><input type="checkbox" id="explicit-only" ${f.explicitOnly ? 'checked' : ''}/> Explicit</label>
      <label class="check-row inline"><input type="checkbox" id="hide-unavail" ${f.hideUnavailable ? 'checked' : ''}/> Hide unavailable</label>
      <button type="button" class="ghost-btn small" id="new-from-filter" ${filtered.some((i) => i.item?.uri) ? '' : 'disabled'}>New from filter</button>
    </div>
    <table class="track-table">
      <thead>
        <tr>
          <th class="check-col"><input type="checkbox" id="select-all" title="Select all filtered" /></th>
          <th>#</th>
          <th>Title</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        ${
          filtered.length
            ? filtered
                .map((row, idx) => renderRow(row, idx, pl))
                .join('')
            : '<tr><td colspan="4" class="muted">No matching tracks.</td></tr>'
        }
      </tbody>
    </table>
  `;

  const applyFiltersFromDom = () => {
    ctx.filter = {
      query: (pane.querySelector('#track-filter') as HTMLInputElement).value,
      minDurationMs: parseMinutesToMs((pane.querySelector('#min-dur') as HTMLInputElement).value),
      maxDurationMs: parseMinutesToMs((pane.querySelector('#max-dur') as HTMLInputElement).value),
      addedAfter: (pane.querySelector('#added-after') as HTMLInputElement).value || undefined,
      explicitOnly: (pane.querySelector('#explicit-only') as HTMLInputElement).checked,
      hideUnavailable: (pane.querySelector('#hide-unavail') as HTMLInputElement).checked,
    };
    renderTrackPane(ctx);
  };

  pane.querySelector('#track-filter')?.addEventListener('input', () => {
    ctx.filter.query = (pane.querySelector('#track-filter') as HTMLInputElement).value;
    // debounce-ish: re-render on input for search feel
    const tbody = pane.querySelector('tbody');
    if (!tbody) return;
    const next = applyTrackFilter(ctx.activeItems, ctx.filter);
    tbody.innerHTML = next.length
      ? next.map((row, idx) => renderRow(row, idx, pl)).join('')
      : '<tr><td colspan="4" class="muted">No matching tracks.</td></tr>';
    wireRowChecks(ctx, pane, pl, next);
    updateSelectAllState(pane, next);
    const btn = pane.querySelector('#new-from-filter') as HTMLButtonElement;
    btn.disabled = !next.some((i) => i.item?.uri);
  });
  ['#min-dur', '#max-dur', '#added-after', '#explicit-only', '#hide-unavail'].forEach((sel) => {
    pane.querySelector(sel)?.addEventListener('change', applyFiltersFromDom);
  });

  pane.querySelector('#new-from-filter')?.addEventListener('click', () => {
    void createFromFilter(ctx);
  });

  pane.querySelector('#select-all')?.addEventListener('change', (e) => {
    const on = (e.target as HTMLInputElement).checked;
    const rows = applyTrackFilter(ctx.activeItems, ctx.filter);
    const selectable = rows.filter((i) => i.item?.uri && i.item.is_playable !== false);
    if (on) selectMany(selectable.map((i) => toSelected(i, pl)));
    else deselectMany(selectable.map((i) => i.item!.uri));
    renderTrackPane(ctx);
  });

  wireRowChecks(ctx, pane, pl, filtered);
  updateSelectAllState(pane, filtered);
}

function renderRow(row: SpotifyTrackItem, idx: number, pl: SpotifyPlaylist): string {
  const t = row.item;
  if (!t) {
    return `
      <tr class="track-unavailable">
        <td class="check-col"></td>
        <td class="num">${idx + 1}</td>
        <td>
          <div class="track-title">Unavailable</div>
          <div class="track-artist">Removed from Spotify catalog</div>
        </td>
        <td class="dur">—</td>
      </tr>`;
  }
  const blocked = t.is_playable === false;
  const artists = (t.artists || []).map((a) => a.name).join(', ');
  const canSelect = !blocked && !!t.uri;
  const checked = canSelect && isSelected(t.uri) ? 'checked' : '';
  return `
    <tr class="${blocked ? 'track-unavailable' : ''}" data-uri="${escapeHtml(t.uri || '')}" data-idx="${idx}">
      <td class="check-col">
        ${
          canSelect
            ? `<input type="checkbox" class="row-check" data-uri="${escapeHtml(t.uri)}" ${checked} />`
            : ''
        }
      </td>
      <td class="num">${idx + 1}</td>
      <td>
        <div class="track-title">${escapeHtml(t.name || 'Unknown')}${
          blocked ? ' <span class="badge">unavailable</span>' : ''
        }</div>
        <div class="track-artist">${escapeHtml(artists || '—')}</div>
      </td>
      <td class="dur">${formatDuration(t.duration_ms || 0)}</td>
    </tr>`;
}

function wireRowChecks(
  ctx: AppCtx,
  pane: Element,
  pl: SpotifyPlaylist,
  filtered: SpotifyTrackItem[]
): void {
  pane.querySelectorAll<HTMLInputElement>('.row-check').forEach((cb) => {
    cb.addEventListener('click', (e) => {
      const uri = cb.dataset.uri!;
      const idx = Number((cb.closest('tr') as HTMLElement)?.dataset.idx ?? -1);
      const row = filtered.find((r) => r.item?.uri === uri);
      if (!row?.item) return;

      if (e.shiftKey && ctx.lastCheckIndex >= 0 && idx >= 0) {
        const [a, b] = [ctx.lastCheckIndex, idx].sort((x, y) => x - y);
        const range = filtered.slice(a, b + 1).filter((r) => r.item?.uri && r.item.is_playable !== false);
        selectMany(range.map((r) => toSelected(r, pl)));
        renderTrackPane(ctx);
        return;
      }

      toggleSelect(toSelected(row, pl));
      ctx.lastCheckIndex = idx;
      // sync checkbox without full re-render for snappiness
      cb.checked = isSelected(uri);
      updateSelectAllState(pane, filtered);
      renderBulkBar(ctx);
    });
  });
}

function updateSelectAllState(pane: Element, filtered: SpotifyTrackItem[]): void {
  const selectable = filtered.filter((i) => i.item?.uri && i.item.is_playable !== false);
  const allOn =
    selectable.length > 0 && selectable.every((i) => isSelected(i.item!.uri));
  const el = pane.querySelector('#select-all') as HTMLInputElement | null;
  if (el) el.checked = allOn;
}

function renderBulkBar(ctx: AppCtx): void {
  const bar = ctx.root.querySelector('#bulk-bar') as HTMLElement;
  const n = getSelectionCount();
  if (!n) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;
  bar.innerHTML = `
    <span class="bulk-count">${n} selected</span>
    <button type="button" class="btn primary small" data-bulk="add">Add to…</button>
    <button type="button" class="ghost-btn small" data-bulk="move">Move to…</button>
    <button type="button" class="ghost-btn small" data-bulk="new">New playlist</button>
    <button type="button" class="ghost-btn small danger-text" data-bulk="delete">Delete</button>
    <button type="button" class="ghost-btn small" data-bulk="clear">Clear</button>
  `;
  bar.querySelector('[data-bulk="clear"]')?.addEventListener('click', () => {
    clearSelection();
    if (ctx.activeId) renderTrackPane(ctx);
  });
  bar.querySelector('[data-bulk="add"]')?.addEventListener('click', () => void bulkAdd(ctx, false));
  bar.querySelector('[data-bulk="move"]')?.addEventListener('click', () => void bulkAdd(ctx, true));
  bar.querySelector('[data-bulk="new"]')?.addEventListener('click', () => void bulkNewPlaylist(ctx));
  bar.querySelector('[data-bulk="delete"]')?.addEventListener('click', () => void bulkDelete(ctx));
}

async function bulkAdd(ctx: AppCtx, move: boolean): Promise<void> {
  const sel = getSelection();
  if (!sel.length) return;
  const destId = await pickPlaylistModal({
    title: move ? 'Move to playlist' : 'Add to playlist',
    playlists: ctx.playlists.map((p) => ({ id: p.id, name: p.name })),
    excludeIds: move ? [] : undefined,
  });
  if (!destId) return;

  const dest = ctx.playlists.find((p) => p.id === destId);
  const ok = await confirmModal({
    title: move ? 'Move tracks?' : 'Add tracks?',
    body: `${move ? 'Move' : 'Add'} <strong>${sel.length}</strong> track${sel.length === 1 ? '' : 's'} to <strong>${escapeHtml(dest?.name || 'playlist')}</strong>?`,
    confirmLabel: move ? 'Move' : 'Add',
  });
  if (!ok) return;

  try {
    const uris = sel.map((s) => s.uri);
    await addPlaylistItems(destId, uris);
    if (move) {
      const bySource = new Map<string, string[]>();
      for (const s of sel) {
        const list = bySource.get(s.sourcePlaylistId) || [];
        list.push(s.uri);
        bySource.set(s.sourcePlaylistId, list);
      }
      for (const [sourceId, sourceUris] of bySource) {
        if (sourceId === destId) continue;
        await removePlaylistItems(sourceId, sourceUris);
      }
    }
    clearSelection();
    toast(move ? `Moved ${uris.length} tracks` : `Added ${uris.length} tracks`);
    if (ctx.activeId) {
      const pl = ctx.playlists.find((p) => p.id === ctx.activeId)!;
      await loadTracks(ctx, pl);
    }
    await refreshPlaylistMeta(ctx, [destId, ...sel.map((s) => s.sourcePlaylistId)]);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

async function bulkDelete(ctx: AppCtx): Promise<void> {
  const sel = getSelection();
  if (!sel.length) return;
  const ok = await confirmModal({
    title: 'Delete tracks?',
    body: `Remove <strong>${sel.length}</strong> track${sel.length === 1 ? '' : 's'} from their playlists? This cannot be undone from Spotilist.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;

  try {
    const bySource = new Map<string, string[]>();
    for (const s of sel) {
      const list = bySource.get(s.sourcePlaylistId) || [];
      list.push(s.uri);
      bySource.set(s.sourcePlaylistId, list);
    }
    for (const [sourceId, uris] of bySource) {
      await removePlaylistItems(sourceId, uris);
    }
    clearSelection();
    toast(`Removed ${sel.length} tracks`);
    if (ctx.activeId) {
      const pl = ctx.playlists.find((p) => p.id === ctx.activeId)!;
      await loadTracks(ctx, pl);
    }
    await refreshPlaylistMeta(ctx, [...bySource.keys()]);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

async function bulkNewPlaylist(ctx: AppCtx): Promise<void> {
  const sel = getSelection();
  if (!sel.length) return;
  const result = await newPlaylistModal({
    title: 'New playlist from selection',
    defaultName: 'Spotilist mix',
    count: sel.length,
  });
  if (!result) return;
  try {
    const created = await createPlaylist({
      name: result.name,
      public: result.isPublic,
    });
    await addPlaylistItems(created.id, sel.map((s) => s.uri));
    clearSelection();
    toast(`Created “${result.name}”`);
    ctx.playlists = await getAllPlaylists();
    renderPlaylistList(ctx);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

async function createFromFilter(ctx: AppCtx): Promise<void> {
  const filtered = applyTrackFilter(ctx.activeItems, ctx.filter);
  const uris = urisFromItems(filtered);
  if (!uris.length) return;
  const result = await newPlaylistModal({
    title: 'New playlist from filter',
    defaultName: 'Filtered playlist',
    count: uris.length,
  });
  if (!result) return;
  try {
    const created = await createPlaylist({
      name: result.name,
      public: result.isPublic,
    });
    await addPlaylistItems(created.id, uris);
    toast(`Created “${result.name}” with ${uris.length} tracks`);
    ctx.playlists = await getAllPlaylists();
    renderPlaylistList(ctx);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

async function runMerge(ctx: AppCtx): Promise<void> {
  const ids = [...ctx.mergeChecked];
  if (ids.length < 2) return;
  const sources = ids
    .map((id) => ctx.playlists.find((p) => p.id === id))
    .filter((p): p is SpotifyPlaylist => !!p);

  try {
    toast('Loading playlists to merge…');
    const lists: string[][] = [];
    for (const pl of sources) {
      const { items } = await getAllPlaylistItems(pl.id);
      lists.push(urisFromItems(items));
    }
    const preview = mergePreview(lists);
    const choice = await mergeModal({
      sourceNames: sources.map((s) => s.name),
      totalRaw: preview.totalRaw,
      uniqueCount: preview.unique.length,
      duplicateCount: preview.duplicateCount,
      playlists: ctx.playlists.map((p) => ({ id: p.id, name: p.name })),
    });
    if (!choice) return;

    let destId: string;
    if (choice.mode === 'new') {
      const created = await createPlaylist({
        name: choice.name!,
        public: choice.isPublic ?? false,
        description: `Merged from ${sources.map((s) => s.name).join(', ')}`,
      });
      destId = created.id;
      await addPlaylistItems(destId, preview.unique);
    } else {
      destId = choice.playlistId!;
      // add unique that aren't already there
      const existing = await getAllPlaylistItems(destId);
      const have = new Set(urisFromItems(existing.items));
      const toAdd = preview.unique.filter((u) => !have.has(u));
      await addPlaylistItems(destId, toAdd);
    }

    ctx.mergeChecked.clear();
    toast(`Merged ${preview.unique.length} unique tracks`);
    ctx.playlists = await getAllPlaylists();
    renderPlaylistList(ctx);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

async function runDedupe(ctx: AppCtx): Promise<void> {
  if (!ctx.activeId) return;
  const pl = ctx.playlists.find((p) => p.id === ctx.activeId)!;
  const uris = urisFromItems(ctx.activeItems);
  const { unique, duplicateCount } = dedupeUris(uris);
  if (!duplicateCount) {
    toast('No duplicates found');
    return;
  }
  const ok = await confirmModal({
    title: 'Dedupe playlist?',
    body: `Remove <strong>${duplicateCount}</strong> duplicate${duplicateCount === 1 ? '' : 's'} from <strong>${escapeHtml(pl.name)}</strong>? Keeps first occurrence of each track (${unique.length} remain).`,
    confirmLabel: 'Dedupe',
  });
  if (!ok) return;
  try {
    await replacePlaylistItems(pl.id, unique);
    toast(`Removed ${duplicateCount} duplicates`);
    await loadTracks(ctx, pl);
    await refreshPlaylistMeta(ctx, [pl.id]);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  }
}

async function refreshPlaylistMeta(ctx: AppCtx, ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  for (const id of uniqueIds) {
    const pl = ctx.playlists.find((p) => p.id === id);
    if (!pl) continue;
    try {
      const meta = await getPlaylistMeta(id);
      const total = meta.items?.total ?? 0;
      pl.items = { ...(pl.items || {}), total };
      const el = ctx.root.querySelector(`[data-count-for="${id}"]`);
      if (el) el.textContent = `${total} tracks`;
    } catch {
      /* ignore */
    }
  }
}
