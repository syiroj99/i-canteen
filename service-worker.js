// ============================================================================
// service-worker.js — App shell caching untuk i-Canteen PWA.
//
// STRATEGI (sengaja dibuat konservatif, bukan "offline-first penuh"):
// 1. Request ke Supabase (*.supabase.co, termasuk realtime websocket) TIDAK
//    PERNAH disentuh service worker ini - selalu lewat langsung ke network.
//    Data presensi santri tidak boleh basi/di-cache, dan aplikasi sudah
//    punya mekanisme antrean offline sendiri (callApiQueueable di index.html)
//    yang menangani kegagalan network untuk aksi tulis.
// 2. Navigasi ke halaman (index.html) pakai strategi network-first: kalau
//    online, selalu ambil versi terbaru; kalau offline, baru fallback ke
//    app shell yang tersimpan di cache supaya halaman tetap bisa terbuka.
// 3. Aset statis (CSS/JS/font dari CDN, ikon) pakai stale-while-revalidate:
//    tampil cepat dari cache, sambil diam-diam diperbarui di background
//    untuk kunjungan berikutnya.
// ============================================================================

const CACHE_VERSION = 'icanteen-v2'; // dinaikkan: menambah fitur Laporan Belum Makan (dapur) di index.html/api.js
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// File inti dalam satu direktori repo - wajib berhasil di-cache saat install.
const APP_SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './js/supabase-client.js',
  './js/api.js',
  './js/realtime.js',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

// ----------------------------------------------------------------------------
// INSTALL - cache app shell. Pakai addAll dengan fallback per-file supaya satu
// aset yang gagal (mis. path lokal berbeda) tidak menggagalkan instalasi.
// ----------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => {
      return Promise.all(
        APP_SHELL_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Lewati cache (gagal ambil):', url, err);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ----------------------------------------------------------------------------
// ACTIVATE - bersihkan cache versi lama.
// ----------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('icanteen-') && key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ----------------------------------------------------------------------------
// FETCH
// ----------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Cuma tangani GET; biarkan POST/PUT/DELETE (mis. ke Supabase RPC) lewat apa adanya.
  if (req.method !== 'GET') return;

  // Jangan pernah cache/ganggu Supabase (REST, RPC, maupun realtime websocket).
  if (url.hostname.endsWith('supabase.co')) {
    return; // biarkan browser tangani langsung ke network
  }

  // Navigasi halaman (buka/refresh app) -> network-first, fallback ke shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const resClone = res.clone();
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put('./index.html', resClone));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Aset statis lain (CDN JS/CSS, font, ikon) -> stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached); // offline & belum ke-cache -> biarkan gagal wajar

      return cached || networkFetch;
    })
  );
});
