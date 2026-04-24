import { Store } from '../store.js';
import { State } from '../state.js';
import { renderThemeToggle } from '../components/theme-toggle.js';
import { calculateAllEloRankings, getEloSnapshots, getEloForDate } from '../services/elo.js';
import { getAllTournamentDates, getActiveTournament } from '../services/tournament.js';
import { getMembers } from '../services/members.js';
import { calculatePlayerStatistics } from '../services/statistics.js';

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function renderHome(container, params) {
  const playersSummary = Store.getPlayersSummary();
  const tournamentDates = getAllTournamentDates();
  const activeTournament = getActiveTournament();
  const allMatches = Store.getMatches();

  // Get latest tournament date (dates sorted newest first)
  const latestDate = tournamentDates.length > 0 ? tournamentDates[0] : null;

  // Get Latest Tournament stats
  let latestTournamentStats = [];
  let latestEloMap = {};

  if (latestDate) {
    // Get stats for latest tournament date
    const dayMatches = allMatches.filter(m => m.date === latestDate);
    if (dayMatches.length > 0) {
      latestTournamentStats = calculatePlayerStatistics(dayMatches);
    }

    // Get ELO data for that date
    if (playersSummary.length > 0) {
      const summaryMap = {};
      for (const p of playersSummary) {
        summaryMap[p.name] = p;
      }
      for (const stat of latestTournamentStats) {
        const p = summaryMap[stat.name];
        if (p) {
          stat.elo = p.elo;
          stat.eloChange = Math.round(((p.elo ?? 1000) - (p.previousElo ?? 1000)) * 100) / 100;
        }
      }
    } else if (allMatches.length > 0) {
      const { snapshots } = getEloSnapshots(allMatches);
      latestEloMap = getEloForDate(snapshots, latestDate) || {};
      for (const stat of latestTournamentStats) {
        const eloData = latestEloMap[stat.name];
        if (eloData) {
          stat.elo = eloData.elo;
          stat.eloChange = eloData.eloChange;
        }
      }
    }
  }

  // State for sorting
  let sortCol = 'average';
  let sortDir = 'desc';

  function renderTable() {
    const tableContainer = container.querySelector('#latest-tournament-table');
    if (!tableContainer || latestTournamentStats.length === 0) return;

    // Sort data
    const sorted = [...latestTournamentStats];
    sorted.sort((a, b) => {
      let av, bv;
      
      if (sortCol === 'name') {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (sortCol === 'wl') {
        av = a.wins;
        bv = b.wins;
      } else if (sortCol === 'pts') {
        av = a.points;
        bv = b.points;
      } else if (sortCol === 'avg') {
        av = a.average;
        bv = b.average;
      } else if (sortCol === 'win') {
        const totalA = a.wins + a.losses;
        const totalB = b.wins + b.losses;
        av = totalA > 0 ? a.wins / totalA : 0;
        bv = totalB > 0 ? b.wins / totalB : 0;
      } else if (sortCol === 'elo') {
        av = a.elo ?? 0;
        bv = b.elo ?? 0;
      } else if (sortCol === 'change') {
        av = a.eloChange ?? 0;
        bv = b.eloChange ?? 0;
      }

      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    // Render rows
    const rowsHtml = sorted.map((stat, i) => {
      const rank = i + 1;
      const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
      const totalMatches = stat.wins + stat.losses;
      const winPct = totalMatches > 0 ? (stat.wins / totalMatches) * 100 : 0;
      const winPctDisplay = winPct.toFixed(1);
      let winClass = 'win-moderate';
      if (winPct >= 75) winClass = 'win-excellent';
      else if (winPct < 35) winClass = 'win-poor';
      const elo = stat.elo !== undefined && stat.elo !== null ? Math.round(stat.elo) : '—';
      const eloChange = stat.eloChange ?? 0;
      const changeClass = eloChange > 0 ? 'positive' : eloChange < 0 ? 'negative' : 'neutral';
      const changeIcon = eloChange > 0 ? '▲' : eloChange < 0 ? '▼' : '–';
      const changeText = eloChange !== 0 ? Math.abs(Math.round(eloChange * 10) / 10).toFixed(1) : '';
      return `
        <div class="table-row">
          <div class="col-rank rank-class-${rankClass}">${rank}</div>
          <div class="col-name">${stat.name}</div>
          <div class="col-wl">${stat.wins}/${totalMatches}</div>
          <div class="col-pts">${Math.round(stat.points)}</div>
          <div class="col-avg">${stat.average.toFixed(1)}</div>
          <div class="col-winpct ${winClass}">${winPctDisplay}%</div>
          <div class="col-elo">${elo}</div>
          <div class="col-change ${changeClass}">${changeIcon}${changeText}</div>
        </div>
      `;
    }).join('');

    tableContainer.innerHTML = `
      <div class="table-header">
        <div class="col-rank">#</div>
        <div class="col-name table-header-cell" data-sort="name">Name</div>
        <div class="col-wl table-header-cell" data-sort="wl">W/T</div>
        <div class="col-pts table-header-cell" data-sort="pts">PTS</div>
        <div class="col-avg table-header-cell" data-sort="avg">AVG</div>
        <div class="col-winpct table-header-cell" data-sort="win">WIN</div>
        <div class="col-elo table-header-cell" data-sort="elo">ELO</div>
        <div class="col-change table-header-cell" data-sort="change">Δ</div>
      </div>
      ${rowsHtml}
    `;

    // Add click handlers to headers
    tableContainer.querySelectorAll('.table-header-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        const col = cell.dataset.sort;
        if (sortCol === col) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortCol = col;
          sortDir = col === 'name' ? 'asc' : 'desc';
        }
        renderTable();
      });
    });
  }

  container.innerHTML = `
    <header class="page-header">
      <h1>🎾 Mexicano</h1>
      <div class="flex items-center gap-sm" id="home-header-right"></div>
    </header>
    <div class="page-content">
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
          <span class="card-title">Latest Tournament</span>
          ${latestDate ? `<span class="text-sm text-secondary">${formatDate(latestDate)}</span>` : ''}
        </div>
        ${latestTournamentStats.length === 0 ? `
          <div class="text-sm text-secondary text-center" style="padding:var(--space-md);">
            No tournament data available
          </div>
        ` : `
          <div class="latest-tournament-table" id="latest-tournament-table">
            <!-- Table rendered by renderTable() -->
          </div>
        `}
      </div>

      <div class="flex flex-col gap-sm">
        <a href="#/statistics" class="btn btn-secondary btn-block">📊 View All Statistics</a>
        <a href="#/elo-charts" class="btn btn-secondary btn-block">📈 ELO Charts</a>
      </div>
    </div>
  `;

  // Render table after DOM is ready
  if (latestTournamentStats.length > 0) {
    renderTable();
  }

  // Append theme toggle button
  const headerRight = container.querySelector('#home-header-right');
  if (headerRight) {
    headerRight.appendChild(renderThemeToggle());
  }
}
