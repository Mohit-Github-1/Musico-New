/**
 * Musico - PWA Offline Service Worker (v17)
 */

const CACHE_NAME = 'musico-cache-v17';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/player.js',
  './js/fileManager.js',
  './js/id3Parser.js',
  './assets/ADD%20button%20with%20no%20BG.png',
  './assets/M%20logo.png',
  './assets/app%20icon%20main.png',
  './assets/App%20Icon%20Main%20for%20Mobile%20Only.png',
  './assets/Mlogo.png',
  './assets/Mlogowithbg.png',
  './assets/M%20logo%20for%20music%20items.png',
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
  './assets/Dark%20Mode/DarkModeNxtBtn.svg',
  './assets/Dark%20Mode/DarkModeOptionsbtn.svg',
  './assets/Dark%20Mode/DarkModePauseBtn.svg',
  './assets/Dark%20Mode/DarkModePrevBtn.svg',
  './assets/Dark%20Mode/DarkModeSearchIcon.png',
  './assets/Dark%20Mode/DarkModeSettings.png',
  './assets/Dark%20Mode/DarkModeThreeDots.png',
  './assets/icons/icon-72.png',
  './assets/icons/icon-96.png',
  './assets/icons/icon-128.png',
  './assets/icons/icon-144.png',
  './assets/icons/icon-152.png',
  './assets/icons/icon-192.png',
  './assets/icons/icon-384.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-192.png',
  './assets/icons/icon-maskable-512.png'
];

// Install Event - Pre-cache core assets safely
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.allSettled(
        STATIC_ASSETS.map((url) => cache.add(url))
      );
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
        // Background refresh
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
      return caches.match('./index.html');
    })
  );
});
