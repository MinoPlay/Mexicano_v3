import { Router } from './router.js';
import { Store } from './store.js';
import { State } from './state.js';
import { renderNav } from './components/nav.js';
import { initTheme } from './components/theme-toggle.js';
import { mountSyncIndicator, setSyncBusy } from './components/sync-indicator.js';
import { showToast } from './components/toast.js';
import { pullAll, pullForRoute } from './services/github.js';

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

// Initialize theme
initTheme();

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

    // ─── Doodle: always reload from local file (current + next month) ───
    const now = new Date();
    const doodleMonths = [0, 1].map(offset => {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    const doodleResults = await Promise.all(
      doodleMonths.map(ym =>
        fetch(`/api/local-data/doodle?yearMonth=${ym}`).then(r => r.ok ? r.json() : null).catch(() => null)
      )
    );
    doodleMonths.forEach((ym, i) => {
      if (Array.isArray(doodleResults[i]) && doodleResults[i].length > 0) {
        Store.setDoodle(ym, doodleResults[i]);
        const [y, m] = ym.split('-').map(Number);
        State.emit('doodle-changed', { year: y, month: m });
        console.log(`Loaded doodle for ${ym} (${doodleResults[i].length} entries)`);
      }
    });

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
loadLocalData();

// Auto-pull from GitHub on every page open/refresh if configured.
// Uses a flag to distinguish our own reload (skip) from a user-initiated refresh (pull).
async function loadFromGitHub() {
  if (!Store.getGitHubConfig()?.pat) return;
  if (sessionStorage.getItem('mexicano_github_just_pulled') === 'true') {
    sessionStorage.removeItem('mexicano_github_just_pulled');
    const result = sessionStorage.getItem('mexicano_sync_result');
    sessionStorage.removeItem('mexicano_sync_result');
    if (result === 'updated') showToast('✅ Data updated');
    else if (result === 'uptodate') showToast('✓ Up to date');
    return;
  }
  setSyncBusy(true);
  try {
    const { updated } = await pullForRoute(window.location.hash);
    sessionStorage.setItem('mexicano_github_just_pulled', 'true');
    sessionStorage.setItem('mexicano_sync_result', updated ? 'updated' : 'uptodate');
    location.reload();
  } catch (e) {
    setSyncBusy(false);
    console.warn('GitHub auto-pull failed:', e);
    showToast(`⚠️ Sync failed: ${e.message}`);
  }
}

// Mount bottom nav
const app = document.getElementById('app');
app.appendChild(renderNav());

// Mount sync indicator (only when GitHub configured)
if (Store.getGitHubConfig()?.pat) {
  mountSyncIndicator(async () => {
    setSyncBusy(true);
    try {
      await pullAll();
      sessionStorage.setItem('mexicano_github_just_pulled', 'true');
      sessionStorage.setItem('mexicano_sync_result', 'updated');
      location.reload();
    } catch (e) {
      showToast(`⚠️ Sync failed: ${e.message}`);
      setSyncBusy(false);
    }
  });
}

loadFromGitHub();

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
  '/settings': renderSettings
};

// Initialize router
const router = new Router(routes, pageContainer);

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
