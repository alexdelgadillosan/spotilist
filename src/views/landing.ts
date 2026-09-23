import { getClientId, startLogin } from '../auth/spotify-auth';

const features = [
  'Browse Liked Songs and all your playlists',
  'Multi-select tracks — copy, move, or delete in bulk',
  'Merge playlists with auto-dedupe',
  'Filter by artist, album, duration, date, or explicit',
  'Create new playlists from a selection or filter',
  'Import & export one or many playlists as JSON or CSV',
];

const tourPins = [
  {
    id: '1',
    left: '4%',
    top: '16%',
    side: 'right',
    label: 'Search playlists',
  },
  {
    id: '2',
    left: '3%',
    top: '24%',
    side: 'right',
    label: 'Merge · Dedupe · Export · Import · Delete',
  },
  {
    id: '3',
    left: '2%',
    top: '42%',
    side: 'right',
    label: 'Check playlists for bulk actions',
  },
  {
    id: '4',
    left: '48%',
    top: '10%',
    side: 'left',
    label: 'Rename · Delete playlist',
  },
  {
    id: '5',
    left: '55%',
    top: '22%',
    side: 'left',
    label: 'Filter tracks · New from filter',
  },
  {
    id: '6',
    left: '34%',
    top: '38%',
    side: 'right',
    label: 'Select tracks → Copy / Move / Delete',
  },
];

const tourLegend = [
  {
    n: '1',
    title: 'Search',
    text: 'Filter your playlist list by name.',
  },
  {
    n: '2',
    title: 'Sidebar buttons',
    text: 'Merge checked lists, Dedupe the open one, Export/Import JSON·CSV, Delete checked playlists.',
  },
  {
    n: '3',
    title: 'Playlist checkboxes',
    text: 'Pick one or more playlists for Merge, Export, or Delete.',
  },
  {
    n: '4',
    title: 'Pencil & trash',
    text: 'Rename (blue) or remove the open playlist from your library (red).',
  },
  {
    n: '5',
    title: 'Filters',
    text: 'Narrow by title/artist/album, duration, date, explicit — then New from filter.',
  },
  {
    n: '6',
    title: 'Track checkboxes',
    text: 'Multi-select songs for Copy to, Move to, New playlist, or Delete.',
  },
];

export function renderLanding(root: HTMLElement, opts?: { error?: string }) {
  const clientId = getClientId();
  const canConnect = Boolean(clientId);
  const tourImg = `${import.meta.env.BASE_URL}app-tour.jpg`;

  root.innerHTML = `
  <div class="page">
    <header class="top">
      <div class="brand">
        <span class="logo" aria-hidden="true"></span>
        <span class="name">Spotilist</span>
      </div>
      <a class="ghost" href="https://github.com/alexdelgadillosan/spotilist" target="_blank" rel="noopener">GitHub</a>
    </header>

    <main class="hero">
      <p class="eyebrow">Spotify playlist organizer</p>
      <h1>Bulk-edit playlists the way Spotify should have.</h1>
      <p class="lede">
        Connect your account, multi-select tracks, merge lists, dedupe, and
        spin up new playlists from filters — without the manual pain.
      </p>
      ${
        opts?.error
          ? `<p class="banner error" role="alert">${escapeHtml(opts.error)}</p>`
          : ''
      }
      ${
        !canConnect
          ? `<p class="banner warn">Missing <code>VITE_SPOTIFY_CLIENT_ID</code>. Add your Spotify app Client ID to <code>.env</code> (local) or GitHub Actions secrets.</p>`
          : ''
      }
      <div class="actions">
        <button type="button" class="btn primary" id="connect" ${canConnect ? '' : 'disabled'}>
          Connect Spotify
        </button>
        <span class="soon">${canConnect ? 'Uses secure PKCE — no password stored here' : 'Configure Client ID to enable login'}</span>
      </div>
    </main>

    <section class="panel">
      <h2>What you can do</h2>

      <figure class="tour-guide">
        <div class="tour-stage">
          <img src="${tourImg}" alt="Spotilist app: playlists sidebar and track list" width="1024" height="519" loading="lazy" />
          ${tourPins
            .map(
              (p) => `
            <div class="tour-pin side-${p.side}" style="left:${p.left};top:${p.top}">
              <span class="tour-dot" aria-hidden="true">${p.id}</span>
              <span class="tour-arrow" aria-hidden="true"></span>
              <span class="tour-chip">${escapeHtml(p.label)}</span>
            </div>`
            )
            .join('')}
        </div>
        <figcaption class="tour-legend">
          <ol>
            ${tourLegend
              .map(
                (item) => `
              <li>
                <span class="tour-n">${item.n}</span>
                <span><strong>${escapeHtml(item.title)}</strong> — ${escapeHtml(item.text)}</span>
              </li>`
              )
              .join('')}
          </ol>
        </figcaption>
      </figure>

      <ul class="features">
        ${features.map((f) => `<li>${f}</li>`).join('')}
      </ul>
    </section>

    <footer class="foot">
      <span>Dark UI · Spotify green · OAuth PKCE</span>
    </footer>
  </div>
  `;

  root.querySelector('#connect')?.addEventListener('click', async () => {
    const btn = root.querySelector('#connect') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Redirecting…';
    try {
      await startLogin();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Connect Spotify';
      alert(e instanceof Error ? e.message : String(e));
    }
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
