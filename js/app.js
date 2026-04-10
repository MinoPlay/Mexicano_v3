import { Router } from './router.js';
import { Store } from './store.js';
import { renderNav } from './components/nav.js';
import { initTheme } from './components/theme-toggle.js';

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
  try {
    const status = await fetch('/api/local-data/status').then(r => r.json());
    if (!status.available) return;
    // Skip if we already loaded local data this session
    if (localStorage.getItem('mexicano_local_data_loaded') === 'true') return;
    console.log('Loading local test data…');
    const [matches, players] = await Promise.all([
      fetch('/api/local-data/matches').then(r => r.json()),
      fetch('/api/local-data/players').then(r => r.json()).catch(() => null),
    ]);
    if (matches.length > 0) {
      Store.setMatches(matches);
      localStorage.setItem('mexicano_matches_fully_loaded', JSON.stringify(true));
      // Load members from players.json
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
  '/settings': renderSettings
};

// Initialize router
const router = new Router(routes, pageContainer);

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
