const API_BASE = '/api';

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const { headers: customHeaders, ...restInit } = init ?? {};
  const response = await fetch(`${API_BASE}${path}`, {
    ...restInit,
    headers: { 'Content-Type': 'application/json', ...customHeaders },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}
