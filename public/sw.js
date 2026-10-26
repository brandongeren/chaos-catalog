// Offline support for the app itself (HTML, scripts, styles, icons). Card data and collections are cached by the
// app in IndexedDB, so data/ and API calls are left alone here.
const CACHE = 'chaos-catalog-shell-v2'
const SCOPE = new URL('./', self.location).href

// On install, store the page and the build files it references, so even the first visit works offline afterwards
// (requests made before the worker took control never pass through it).
async function precache() {
  const cache = await caches.open(CACHE)
  const res = await fetch(SCOPE, { cache: 'no-cache' })
  if (!res.ok) return
  const html = await res.clone().text()
  await cache.put(SCOPE, res)
  const files = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((m) => new URL(m[1], SCOPE).href)
    .filter((u) => u.startsWith(SCOPE) && !u.includes('/data/'))
  await Promise.all(files.map((u) => cache.add(u).catch(() => {})))
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()))
})

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
  const navigate = event.request.mode === 'navigate'
  // Hashed build files never change: cache first. Everything else (the page, icons): network first.
  const immutable = url.pathname.includes('/assets/')
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      if (immutable) {
        const hit = await cache.match(event.request)
        if (hit) return hit
      }
      try {
        const res = await fetch(event.request)
        // The app is one page whatever the ?view=..., so store navigations under the page itself.
        if (res.ok) await cache.put(navigate ? SCOPE : event.request, res.clone())
        return res
      } catch (err) {
        const hit = navigate ? await cache.match(SCOPE) : await cache.match(event.request, { ignoreSearch: true })
        if (hit) return hit
        throw err
      }
    }),
  )
})
