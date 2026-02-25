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

  const response = await fetch(`${API_BASE}${path}`, {
    ...restInit,
    body,
    headers: { ...defaultHeaders, ...customHeaders },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}
