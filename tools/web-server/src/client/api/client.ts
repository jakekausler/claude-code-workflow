const API_BASE = '/api';

/** Matches full ISO-8601 datetime strings (with optional fractional seconds and Z). */
export const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z?$/;

/**
 * JSON reviver that converts ISO-8601 datetime strings to Date objects.
 * Mirrors the devtools `HttpAPIClient.parseJson` strategy so every API
 * response automatically gets real Date instances instead of raw strings.
 */
export function reviveDates(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && ISO_DATE_RE.test(value)) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
  }
  return value;
}

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

  const text = await response.text();
  return JSON.parse(text, reviveDates) as T;
}
