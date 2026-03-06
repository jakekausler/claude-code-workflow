import { getAuthHeaders, silentRefresh } from '../hooks/useAuth.js';

const API_BASE = '/api';

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const { headers: customHeaders, body, ...restInit } = init ?? {};
  const defaultHeaders: Record<string, string> = {};
  if (body !== undefined) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  // Attach auth headers when available (hosted mode)
  const authHeaders = getAuthHeaders();

  const doFetch = (extraHeaders: Record<string, string> = {}) =>
    fetch(`${API_BASE}${path}`, {
      ...restInit,
      body,
      headers: { ...defaultHeaders, ...authHeaders, ...extraHeaders, ...customHeaders },
    });

  let response = await doFetch();

  // On 401: attempt a silent token refresh and retry once
  if (response.status === 401) {
    const refreshed = await silentRefresh();
    if (refreshed) {
      response = await doFetch({ Authorization: `Bearer ${refreshed.accessToken}` });
    }
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}
