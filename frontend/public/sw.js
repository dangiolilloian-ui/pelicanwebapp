// Pelican service worker.
//
// Scope: whole app (registered with `/` scope).  Responsibilities:
//   - Receive web-push events and render the notification
//   - Focus or open the tab when the user taps a notification
//
// Kept dependency-free and self-contained so it can be versioned by simply
// bumping `SW_VERSION` when behavior changes (browsers short-circuit updates
// for byte-identical files).

const SW_VERSION = 'v1';

self.addEventListener('install', () => {
  // Activate as soon as the previous SW releases so users don't need a second
  // reload to pick up updates.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { title: 'Pelican', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Pelican';
  const options = {
    body: data.body || '',
    icon: '/pelican-logo.png',
    badge: '/pelican-logo.png',
    data: { link: data.link || '/dashboard' },
    tag: data.type || 'pelican',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/dashboard';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // If the app is already open somewhere, focus it and navigate there
      // rather than spawning a second tab.
      for (const client of all) {
        if ('focus' in client) {
          client.navigate(link).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })()
  );
});
