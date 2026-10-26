// Offline support for the app itself (HTML, scripts, styles, icons). Card data and collections are cached by the
// app in IndexedDB, so data/ and API calls are left alone here.
const CACHE = 'chaos-catalog-shell-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/data/')) return
  // Hashed build files never change: cache first. Everything else (index.html, icons): network first.
  const immutable = url.pathname.includes('/assets/')
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (immutable) {
        const hit = await cache.match(event.request)
        if (hit) return hit
      }
      try {
        const res = await fetch(event.request)
        if (res.ok) cache.put(event.request, res.clone())
        return res
      } catch (err) {
        const hit = (await cache.match(event.request)) ?? (event.request.mode === 'navigate' ? await cache.match(new URL('./', self.registration.scope).href) : undefined)
        if (hit) return hit
        throw err
      }
    }),
  )
})
