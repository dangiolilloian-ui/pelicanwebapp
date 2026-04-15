// Browser-side helpers for the web-push subscription flow.
//
// Surface is intentionally small: `getPushStatus`, `subscribePush`,
// `unsubscribePush`, `sendTestPush`.  The service worker itself lives in
// /public/sw.js and is registered lazily the first time we need it — we
// don't want to claim the SW scope for users who never enable push.

import { api } from './api';

export type PushStatus = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed' | 'unknown';

function urlBase64ToUint8Array(base64: string) {
  // The web-push spec uses URL-safe base64 without padding; the browser's
  // atob does not.  Pad + replace before decoding.
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const str = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(str);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function getRegistration() {
  if (!pushSupported()) return null;
  // Cache-by-scope: navigator.serviceWorker.register is idempotent for the
  // same file path, so calling it repeatedly is cheap and gives us back the
  // active registration either way.
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await getRegistration();
    if (!reg) return 'unsupported';
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'unsubscribed';
  } catch {
    return 'unknown';
  }
}

export async function subscribePush(token: string): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'unsubscribed';

  const reg = await getRegistration();
  if (!reg) return 'unsupported';

  const { publicKey } = await api<{ publicKey: string | null }>('/push/public-key', { token });
  if (!publicKey) {
    console.warn('[push] backend returned no VAPID public key');
    return 'unsupported';
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  // The subscription's toJSON() gives us the endpoint + keys in the exact
  // shape the backend expects — no manual serialization needed.
  const json = sub.toJSON() as any;
  await api('/push/subscribe', {
    token,
    method: 'POST',
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
    }),
  });
  return 'subscribed';
}

export async function unsubscribePush(token: string): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  const reg = await getRegistration();
  if (!reg) return 'unsupported';
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    try {
      await api('/push/unsubscribe', {
        token,
        method: 'POST',
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    } catch {}
    await sub.unsubscribe();
  }
  return 'unsubscribed';
}

export async function sendTestPush(token: string) {
  return api<{ sent: number; pruned: number }>('/push/test', {
    token,
    method: 'POST',
    body: JSON.stringify({}),
  });
}
