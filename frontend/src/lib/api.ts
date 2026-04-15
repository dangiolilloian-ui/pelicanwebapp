// All calls go through a relative path. Next.js rewrites (see next.config.ts)
// proxy /api/* to the backend over the Docker network, so the browser never
// needs to know the backend hostname/port. This works for localhost, LAN IPs,
// and reverse proxies like Nginx Proxy Manager without CORS gymnastics.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

type FetchOptions = RequestInit & { token?: string | null };

export async function api<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { token, headers, ...rest } = opts;

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...rest,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
