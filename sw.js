/**
 * Musico - PWA Offline Service Worker
 */

const CACHE_NAME = 'musico-cache-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/player.js',
  './js/fileManager.js',
  './js/id3Parser.js',
  './assets/Mlogo.png',
  './assets/Mlogowithbg.png',
  './assets/M logo for music items.png',
  './assets/Addbtn.png',
  './assets/HomeMenuItem.png',
  './assets/PlaylistMenuItem.png',
  './assets/AlbumMenuItem.png',
  './assets/AllSongsMenuItem.png',
  './assets/DeleteMenuItem.png',
  './assets/Search.png',
  './assets/Settings.png',
  './assets/ProfilePic.png',
  './assets/Prevbtn.svg',
  './assets/Plausebtn.svg',
  './assets/Nxtbtn.svg',
  './assets/OptionsThreeDots.svg',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png'
];

// Install Event - Cache Core Assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Some assets could not be pre-cached:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Stale-while-revalidate / Cache-first
self.addEventListener('fetch', (e) => {
  // Skip non-GET and blob/data requests
  if (e.request.method !== 'GET' || e.request.url.startsWith('blob:') || e.request.url.startsWith('data:')) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh copy in background
        fetch(e.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, networkResponse));
          }
        }).catch(() => {/* offline */});
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseToCache);
        });
        return networkResponse;
      });
    }).catch(() => {
      // Offline fallback
      return caches.match('./index.html');
    })
  );
});
