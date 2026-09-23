import './style.css';
import { getAccessToken, handleAuthCallback, isLoggedIn } from './auth/spotify-auth';
import { renderLanding } from './views/landing';
import { renderApp } from './views/app';

const root = document.querySelector<HTMLDivElement>('#app')!;

async function boot() {
  try {
    const handled = await handleAuthCallback();
    if (handled) {
      await renderApp(root);
      return;
    }
  } catch (e) {
    renderLanding(root, {
      error: e instanceof Error ? e.message : String(e),
    });
    return;
  }

  if (isLoggedIn()) {
    try {
      // Validate / refresh token before showing app
      const token = await getAccessToken();
      if (token) {
        await renderApp(root);
        return;
      }
    } catch (e) {
      renderLanding(root, {
        error: e instanceof Error ? e.message : String(e),
      });
      return;
    }
  }

  renderLanding(root);
}

void boot();
