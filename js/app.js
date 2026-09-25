import { Router } from './router.js';
import { Store } from './store.js';
import { State } from './state.js';
import { renderNav } from './components/nav.js';
import { resyncPushSubscription } from './services/push.js';
import { showToast } from './components/toast.js';
import { showRefreshDialog } from './components/refresh-dialog.js';
import { pullForRoute } from './services/backend.js';
import { showOnboardingDialog } from './components/onboarding-dialog.js';

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
    if (localStorage.getItem('mexicano_local_data_loaded') === 'true') return;
    console.log('Loading local test data…');
    const [matches, players] = await Promise.all([
      fetch('/api/local-data/matches').then(r => r.json()),
      fetch('/api/local-data/players').then(r => r.json()).catch(() => null),
    ]);
    if (matches.length > 0) {
      Store.setMatches(matches);
      localStorage.setItem('mexicano_matches_fully_loaded', JSON.stringify(true));
      if (Array.isArray(players)) {
        const names = players.map(p => p.Name).sort();
        Store.setMembers(names);
      }
      localStorage.setItem('mexicano_local_data_loaded', 'true');
      console.log(`Loaded ${matches.length} matches from local data`);
      location.reload();
    }
  } catch { /* not running on dev server, or no local data */ }
}

async function init() {
  // One-time migration: remove stale Azure connection string from localStorage
  localStorage.removeItem('mexicano_azure_conn_str');

  Store.applyDeviceType();

  await loadAdministrators();
  await loadDevSecrets();

  await showOnboardingDialog();

  await loadLocalData();
  loadFromBackend();

  // Back-fill the `user` tag on an already-granted push subscription so targeted
  // sends can reach this device without the user re-enabling push. Fire-and-forget.
  resyncPushSubscription().catch(() => {});
}
init();

// Cross-tab Supabase config/session sync.
window.addEventListener('storage', (e) => {
  if (!['mexicano_supabase_config', 'mexicano_supabase_session', 'mexicano_access_role'].includes(e.key)) return;
  if (e.newValue) {
    loadFromBackend();
  } else {
    location.reload();
  }
});

// Auto-pull from Supabase on every page open/refresh if configured.
// In-memory Cache is empty on every page refresh, so pull always runs fresh.
async function loadFromBackend() {
  if (!Store.getSupabaseConfig()) return;
  try {
    const updated = await pullForRoute(window.location.hash);
    if (updated) router.resolve();
  } catch (e) {
    console.warn('Supabase auto-pull failed:', e);
    showToast(`⚠️ Sync failed: ${e.message}`);
  }
}

// Mount bottom nav
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
