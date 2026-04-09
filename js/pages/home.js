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

export function renderHome(container, params) {
  const playersSummary = Store.getPlayersSummary();
  const tournamentDates = getAllTournamentDates();
  const activeTournament = getActiveTournament();

  let rankings;
  let allPlayersCount;

  if (playersSummary.length > 0) {
    // Use pre-computed ELO data (avoids loading all match files)
    rankings = playersSummary.map((p, idx) => ({
      place: idx + 1,
      name: p.name,
      elo: p.elo,
      change: 0,
    }));
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

  const members = getMembers();
  const memberSet = new Set(members.map(m => m.toLowerCase()));
  const filteredRankings = memberSet.size > 0
    ? rankings.filter(p => memberSet.has(p.name.toLowerCase()))
    : rankings;
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
