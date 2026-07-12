/* FPL Analyser service worker.
 *
 * Strategy (same-origin only — cross-origin FPL API / photos / fonts pass
 * straight through and are never cached):
 *   • navigations (index.html) → network-first, fall back to cached shell
 *   • site_data/*.json          → network-first, fall back to last-known data
 *   • js / css / icons / etc.   → stale-while-revalidate (instant, self-updating)
 *
 * No build step and no manual version bumping: stale-while-revalidate keeps the
 * cache continuously fresh, so a code change is picked up automatically on the
 * visit after next. Bump CACHE_VERSION only if this file's own logic changes.
 */
const CACHE_VERSION = 'v1';
const CACHE = `fpl-analyser-${CACHE_VERSION}`;

// Best-effort precache of the core shell so the very next load works offline.
// Individual failures are ignored so one missing file can't abort activation.
const CORE = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(CORE.map((u) => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isSiteData(url) {
  return url.pathname.includes('/site_data/');
}

async function networkFirst(request, fallbackToShell) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackToShell) {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    throw e;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then((resp) => {
    if (resp && resp.ok) cache.put(request, resp.clone());
    return resp;
  }).catch(() => null);
  return cached || network || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only manage same-origin traffic; let the FPL API, player photos, badges
  // and Google Fonts go to the network untouched.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, true));
  } else if (isSiteData(url)) {
    event.respondWith(networkFirst(request, false));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});
