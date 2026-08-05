// Single source of truth for the app version / cache name.
// Bump APP_VERSION by +1 each release. js/version.js imports it.
export const APP_VERSION = 42;

const CACHE_NAME = `mexicano-v${APP_VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './data/administrators.json',
  './css/variables.css',
  './css/base.css',
  './css/components.css',
  './css/pages.css',
  './js/app.js',
  './js/router.js',
  './js/store.js',
  './js/state.js',
  './js/services/tournament.js',
  './js/services/elo.js',
  './js/services/statistics.js',
  './js/services/ranking.js',
  './js/services/attendance.js',
  './js/services/doodle.js',
  './js/services/members.js',
  './js/components/nav.js',
  './js/components/match-card.js',
  './js/components/score-input.js',
  './js/components/player-profile.js',
  './js/components/leaderboard.js',
  './js/components/chart.js',
  './js/components/install-prompt.js',
  './js/components/manual-attendance-dialog.js',
  './js/pages/home.js',
  './js/pages/tournaments.js',
  './js/pages/tournament.js',
  './js/pages/create-tournament.js',
  './js/pages/statistics.js',
  './js/pages/elo-charts.js',
  './js/pages/attendance.js',
  './js/pages/doodle.js',
  './js/pages/settings.js'
];

const isServiceWorker = typeof ServiceWorkerGlobalScope !== 'undefined'
  && self instanceof ServiceWorkerGlobalScope;

if (isServiceWorker) {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then(cache => cache.addAll(ASSETS))
        .then(() => self.skipWaiting())
    );
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys()
        .then(keys => Promise.all(
          keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    // Network-first: always try the network so an open pulls the latest files,
    // refresh the cache, and fall back to cache only when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match('./index.html')))
    );
  });
}
