/* Тек интерфейс файлдарын кэштейді. Серверге (Google) сұраныстар кэштелмейді —
   тіркеу тек сервер жауабы келгенде сәтті саналады. */
const CACHE = 'tabel-free-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'xlsx.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const cdn = url.origin === 'https://cdn.jsdelivr.net';
  if (url.origin !== self.location.origin && !cdn) return;   // Google API — тек желі
  if (url.pathname.endsWith('kiosk.html')) return;
  if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(() => caches.match('index.html'))); return; }
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req);
    const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
