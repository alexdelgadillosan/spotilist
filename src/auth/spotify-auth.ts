import { consumePkce, createPkcePair } from './pkce';
import {
  clearTokens,
  isExpired,
  readTokens,
  saveTokens,
  type TokenBundle,
} from './session';

const SCOPES = [
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-library-read',
  'user-read-email',
].join(' ');

export function getClientId(): string {
  return (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined)?.trim() || '';
}

/** Redirect URI must match Spotify Dashboard exactly (trailing slash matters). */
export function getRedirectUri(): string {
  const base = import.meta.env.BASE_URL || '/';
  const path = `${base.replace(/\/?$/, '/')}`;
  return `${window.location.origin}${path}`;
}

export async function startLogin(): Promise<void> {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error(
      'Missing VITE_SPOTIFY_CLIENT_ID. Add it to .env / GitHub Actions secrets.'
    );
  }

  const { challenge, state } = await createPkcePair();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    scope: SCOPES,
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });

  window.location.assign(
    `https://accounts.spotify.com/authorize?${params.toString()}`
  );
}

export async function handleAuthCallback(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    throw new Error(`Spotify auth error: ${error}`);
  }
  if (!code || !state) {
    return false;
  }

  const pkce = consumePkce();
  if (!pkce || pkce.state !== state) {
    throw new Error('Invalid PKCE state. Try Connect Spotify again.');
  }

  const clientId = getClientId();
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: pkce.verifier,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope?: string;
  };

  const existing = readTokens();
  saveTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token || existing?.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
    scope: data.scope,
  });

  // Clean query params from URL
  window.history.replaceState({}, '', getRedirectUri());
  return true;
}

async function refreshAccessToken(bundle: TokenBundle): Promise<TokenBundle> {
  if (!bundle.refresh_token) {
    clearTokens();
    throw new Error('Session expired. Connect Spotify again.');
  }

  const body = new URLSearchParams({
    client_id: getClientId(),
    grant_type: 'refresh_token',
    refresh_token: bundle.refresh_token,
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    clearTokens();
    throw new Error('Could not refresh Spotify token. Connect again.');
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope?: string;
  };

  const next: TokenBundle = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || bundle.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
    token_type: data.token_type,
    scope: data.scope || bundle.scope,
  };
  saveTokens(next);
  return next;
}

export async function getAccessToken(): Promise<string | null> {
  let bundle = readTokens();
  if (!bundle) return null;
  if (isExpired(bundle)) {
    bundle = await refreshAccessToken(bundle);
  }
  return bundle.access_token;
}

export function logout(): void {
  clearTokens();
}

export function isLoggedIn(): boolean {
  return !!readTokens();
}
