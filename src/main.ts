import './style.css';

const features = [
  'Multi-select tracks across playlists',
  'Bulk add, move, or delete',
  'Merge playlists + auto-dedupe',
  'Build new lists from genres & filters',
  'Diff, smart mix, archive & export (next)',
];

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
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
      <div class="actions">
        <button type="button" class="btn primary" id="connect" disabled title="OAuth coming next">
          Connect Spotify
        </button>
        <span class="soon">OAuth &amp; live ops shipping next</span>
      </div>
    </main>

    <section class="panel">
      <h2>What you can do</h2>
      <ul class="features">
        ${features.map((f) => `<li>${f}</li>`).join('')}
      </ul>
    </section>

    <footer class="foot">
      <span>Dark UI · Spotify green · Built for power users</span>
    </footer>
  </div>
`;
