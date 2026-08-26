// Single source of truth for the app version / cache name.
// Bump APP_VERSION by +1 each release. js/version.js imports it.
import { networkFirst, shouldHandleRequest } from './js/sw-fetch.js';
import { addNotification } from './js/services/notification-store.js';

export const APP_VERSION = 86;

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
  './js/services/push.js',
  './js/services/notification-store.js',
  './js/services/pinned-announcements.js',
  './js/sw-fetch.js',
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
    // Only same-origin GETs use the cache strategy. Cross-origin requests
    // (GitHub API, Telegram, push) bypass the SW so their AbortController
    // timeouts work and auth'd responses are never cached — otherwise an
    // installed mobile PWA hangs on completion (End Tournament → finalize).
    if (!shouldHandleRequest(req, self.location.origin)) return;
    // Network-first with HTTP-cache bypass (see js/sw-fetch.js): always pull the
    // latest files so updates reach every device; cache is offline fallback only.
    event.respondWith(networkFirst(req, { fetch, caches, cacheName: CACHE_NAME }));
  });

  self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
    const title = data.title || 'Mexicano';
    const options = {
      body: data.body || '',
      icon: './assets/icons/icon-192.png',
      badge: './assets/icons/icon-192.png',
      data: { url: data.url || './' },
    };
    // Keep the native OS popup, and also save to history so the in-app bell
    // shows past notifications even after they've disappeared from the tray.
    event.waitUntil(Promise.all([
      self.registration.showNotification(title, options),
      addNotification({ title, body: options.body, url: options.data.url }).then(() =>
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      ).then(clientList => {
        clientList.forEach(client => client.postMessage({ type: 'mexicano-notification-added' }));
      }).catch(() => { /* history is best-effort; native popup already fired */ }),
    ]));
  });

  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = event.notification.data?.url || './';
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) return client.focus();
        }
        return self.clients.openWindow(target);
      })
    );
  });
}
