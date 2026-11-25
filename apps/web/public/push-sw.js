/* Siwu Connect: shows phone/computer notifications and opens the right page when one is tapped.
   Loaded into the app's service worker (vite.config.ts → workbox.importScripts). */
/* eslint-disable no-undef */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Siwu Connect', body: event.data ? event.data.text() : '' };
  }
  const url = new URL(data.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      // Already looking at that chat or page in the app? Then no pop-up is needed.
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const here = windows.some((w) => w.focused && w.visibilityState === 'visible' && w.url.split('#')[0] === url.split('#')[0]);
      if (here) return;
      await self.registration.showNotification(data.title || 'Siwu Connect', {
        body: data.body || '',
        icon: '/icon-192.png',
        badge: '/badge-96.png',
        tag: data.tag || undefined,
        renotify: !!data.tag,
        data: { url },
        timestamp: Date.now(),
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.location.origin + '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => w.url.startsWith(self.location.origin));
      if (open) {
        await open.focus();
        if ('navigate' in open && open.url !== url) {
          // Tell the app to go there (keeps the app running instead of reloading it).
          open.postMessage({ type: 'siwu:navigate', url });
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
