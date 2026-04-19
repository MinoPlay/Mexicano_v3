import { Store } from '../store.js';
import { State } from '../state.js';
import { renderThemeToggle } from '../components/theme-toggle.js';
import { calculateAllEloRankings } from '../services/elo.js';
import { getAllTournamentDates, getActiveTournament } from '../services/tournament.js';
import { getMembers } from '../services/members.js';

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function getUniquePlayersFromMatches(matches) {
  const players = new Set();
  for (const m of matches) {
    if (m.team1Player1Name) players.add(m.team1Player1Name);
    if (m.team1Player2Name) players.add(m.team1Player2Name);
    if (m.team2Player1Name) players.add(m.team2Player1Name);
    if (m.team2Player2Name) players.add(m.team2Player2Name);
  }
  return players;
}

/**
 * Build a map of player name → ELO from the second-to-last monthly overview.
 * Used to compute ELO change when only summary data is available.
 */
function buildPreviousEloMap() {
  const months = Store.getMonthlyOverviewMonths(); // sorted ascending
  if (months.length < 2) return {};
  // If the latest month's overview exists, use the one before it
  const prevMonth = months[months.length - 2];
  const overview = Store.getMonthlyOverview(prevMonth);
  const map = {};
  for (const p of overview) {
    map[p.name] = p.elo;
  }
  return map;
}

export function renderHome(container, params) {
  const playersSummary = Store.getPlayersSummary();
  const tournamentDates = getAllTournamentDates();
  const activeTournament = getActiveTournament();

  let rankings;
  let allPlayersCount;

  if (playersSummary.length > 0) {
    // Use pre-computed ELO data (avoids loading all match files).
    // Compute change by comparing current ELO with the previous month's overview.
    const prevEloMap = buildPreviousEloMap();
    rankings = playersSummary.map((p, idx) => {
      const prevElo = prevEloMap[p.name];
      const change = prevElo !== undefined ? Math.round((p.elo - prevElo) * 100) / 100 : 0;
      return { place: idx + 1, name: p.name, elo: p.elo, change };
    });
    allPlayersCount = playersSummary.length;
  } else {
    // Fall back to computing from locally cached matches
    const matches = Store.getMatches();
    const eloResult = calculateAllEloRankings(matches);
    rankings = eloResult.rankings || [];
    allPlayersCount = getUniquePlayersFromMatches(matches).size;
  }

  const latestDate = tournamentDates.length > 0
    ? formatDate(tournamentDates[0])
    : '—';

  // Determine which players played in the current calendar month.
  // Fall back to the latest month with data if the current month has none.
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let activeMonthPlayerSet = null;

  // Try current month from monthly overview
  const currentOverview = Store.getMonthlyOverview(currentYearMonth);
  if (currentOverview.length > 0) {
    activeMonthPlayerSet = new Set(currentOverview.map(p => p.name.toLowerCase()));
  }

  // Try current month from raw matches
  if (!activeMonthPlayerSet) {
    const allMatchesForMonth = Store.getMatches().filter(m => m.date?.startsWith(currentYearMonth));
    if (allMatchesForMonth.length > 0) {
      const players = new Set();
      for (const m of allMatchesForMonth) {
        [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name]
          .filter(Boolean).forEach(n => players.add(n.toLowerCase()));
      }
      if (players.size > 0) activeMonthPlayerSet = players;
    }
  }

  // Fall back to latest month with data
  if (!activeMonthPlayerSet) {
    const months = Store.getMonthlyOverviewMonths();
    if (months.length > 0) {
      const latestMonth = months[months.length - 1];
      const overview = Store.getMonthlyOverview(latestMonth);
      if (overview.length > 0) {
        activeMonthPlayerSet = new Set(overview.map(p => p.name.toLowerCase()));
      }
    }
  }
  if (!activeMonthPlayerSet) {
    const allMatches = Store.getMatches();
    const matchDates = allMatches.map(m => m.date).filter(Boolean);
    if (matchDates.length > 0) {
      const latestMonth = [...new Set(matchDates.map(d => d.substring(0, 7)))].sort().pop();
      const monthMatches = allMatches.filter(m => m.date?.startsWith(latestMonth));
      const players = new Set();
      for (const m of monthMatches) {
        [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name]
          .filter(Boolean).forEach(n => players.add(n.toLowerCase()));
      }
      if (players.size > 0) activeMonthPlayerSet = players;
    }
  }

  const members = getMembers();
  const memberSet = new Set(members.map(m => m.toLowerCase()));
  let filteredRankings = memberSet.size > 0
    ? rankings.filter(p => memberSet.has(p.name.toLowerCase()))
    : rankings;

  if (activeMonthPlayerSet) {
    filteredRankings = filteredRankings.filter(p => activeMonthPlayerSet.has(p.name.toLowerCase()));
  }

  const top10 = filteredRankings.slice(0, 10);

  container.innerHTML = `
    <header class="page-header">
      <h1>🎾 Mexicano</h1>
      <div class="flex items-center gap-sm" id="home-header-right"></div>
    </header>
    <div class="page-content">
      <div class="home-quick-stats">
        <div class="quick-stat-card">
          <div class="stat-value">${tournamentDates.length}</div>
          <div class="stat-label">Tournaments</div>
        </div>
        <div class="quick-stat-card">
          <div class="stat-value">${allPlayersCount}</div>
          <div class="stat-label">Players</div>
        </div>
        <div class="quick-stat-card">
          <div class="stat-value">${latestDate}</div>
          <div class="stat-label">Latest</div>
        </div>
        <div class="quick-stat-card">
          <div class="stat-value">${activeTournament ? '🟢' : '—'}</div>
          <div class="stat-label">Active</div>
        </div>
      </div>

      ${activeTournament ? `
        <a href="#/tournament/${activeTournament.tournamentDate}" class="card" style="display:block;margin-bottom:var(--space-md);border-left:3px solid var(--color-success);text-decoration:none;color:inherit;">
          <div class="card-header">
            <span class="card-title">Active Tournament</span>
            <span class="badge badge-success">Live</span>
          </div>
          <div class="text-sm text-secondary">
            ${formatDate(activeTournament.tournamentDate)} · ${activeTournament.players?.length || 0} players
          </div>
        </a>
      ` : ''}

      <div class="card" style="margin-bottom:var(--space-md);">
        <div class="card-header">
          <span class="card-title">ELO Leaderboard</span>
        </div>
        ${top10.length === 0 ? `
          <div class="text-sm text-secondary text-center" style="padding:var(--space-md);">
            No matches played yet
          </div>
        ` : top10.map((p, i) => {
          const rank = i + 1;
          const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
          const change = p.change ?? 0;
          const changeClass = change > 0 ? 'positive' : change < 0 ? 'negative' : 'neutral';
          const changeIcon = change > 0 ? '▲' : change < 0 ? '▼' : '–';
          const changeText = change !== 0 ? Math.abs(Math.round(change)) : '';
          return `
            <div class="leaderboard-item">
              <span class="leaderboard-rank ${rankClass}">${rank}</span>
              <span class="leaderboard-name">${p.name}</span>
              <span class="leaderboard-value">${Math.round(p.elo)}</span>
              <span class="elo-change ${changeClass}">${changeIcon}${changeText}</span>
            </div>
          `;
        }).join('')}
      </div>

      <div class="flex flex-col gap-sm">
        <a href="#/statistics" class="btn btn-secondary btn-block">📊 View All Statistics</a>
        <a href="#/elo-charts" class="btn btn-secondary btn-block">📈 ELO Charts</a>
      </div>
    </div>
  `;

  // Append theme toggle button
  const headerRight = container.querySelector('#home-header-right');
  if (headerRight) {
    headerRight.appendChild(renderThemeToggle());
  }
}
