import { Router } from './router.js';
import { Store } from './store.js';
import { State } from './state.js';
import { renderNav } from './components/nav.js';
import { showToast } from './components/toast.js';
import { showRefreshDialog } from './components/refresh-dialog.js';
import { pullForRoute } from './services/github.js';
import { initInstallPrompt } from './components/install-prompt.js';
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
import { renderGitLogs } from './pages/git-logs.js';

// ─── Dev secrets: auto-inject GitHub config on localhost ───
async function loadDevSecrets() {
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isDev) return;
  try {
    const cfg = await fetch('/api/dev-config').then(r => r.ok ? r.json() : {});
    if (cfg.pat) {
      Store.setGitHubConfig({ owner: cfg.owner, repo: cfg.repo, pat: cfg.pat, basePath: cfg.basePath });
      console.log('GitHub config loaded from local-secrets.json');
    }
  } catch { /* server not running or no secrets file */ }
}

// Load local test data if available (dev server with local-config.json)
async function loadLocalData() {
  // Skip local data loading on deployed version or if GitHub is already configured
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isDev || Store.getGitHubConfig()?.pat) return;

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
  await loadDevSecrets();
  initInstallPrompt();

  await showOnboardingDialog();

  await loadLocalData();
  loadFromGitHub();
}
init();

// Cross-tab PAT sync: when another tab saves/clears the GitHub config, reload data here too.
window.addEventListener('storage', (e) => {
  if (e.key !== 'mexicano_github_config') return;
  if (e.newValue) {
    loadFromGitHub();
  } else {
    location.reload();
  }
});

// Auto-pull from GitHub on every page open/refresh if configured.
// In-memory Cache is empty on every page refresh, so pull always runs fresh.
async function loadFromGitHub() {
  if (!Store.getGitHubConfig()?.pat) return;
  try {
    await pullForRoute(window.location.hash);
    // Re-render the current page with freshly pulled data
    router.resolve();
  } catch (e) {
    console.warn('GitHub auto-pull failed:', e);
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
  '/git-logs': renderGitLogs,
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

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
