const CACHE_VERSION = 'v1';
const APP_CACHE = `ambient-sound-app-${CACHE_VERSION}`;
const AUDIO_CACHE = `ambient-sound-audio-${CACHE_VERSION}`;

// Core static assets to precache on Service Worker installation
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './icons.svg',
  './sounds/catalog.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== APP_CACHE && key !== AUDIO_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
  Helper to handle Range requests for cached audio files (iOS Safari compatibility)
 */
async function respondWithRange(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request, { ignoreSearch: true });

  if (cachedResponse) {
    const rangeHeader = request.headers.get('range');
    if (!rangeHeader) {
      return cachedResponse;
    }

    const arrayBuffer = await cachedResponse.arrayBuffer();
    const bytes = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(bytes[0], 10);
    const end = bytes[1] ? parseInt(bytes[1], 10) : arrayBuffer.byteLength - 1;

    if (start >= arrayBuffer.byteLength || end >= arrayBuffer.byteLength) {
      return new Response('', {
        status: 416,
        headers: { 'Content-Range': `bytes */${arrayBuffer.byteLength}` },
      });
    }

    const slicedBuffer = arrayBuffer.slice(start, end + 1);
    return new Response(slicedBuffer, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Content-Type': cachedResponse.headers.get('Content-Type') || 'audio/ogg',
        'Content-Range': `bytes ${start}-${end}/${arrayBuffer.byteLength}`,
        'Content-Length': slicedBuffer.byteLength.toString(),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    return new Response('Network offline', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1. Audio files (.ogg / /sounds/) — Cache-First with Range support
  if (url.pathname.includes('/sounds/') || url.pathname.endsWith('.ogg')) {
    event.respondWith(respondWithRange(request, AUDIO_CACHE));
    return;
  }

  // 2. HTML Navigation requests — Network-first, fallback to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(APP_CACHE).then((cache) => cache.put('./index.html', copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cache = await caches.open(APP_CACHE);
          const cached = await cache.match('./index.html');
          return cached || cache.match(request);
        }),
    );
    return;
  }

  // 3. Static App Shell Assets (JS, CSS, SVGs, Fonts) — Cache-first with stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            caches.open(APP_CACHE).then((cache) => cache.put(request, networkResponse.clone()));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    }),
  );
});
