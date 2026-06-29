// 親指偏差値 Service Worker（最小・安全構成）
// - ナビゲーションは network-first（新ビルドを取りこぼさない）
// - 静的アセットは stale-while-revalidate
// - バージョンを上げると旧キャッシュを破棄
const VERSION = 'oyayubi-v0.2.0'
const SCOPE_URL = new URL(self.registration.scope)
const SHELL = [SCOPE_URL.pathname, `${SCOPE_URL.pathname}index.html`, `${SCOPE_URL.pathname}icon.svg`]

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then(cache => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(VERSION).then(c => c.put(req, copy))
          }
          return res
        })
        .catch(() => caches.match(req).then(r => r || caches.match(`${SCOPE_URL.pathname}index.html`))),
    )
    return
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(VERSION).then(c => c.put(req, copy))
          }
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
