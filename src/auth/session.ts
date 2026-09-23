export type TokenBundle = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  token_type: string;
  scope?: string;
};

const STORAGE_KEY = 'spotilist_tokens';

export function saveTokens(bundle: TokenBundle): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
}

export function clearTokens(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function readTokens(): TokenBundle | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenBundle;
  } catch {
    return null;
  }
}

export function isExpired(bundle: TokenBundle, skewMs = 60_000): boolean {
  return Date.now() >= bundle.expires_at - skewMs;
}
