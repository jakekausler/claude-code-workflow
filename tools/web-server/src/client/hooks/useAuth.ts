import { useCallback } from 'react';

const TOKEN_KEY = 'auth_access_token';
const REFRESH_KEY = 'auth_refresh_token';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Read the current access token from localStorage.
 */
export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Read the current refresh token from localStorage.
 */
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

/**
 * Persist tokens in localStorage.
 */
export function setTokens(tokens: AuthTokens): void {
  localStorage.setItem(TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
}

/**
 * Clear all auth tokens from localStorage.
 */
export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

/**
 * Build Authorization headers for API requests.
 */
export function getAuthHeaders(): Record<string, string> {
  const token = getAccessToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/**
 * Attempt a silent token refresh.
 * Returns the new tokens on success, or null if refresh fails.
 */
export async function silentRefresh(): Promise<AuthTokens | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  try {
    const response = await fetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      clearTokens();
      return null;
    }

    const data = (await response.json()) as AuthTokens;
    setTokens(data);
    return data;
  } catch {
    clearTokens();
    return null;
  }
}

/**
 * Call POST /auth/logout and clear local tokens.
 */
export async function logoutRequest(): Promise<void> {
  const refreshToken = getRefreshToken();
  if (refreshToken) {
    try {
      await fetch('/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
    } catch {
      // Best-effort logout; clear tokens regardless
    }
  }
  clearTokens();
}

/**
 * React hook providing auth helpers.
 */
export function useAuth() {
  const login = useCallback(() => {
    window.location.href = '/auth/github';
  }, []);

  const logout = useCallback(async () => {
    await logoutRequest();
    window.location.href = '/';
  }, []);

  const isAuthenticated = getAccessToken() !== null;

  return {
    isAuthenticated,
    login,
    logout,
    getAuthHeaders,
    silentRefresh,
  };
}
