import './storage-ns-init.js'; // must stay first: namespaces storage for previews
import { Router } from './router.js';
import { Store } from './store.js';
import { State } from './state.js';
import { renderNav } from './components/nav.js';
import { resyncPushSubscription } from './services/push.js';
import { showToast } from './components/toast.js';
import { showRefreshDialog } from './components/refresh-dialog.js';
import { pullForRoute } from './services/backend.js';
import { showOnboardingDialog } from './components/onboarding-dialog.js';
import { captureAuthSessionFromUrl } from './services/supabase.js';
import { currentDeployId, nsPrefix } from './deploy-env.js';
import { createRouteLoader } from './services/route-loader.js';
import { perfStart } from './services/perf.js';

// Pages
import { renderHome } from './pages/home.js';
import { renderTournaments } from './pages/tournaments.js';
import { renderTournament } from './pages/tournament.js';
import { renderCreateTournament } from './pages/create-tournament.js';
import { renderStatistics } from './pages/statistics.js';
import { renderEloCharts } from './pages/elo-charts.js';
import { renderAttendance } from './pages/attendance.js';
import { renderDoodle } from './pages/doodle.js';
import { renderSettings } from './pages/settings.js';
import { renderLogs } from './pages/git-logs.js';
import { renderPlayers } from './pages/players.js';
import { renderPlayerCompare } from './pages/player-compare.js';

// ─── Load administrator names from static JSON ───
async function loadAdministrators() {
  try {
    const list = await fetch('data/administrators.json').then(r => r.ok ? r.json() : []);
    if (Array.isArray(list)) Store.setAdministrators(list);
  } catch { /* fall back to empty admin list */ }
}

// ─── Dev config: auto-inject public Supabase config on localhost ───
async function loadDevSecrets() {
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isDev) return;
  try {
    const cfg = await fetch('/api/dev-config').then(r => r.ok ? r.json() : {});
    if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
      Store.setSupabaseConfig({ url: cfg.supabaseUrl, anonKey: cfg.supabaseAnonKey });
      console.log('Supabase public config loaded from local dev config');
    }
  } catch { /* server not running or no secrets file */ }
}

// Load local test data if available (dev server with local-config.json)
async function loadLocalData() {
  // Skip local data loading on deployed version or if Supabase is configured
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isDev || Store.getSupabaseConfig()) return;

  try {
    const status = await fetch('/api/local-data/status').then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    if (!status.available) return;

    // ─── Matches + players: only on first load ───
    if (Store.isMatchesFullyLoaded()) return;
    console.log('Loading local test data…');
    const [matches, players] = await Promise.all([
      fetch('/api/local-data/matches').then(r => r.json()),
      fetch('/api/local-data/players').then(r => r.json()).catch(() => null),
    ]);
    if (matches.length > 0) {
      Store.setMatches(matches);
      Store.setMatchesFullyLoaded(true);
      if (Array.isArray(players)) {
        const names = players.map(p => p.Name).sort();
        Store.setMembers(names);
      }
      console.log(`Loaded ${matches.length} matches from local data`);
    }
  } catch { /* not running on dev server, or no local data */ }
}

// Each route loads only its own data (see js/services/supabase.js routeScope).
// In-memory Cache is empty on every page refresh, so the first pull runs fresh;
// later visits to a route reuse cached resources.
const loadRoute = createRouteLoader({
  pull: (hash) => pullForRoute(hash),
  render: () => router.resolve(),
  currentHash: () => window.location.hash,
  onError: (e) => {
    console.warn('Supabase auto-pull failed:', e);
    showToast(`⚠️ Sync failed: ${e.message}`);
  },
});

async function loadFromBackend() {
  if (!Store.getSupabaseConfig()) return;
  await loadRoute(window.location.hash);
}

window.addEventListener('hashchange', () => { loadFromBackend(); });

captureAuthSessionFromUrl();

async function init() {
  // One-time migration: drop Supabase-owned data that older builds persisted
  // on this device, so it can never shadow the live backend state.
  localStorage.removeItem('mexicano_azure_conn_str');
  Store.purgeNonPersistedKeys();

  const startupDone = perfStart('startup');

  // Returning users already have config + session + role: start the route's
  // data load immediately instead of waiting for the serial init below.
  const returningUser = !!(Store.getSupabaseConfig()
    && Store.getSupabaseSession()?.access_token
    && Store.getAccessRole());
  const earlyLoad = returningUser ? loadFromBackend() : null;

  await Promise.all([loadAdministrators(), loadDevSecrets()]);

  await showOnboardingDialog();

  await loadLocalData();
  (earlyLoad || loadFromBackend()).then(() => startupDone({ earlyLoad: returningUser }));

  // Back-fill the `user` tag on an already-granted push subscription so targeted
  // sends can reach this device without the user re-enabling push. Fire-and-forget.
  resyncPushSubscription().catch(() => {});
}
init();

// Cross-tab Supabase config/session sync.
window.addEventListener('storage', (e) => {
  const keys = [
    'mexicano_supabase_config',
    'mexicano_supabase_session',
    'mexicano_access_role',
  ].map(key => nsPrefix(currentDeployId()) + key);
  if (!keys.includes(e.key)) return;
  if (e.newValue) {
    loadFromBackend();
  } else {
    location.reload();
  }
});


// Mount sidebar nav
const app = document.getElementById('app');
app.appendChild(renderNav());

// Page container
const pageContainer = document.getElementById('page-container');

// Routes
const routes = {
  '/': renderHome,
  '/tournaments': renderTournaments,
  '/tournament/:date': renderTournament,
  '/create-tournament': renderCreateTournament,
  '/players': renderPlayers,
  '/players/compare': renderPlayerCompare,
  '/statistics': renderStatistics,
  '/elo-charts': renderEloCharts,
  '/attendance': renderAttendance,
  '/doodle': renderDoodle,
  '/logs': renderLogs,
  '/settings': renderSettings
};

// Initialize router
const router = new Router(routes, pageContainer);

function getPageName(hash) {
  const path = (hash || '').replace(/^#/, '').split('?')[0] || '/';
  const names = {
    '/': 'Home',
    '/tournaments': 'Tournaments',
    '/players': 'Players',
    '/players/compare': 'Compare',
    '/statistics': 'Statistics',
    '/elo-charts': 'ELO Charts',
    '/attendance': 'Attendance',
    '/doodle': 'Doodle',
    '/settings': 'Settings',
  };
  if (path.startsWith('/tournament/')) return 'Tournament';
  return names[path] || 'Data';
}

// Register service worker. Auto-reload once when a NEW sw version takes control
// (an update), so opening the app forces the user onto the latest build.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('./sw.js', { type: 'module', updateViaCache: 'none' }).catch(() => {});
}
