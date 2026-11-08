/* Service worker Jimpitan RT — cangkang aplikasi tetap bisa dibuka saat offline.
 * Strategi: network-first untuk file situs ini (selalu versi terbaru bila online),
 * stale-while-revalidate untuk CDN. Panggilan API (POST) TIDAK pernah disentuh. */
const V = 'sikas-shell-v2.4.0', CDN = 'sikas-cdn-v1';
const SHELL = ['./', 'index.html', 'css/style.css?v=2.4.0', 'js/config.js?v=2.4.0', 'js/app.js?v=2.4.0', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== CDN).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; }).catch(() => caches.match(r, { ignoreSearch: false }).then(m => m || caches.match('index.html'))));
    return;
  }
  if (/(^|\.)(jsdelivr\.net|googleapis\.com|gstatic\.com|cloudflare\.com)$/.test(u.hostname)) {
    e.respondWith(caches.open(CDN).then(c => c.match(r).then(m => {
      const net = fetch(r).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(r, res.clone()); return res; }).catch(() => m);
      return m || net;
    })));
  }
});
