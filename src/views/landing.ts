import { getClientId, startLogin } from '../auth/spotify-auth';

const features = [
  'Multi-select tracks across playlists',
  'Bulk add, move, or delete',
  'Merge playlists + auto-dedupe',
  'Build new lists from genres & filters',
  'Diff, smart mix, archive & export (next)',
];

export function renderLanding(root: HTMLElement, opts?: { error?: string }) {
  const clientId = getClientId();
  const canConnect = Boolean(clientId);

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
        spin up new playlists from genres — without the manual pain.
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
