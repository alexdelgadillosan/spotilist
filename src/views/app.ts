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
      return `
      <button type="button" class="playlist-item" data-id="${p.id}">
        ${
          img
            ? `<img src="${img}" alt="" class="playlist-art" />`
            : `<span class="playlist-art placeholder"></span>`
        }
        <span class="playlist-meta">
          <span class="playlist-name">${escapeHtml(p.name)}</span>
          <span class="playlist-count">${p.tracks.total} tracks</span>
        </span>
      </button>`;
    })
    .join('');

  listEl.querySelectorAll<HTMLButtonElement>('.playlist-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      listEl
        .querySelectorAll('.playlist-item')
        .forEach((el) => el.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.dataset.id!;
      const pl = playlists.find((p) => p.id === id)!;
      void loadTracks(root, pl);
    });
  });
}

async function loadTracks(root: HTMLElement, playlist: SpotifyPlaylist) {
  const pane = root.querySelector('#track-pane')!;
  pane.innerHTML = `<h2>${escapeHtml(playlist.name)}</h2><p class="muted">Loading tracks…</p>`;

  try {
    const page = await getPlaylistTracks(playlist.id, 100, 0);
    const rows = page.items
      .filter((i) => i.track)
      .map((i, idx) => {
        const t = i.track!;
        const artists = t.artists.map((a) => a.name).join(', ');
        return `
        <tr>
          <td class="num">${idx + 1}</td>
          <td>
            <div class="track-title">${escapeHtml(t.name)}</div>
            <div class="track-artist">${escapeHtml(artists)}</div>
          </td>
          <td class="dur">${formatDuration(t.duration_ms)}</td>
        </tr>`;
      })
      .join('');

    pane.innerHTML = `
      <div class="track-header">
        <h2>${escapeHtml(playlist.name)}</h2>
        <p class="muted">${page.total} tracks${page.total > 100 ? ' (showing first 100)' : ''}</p>
      </div>
      <table class="track-table">
        <thead><tr><th>#</th><th>Title</th><th>Time</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="muted">No tracks</td></tr>'}</tbody>
      </table>
    `;
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
