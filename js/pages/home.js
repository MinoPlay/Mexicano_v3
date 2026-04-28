import { Store } from '../store.js';
import { State } from '../state.js';
import { renderThemeToggle } from '../components/theme-toggle.js';
import { calculateAllEloRankings, getEloSnapshots, getEloForDate } from '../services/elo.js';
import { getLatestCompleteTournamentDate, getActiveTournament } from '../services/tournament.js';
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
  const activeTournament = getActiveTournament();
  const allMatches = Store.getMatches();

  // Get latest COMPLETE tournament date
  const latestDate = getLatestCompleteTournamentDate();

  // Helper: attach ELO ratings to a stats array for the latest date
  function attachEloToStats(stats) {
    const summary = Store.getPlayersSummary();
    const matches = Store.getMatches();
    if (summary.length > 0) {
      const summaryMap = {};
      for (const p of summary) summaryMap[p.name] = p;
      for (const stat of stats) {
        const p = summaryMap[stat.name];
        if (p) {
          stat.elo = p.elo;
          stat.eloChange = Math.round(((p.elo ?? 1000) - (p.previousElo ?? 1000)) * 100) / 100;
        }
      }
    } else if (matches.length > 0) {
      const { snapshots } = getEloSnapshots(matches);
      const eloMap = getEloForDate(snapshots, latestDate) || {};
      for (const stat of stats) {
        const d = eloMap[stat.name];
        if (d) { stat.elo = d.elo; stat.eloChange = d.eloChange; }
      }
    }
  }

  // Get Latest Tournament stats
  let latestTournamentStats = [];

  if (latestDate) {
    const dayMatches = allMatches.filter(m => m.date === latestDate);
    if (dayMatches.length > 0) {
      latestTournamentStats = calculatePlayerStatistics(dayMatches);
      attachEloToStats(latestTournamentStats);
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
        av = a.wins; bv = b.wins;
      } else if (sortCol === 'pts') {
        av = a.points; bv = b.points;
      } else if (sortCol === 'avg') {
        av = a.average; bv = b.average;
      } else if (sortCol === 'win') {
        const tA = a.wins + a.losses, tB = b.wins + b.losses;
        av = tA > 0 ? a.wins / tA : 0;
        bv = tB > 0 ? b.wins / tB : 0;
      } else if (sortCol === 'elo') {
        av = a.elo ?? 0; bv = b.elo ?? 0;
      } else if (sortCol === 'change') {
        av = a.eloChange ?? 0; bv = b.eloChange ?? 0;
      }

      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    const cols = [
      { key: 'rank',   label: '#',    sort: null },
      { key: 'name',   label: 'NAME', sort: 'name' },
      { key: 'wl',     label: 'W/T',  sort: 'wl' },
      { key: 'pts',    label: 'PTS',  sort: 'pts' },
      { key: 'avg',    label: 'AVG',  sort: 'avg' },
      { key: 'win',    label: 'WIN',  sort: 'win' },
      { key: 'elo',    label: 'ELO',  sort: 'elo' },
      { key: 'change', label: 'Δ',    sort: 'change' },
    ];

    const wrapper = document.createElement('div');
    wrapper.className = 'data-table';
    const table = document.createElement('table');

    // thead
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    cols.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label;
      if (col.key !== 'rank') th.className = 'num-cell';
      if (col.key === 'rank') th.className = 'rank-cell';
      if (col.key === 'name') th.style.textAlign = 'left';
      if (col.sort === sortCol) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      if (col.sort) {
        th.addEventListener('click', () => {
          if (sortCol === col.sort) {
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            sortCol = col.sort;
            sortDir = col.sort === 'name' ? 'asc' : 'desc';
          }
          renderTable();
        });
      }
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // tbody
    const tbody = document.createElement('tbody');
    sorted.forEach((stat, i) => {
      const rank = i + 1;
      const totalMatches = stat.wins + stat.losses;
      const winPct = totalMatches > 0 ? (stat.wins / totalMatches) * 100 : 0;
      const elo = stat.elo != null ? Math.round(stat.elo) : '—';
      const eloChange = stat.eloChange ?? 0;
      const changeIcon = eloChange > 0 ? '▲' : eloChange < 0 ? '▼' : '–';
      const changeText = eloChange !== 0 ? Math.abs(Math.round(eloChange * 10) / 10).toFixed(1) : '';

      const tr = document.createElement('tr');

      // Rank
      const tdRank = document.createElement('td');
      tdRank.className = 'rank-cell';
      tdRank.textContent = rank;
      if (rank === 1) tdRank.style.color = '#f59e0b';
      else if (rank === 2) tdRank.style.color = '#94a3b8';
      else if (rank === 3) tdRank.style.color = '#d97706';
      tr.appendChild(tdRank);

      // Name
      const tdName = document.createElement('td');
      tdName.className = 'name-cell';
      tdName.style.cursor = 'default';
      tdName.style.color = 'var(--text-primary)';
      tdName.textContent = stat.name;
      tr.appendChild(tdName);

      // W/T
      const tdWl = document.createElement('td');
      tdWl.className = 'num-cell';
      tdWl.textContent = `${stat.wins}/${totalMatches}`;
      tr.appendChild(tdWl);

      // PTS
      const tdPts = document.createElement('td');
      tdPts.className = 'num-cell';
      tdPts.textContent = Math.round(stat.points);
      tr.appendChild(tdPts);

      // AVG
      const tdAvg = document.createElement('td');
      tdAvg.className = 'num-cell';
      tdAvg.textContent = stat.average.toFixed(1);
      tr.appendChild(tdAvg);

      // WIN%
      const tdWin = document.createElement('td');
      tdWin.className = 'num-cell';
      tdWin.textContent = winPct.toFixed(1) + '%';
      if (winPct >= 75) tdWin.style.color = 'var(--color-success)';
      else if (winPct < 35) tdWin.style.color = 'var(--color-danger)';
      else tdWin.style.color = 'var(--color-warning)';
      tr.appendChild(tdWin);

      // ELO
      const tdElo = document.createElement('td');
      tdElo.className = 'num-cell';
      tdElo.style.fontWeight = 'var(--font-weight-semibold)';
      tdElo.textContent = elo;
      tr.appendChild(tdElo);

      // Δ ELO change
      const tdChange = document.createElement('td');
      tdChange.className = 'num-cell';
      tdChange.textContent = changeIcon + changeText;
      if (eloChange > 0) tdChange.style.color = 'var(--color-success)';
      else if (eloChange < 0) tdChange.style.color = 'var(--color-danger)';
      else tdChange.style.color = 'var(--text-tertiary)';
      tr.appendChild(tdChange);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    tableContainer.innerHTML = '';
    tableContainer.appendChild(wrapper);
  }

  container.innerHTML = `
    <header class="page-header">
      <h1>🎾 Mexicano</h1>
      <div class="flex items-center gap-sm" id="home-header-right"></div>
    </header>
    <div class="page-content" style="padding-left:0;padding-right:0;">
      ${activeTournament ? `
        <a href="#/tournament/${activeTournament.tournamentDate}" class="card" style="display:block;margin:0 0 var(--space-md);border-radius:0;border-left:3px solid var(--color-success);border-right:none;text-decoration:none;color:inherit;background:none;border-top:none;border-bottom:none;">
          <div class="card-header">
            <span class="card-title">Active Tournament</span>
            <span class="badge badge-success">Live</span>
          </div>
          <div class="text-sm text-secondary">
            ${formatDate(activeTournament.tournamentDate)} · ${activeTournament.players?.length || 0} players
          </div>
        </a>
      ` : ''}

      <div class="card" style="margin:0 0 var(--space-md);border-radius:0;padding:0;overflow:hidden;border-left:none;border-right:none;background:none;border-top:none;border-bottom:none;">
        <div class="card-header" style="padding:var(--space-md);">
          <span class="card-title">Latest Tournament</span>
          ${latestDate ? `<span class="text-sm text-secondary">${formatDate(latestDate)}</span>` : ''}
        </div>
        ${latestTournamentStats.length === 0 ? `
          <div id="latest-no-data" class="text-sm text-secondary text-center" style="padding:var(--space-md);">
            No tournament data available
          </div>
        ` : `
          <div class="latest-tournament-table" id="latest-tournament-table">
            <!-- Table rendered by renderTable() -->
          </div>
        `}
      </div>

    </div>
  `;

  // Render table after DOM is ready
  if (latestTournamentStats.length > 0) {
    renderTable();
  } else if (latestDate && Store.getGitHubConfig()?.pat) {
    // Lazy-fetch latest date's matches from GitHub (same pattern as statistics.js)
    const noDataEl = container.querySelector('#latest-no-data');
    if (noDataEl) {
      noDataEl.textContent = '⏳ Loading…';
      import('../services/github.js').then(({ ensureDayMatchesLoaded }) =>
        ensureDayMatchesLoaded(latestDate)
      ).then(fetched => {
        if (!noDataEl.isConnected) return;
        if (fetched.length > 0) {
          latestTournamentStats = calculatePlayerStatistics(fetched);
          attachEloToStats(latestTournamentStats);
          noDataEl.id = 'latest-tournament-table';
          noDataEl.className = 'latest-tournament-table';
          noDataEl.removeAttribute('style');
          noDataEl.textContent = '';
          renderTable();
        } else {
          noDataEl.textContent = 'No tournament data available';
        }
      }).catch(() => {
        if (noDataEl.isConnected) noDataEl.textContent = 'No tournament data available';
      });
    }
  }

  // Append theme toggle button
  const headerRight = container.querySelector('#home-header-right');
  if (headerRight) {
    headerRight.appendChild(renderThemeToggle());
  }
}
