// ─────────────────────────────────────────────
//  Service worker: permite abrir la app sin señal.
//  - Archivos propios: se responde desde la caché y se actualiza en segundo plano
//    (la versión nueva se ve al siguiente arranque).
//  - Librerías del CDN (Firebase, pdf.js): versiones fijas, se guardan la primera vez.
//  - Firestore y el ingreso con Google no pasan por aquí.
// ─────────────────────────────────────────────

const CACHE = 'dak-visitas-v2';
const CACHE_CDN = 'dak-visitas-cdn-v1';
const BASE = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'firebase-config.js',
  'js/app.js', 'js/nube.js', 'js/almacen.js', 'js/util.js', 'js/catalogos.js',
  'js/imagenes.js', 'js/plano.js', 'js/exportar.js',
  'iconos/icono-96.png', 'iconos/icono-192.png', 'iconos/icono-512.png', 'iconos/logo-dak.png'
];
const CDN = ['https://www.gstatic.com/firebasejs/', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== CACHE_CDN).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const clave = req.mode === 'navigate' ? 'index.html' : req;
      const guardada = await c.match(clave, { ignoreSearch: true });
      const red = fetch(req).then(r => { if (r.ok) c.put(clave, r.clone()); return r; }).catch(() => null);
      if (guardada) { e.waitUntil(red); return guardada; }
      return (await red) || new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })());
    return;
  }

  if (CDN.some(p => req.url.startsWith(p))) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE_CDN);
      const guardada = await c.match(req);
      if (guardada) return guardada;
      const r = await fetch(req);
      if (r.ok) c.put(req, r.clone());
      return r;
    })());
  }
});
