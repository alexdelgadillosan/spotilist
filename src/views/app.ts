import {
  getAllPlaylists,
  getMe,
  getPlaylistTracks,
  type SpotifyPlaylist,
  type SpotifyUser,
} from '../api/spotify';
import { logout } from '../auth/spotify-auth';

function formatDuration(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
          <div id="playlist-list" class="playlist-list"><p class="muted">Loading playlists…</p></div>
        </aside>
        <section class="main-pane">
          <div id="track-pane" class="track-pane">
            <p class="muted">Select a playlist to view tracks.</p>
          </div>
        </section>
      </div>
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

  const listEl = root.querySelector('#playlist-list')!;
  if (!playlists.length) {
    listEl.innerHTML = `<p class="muted">No playlists found.</p>`;
    return;
  }

  listEl.innerHTML = playlists
    .map((p) => {
      const img = p.images?.[0]?.url;
      const total = p.tracks?.total;
      const countLabel =
        typeof total === 'number' ? `${total} tracks` : '… tracks';
      return `
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
      </button>`;
    })
    .join('');

  // Update counts in the DOM if hydration finished with real totals
  playlists.forEach((p) => {
    const el = listEl.querySelector(`[data-count-for="${p.id}"]`);
    if (el && typeof p.tracks?.total === 'number') {
      el.textContent = `${p.tracks.total} tracks`;
    }
  });

  listEl.querySelectorAll<HTMLButtonElement>('.playlist-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      listEl
        .querySelectorAll('.playlist-item')
        .forEach((el) => el.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.dataset.id!;
      const pl = playlists.find((p) => p.id === id);
      if (!pl) return;
      void loadTracks(root, pl);
    });
  });
}

async function loadTracks(root: HTMLElement, playlist: SpotifyPlaylist) {
  const pane = root.querySelector('#track-pane')!;
  pane.innerHTML = `<h2>${escapeHtml(playlist.name || 'Playlist')}</h2><p class="muted">Loading tracks…</p>`;

  try {
    // API max limit is 50 per docs
    const page = await getPlaylistTracks(playlist.id, 50, 0);
    const items = page.items || [];
    const available = items.filter(
      (i) => i?.track && i.track.is_playable !== false
    );
    const unavailable = items.filter(
      (i) => !i?.track || i.track.is_playable === false
    );

    const rows = items
      .map((i, idx) => {
        const t = i.track;
        if (!t) {
          return `
          <tr class="track-unavailable">
            <td class="num">${idx + 1}</td>
            <td>
              <div class="track-title">Unavailable</div>
              <div class="track-artist">Removed from Spotify catalog or not available in your market</div>
            </td>
            <td class="dur">—</td>
          </tr>`;
        }
        const blocked = t.is_playable === false;
        const artists = (t.artists || []).map((a) => a.name).join(', ');
        const reason = t.restrictions?.reason
          ? ` · ${t.restrictions.reason}`
          : '';
        return `
        <tr class="${blocked ? 'track-unavailable' : ''}">
          <td class="num">${idx + 1}</td>
          <td>
            <div class="track-title">${escapeHtml(t.name || 'Unknown')}${
              blocked ? ' <span class="badge">unavailable</span>' : ''
            }</div>
            <div class="track-artist">${escapeHtml(artists || '—')}${escapeHtml(reason)}</div>
          </td>
          <td class="dur">${formatDuration(t.duration_ms || 0)}</td>
        </tr>`;
      })
      .join('');

    const total = page.total ?? items.length;
    pane.innerHTML = `
      <div class="track-header">
        <h2>${escapeHtml(playlist.name || 'Playlist')}</h2>
        <p class="muted">
          ${total} items${total > 50 ? ' (showing first 50)' : ''}
          · ${available.length} available
          ${unavailable.length ? ` · ${unavailable.length} unavailable` : ''}
        </p>
      </div>
      <table class="track-table">
        <thead><tr><th>#</th><th>Title</th><th>Time</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="muted">No items in this playlist.</td></tr>'}</tbody>
      </table>
    `;

    const countEl = root.querySelector(`[data-count-for="${playlist.id}"]`);
    if (countEl && typeof total === 'number') {
      countEl.textContent = `${total} tracks`;
    }
  } catch (e) {
    pane.innerHTML = `<p class="banner error">${
      e instanceof Error ? e.message : String(e)
    }</p>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
