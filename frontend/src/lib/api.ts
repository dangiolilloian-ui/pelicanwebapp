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
    // Preserve the backend's error code + HTTP status on the thrown Error so
    // call sites can branch on them (e.g. showing a special "account
    // deactivated" screen instead of a generic "invalid credentials" toast).
    const err = new Error(body.error || `Request failed: ${res.status}`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = body.code;
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
