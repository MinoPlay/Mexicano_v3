const CACHE_NAME = 'mexicano-v20260423081219';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
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
  './js/components/theme-toggle.js',
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
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
      .catch(() => caches.match('./index.html'))
  );
});
