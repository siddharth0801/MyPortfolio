/*
 * Service worker for /MyPortfolio/expense-tracker/
 *
 * DEPLOY NOTE: bump VERSION (and the ?v= query on the script tags in index.html) whenever app files change.
 * Same-origin shell files are fetched network-first with cache:'no-cache' so an online user never sees stale
 * JS even though GitHub Pages caches for 10 minutes; the cache is only the offline fallback.
 * Pinned CDN libraries are immutable, so they are served cache-first.
 */
const VERSION = 'v1';
const SHELL_CACHE = 'et-shell-' + VERSION;
const LIB_CACHE = 'et-libs-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './parsers.js',
  './metrics.js',
  './cfb-decrypt.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map((u) => shell.add(new Request(u, { cache: 'no-cache' })).catch(() => null)));
    const libs = await caches.open(LIB_CACHE);
    await Promise.all(LIBS.map((u) => libs.add(u).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('et-') && k !== SHELL_CACHE && k !== LIB_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isLib = LIBS.some((u) => req.url.startsWith(u.split('?')[0]));
  if (isLib) {
    event.respondWith((async () => {
      const cache = await caches.open(LIB_CACHE);
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    try {
      const res = await fetch(new Request(req, { cache: 'no-cache' }));
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || (await cache.match('./'));
      throw e;
    }
  })());
});
