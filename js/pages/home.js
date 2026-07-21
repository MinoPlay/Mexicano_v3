import { Store } from '../store.js';
import { State } from '../state.js';
import { calculateAllEloRankings, getEloSnapshots, getEloForDate } from '../services/elo.js';
import { getLatestCompleteTournamentDate, getActiveTournament, confirmAttendance } from '../services/tournament.js';
import { getMembers } from '../services/members.js';
import { calculatePlayerStatistics } from '../services/statistics.js';

export function shouldShowConfirmationPopup(activeTournament, currentUser, alreadyConfirmed) {
  if (!activeTournament || activeTournament.isCompleted) return false;
  if (!currentUser) return false;
  if (alreadyConfirmed) return false;
  const players = activeTournament.players || [];
  return players.some(p => p.name.toLowerCase() === currentUser.toLowerCase());
}

export function buildConfirmationAlertMessage(playerName, tournamentDate) {
  return `🎾 ${playerName} confirmed attendance for tournament on ${tournamentDate}`;
}

function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getPrevYearMonth(yearMonth) {
  const [y, mo] = yearMonth.split('-').map(Number);
  return mo === 1
    ? `${y - 1}-12`
    : `${y}-${String(mo - 1).padStart(2, '0')}`;
}

function formatMonth(yearMonth) {
  try {
    const [y, m] = yearMonth.split('-');
    const d = new Date(parseInt(y), parseInt(m) - 1, 1);
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  } catch {
    return yearMonth;
  }
}

function overviewToStats(overview, prevOverview = []) {
  const prevEloMap = {};
  prevOverview.forEach(p => { prevEloMap[p.name] = p.elo; });

  return overview.map(p => {
    const totalMatches = p.wins + p.losses;
    const elo = p.elo ?? null;
    const prevElo = prevEloMap[p.name] ?? null;
    const eloChange = elo != null && prevElo != null
      ? Math.round((elo - prevElo) * 100) / 100
      : null;
    return {
      name: p.name,
      wins: p.wins,
      losses: p.losses,
      points: p.totalPoints,
      average: p.average,
      winRate: totalMatches > 0 ? Math.round((p.wins / totalMatches) * 100 * 100) / 100 : 0,
      elo,
      eloChange,
    };
  });
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function renderHome(container, params) {
  const _rawActive = getActiveTournament();
  // Guard: if the tournaments index already marks this date complete, don't show as active.
  // This prevents stale localStorage from showing a completed tournament before the pull clears it.
  const _index = Store.getTournamentsIndex();
  const activeTournament = (_rawActive && _index.some(e => e.date === _rawActive.tournamentDate && e.isComplete))
    ? null
    : _rawActive;
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

  // Current month stats (from cache — may be empty before lazy-fetch below)
  const currentYearMonth = getCurrentYearMonth();
  const prevYearMonth = getPrevYearMonth(currentYearMonth);
  let currentMonthStats = [];

  function resolveCurrentMonthStats() {
    const overview = Store.getMonthlyOverview(currentYearMonth);
    if (overview.length > 0) {
      const prevOverview = Store.getMonthlyOverview(prevYearMonth);
      return overviewToStats(overview, prevOverview);
    }
    // Fallback: compute from local matches
    const monthMatches = allMatches.filter(m => m.date?.startsWith(currentYearMonth));
    if (monthMatches.length > 0) {
      const stats = calculatePlayerStatistics(monthMatches);
      // Attach ELO from players.json summary
      const summary = Store.getPlayersSummary();
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
      }
      return stats;
    }
    return [];
  }

  currentMonthStats = resolveCurrentMonthStats();

  // State for sorting (Latest Tournament)
  let sortCol = 'average';
  let sortDir = 'desc';

  // State for sorting (Current Month)
  let sortCol2 = 'avg';
  let sortDir2 = 'desc';

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

  function renderCurrentMonthTable() {
    const tableContainer = container.querySelector('#current-month-table');
    if (!tableContainer || currentMonthStats.length === 0) return;

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

    const sorted = [...currentMonthStats];
    sorted.sort((a, b) => {
      let av, bv;
      if (sortCol2 === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (sortCol2 === 'wl') { av = a.wins; bv = b.wins; }
      else if (sortCol2 === 'pts') { av = a.points ?? a.totalPoints ?? 0; bv = b.points ?? b.totalPoints ?? 0; }
      else if (sortCol2 === 'avg') { av = a.average; bv = b.average; }
      else if (sortCol2 === 'win') {
        const tA = a.wins + a.losses, tB = b.wins + b.losses;
        av = tA > 0 ? a.wins / tA : 0;
        bv = tB > 0 ? b.wins / tB : 0;
      }
      else if (sortCol2 === 'elo') { av = a.elo ?? 0; bv = b.elo ?? 0; }
      else if (sortCol2 === 'change') { av = a.eloChange ?? 0; bv = b.eloChange ?? 0; }
      if (av < bv) return sortDir2 === 'asc' ? -1 : 1;
      if (av > bv) return sortDir2 === 'asc' ? 1 : -1;
      // Tiebreak: wins desc, then name asc
      if (a.wins !== b.wins) return b.wins - a.wins;
      return a.name.localeCompare(b.name);
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'data-table';
    const table = document.createElement('table');

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    cols.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label;
      if (col.key === 'rank') th.className = 'rank-cell';
      else th.className = 'num-cell';
      if (col.key === 'name') th.style.textAlign = 'left';
      if (col.sort === sortCol2) th.classList.add(sortDir2 === 'asc' ? 'sort-asc' : 'sort-desc');
      if (col.sort) {
        th.addEventListener('click', () => {
          if (sortCol2 === col.sort) {
            sortDir2 = sortDir2 === 'asc' ? 'desc' : 'asc';
          } else {
            sortCol2 = col.sort;
            sortDir2 = col.sort === 'name' ? 'asc' : 'desc';
          }
          renderCurrentMonthTable();
        });
      }
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

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

      const tdRank = document.createElement('td');
      tdRank.className = 'rank-cell';
      tdRank.textContent = rank;
      if (rank === 1) tdRank.style.color = '#f59e0b';
      else if (rank === 2) tdRank.style.color = '#94a3b8';
      else if (rank === 3) tdRank.style.color = '#d97706';
      tr.appendChild(tdRank);

      const tdName = document.createElement('td');
      tdName.className = 'name-cell';
      tdName.style.cursor = 'default';
      tdName.style.color = 'var(--text-primary)';
      tdName.textContent = stat.name;
      tr.appendChild(tdName);

      const tdWl = document.createElement('td');
      tdWl.className = 'num-cell';
      tdWl.textContent = `${stat.wins}/${totalMatches}`;
      tr.appendChild(tdWl);

      const tdPts = document.createElement('td');
      tdPts.className = 'num-cell';
      tdPts.textContent = Math.round(stat.points ?? stat.totalPoints ?? 0);
      tr.appendChild(tdPts);

      const tdAvg = document.createElement('td');
      tdAvg.className = 'num-cell';
      tdAvg.textContent = stat.average.toFixed(1);
      tr.appendChild(tdAvg);

      const tdWin = document.createElement('td');
      tdWin.className = 'num-cell';
      tdWin.textContent = winPct.toFixed(1) + '%';
      if (winPct >= 75) tdWin.style.color = 'var(--color-success)';
      else if (winPct < 35) tdWin.style.color = 'var(--color-danger)';
      else tdWin.style.color = 'var(--color-warning)';
      tr.appendChild(tdWin);

      const tdElo = document.createElement('td');
      tdElo.className = 'num-cell';
      tdElo.style.fontWeight = 'var(--font-weight-semibold)';
      tdElo.textContent = elo;
      tr.appendChild(tdElo);

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
      <h1 id="home-title" style="cursor:pointer;user-select:none;" title="Tap to clear cached data">🎾 Mexicano</h1>
      <div class="flex items-center gap-sm" id="home-header-right"></div>
    </header>
    <div class="page-content" style="padding-left:0;padding-right:0;">
      ${activeTournament ? `<a href="#/tournament/${activeTournament.tournamentDate}" class="card" style="display:block;margin:0 0 var(--space-md);border-radius:0;border-left:3px solid var(--color-success);border-right:none;text-decoration:none;color:inherit;background:none;border-top:none;border-bottom:none;">
            <div class="card-header">
              <span class="card-title">Active Tournament</span>
              <span class="badge badge-success">Live</span>
            </div>
            <div class="text-sm text-secondary">
              ${formatDate(activeTournament.tournamentDate)} · ${activeTournament.players?.length || 0} players
            </div>
          </a>` : ''}

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

      <div class="card" style="margin:0 0 var(--space-md);border-radius:0;padding:0;overflow:hidden;border-left:none;border-right:none;background:none;border-top:none;border-bottom:none;">
        <div class="card-header" style="padding:var(--space-md);">
          <span class="card-title">Current Month</span>
          <span class="text-sm text-secondary">${formatMonth(currentYearMonth)}</span>
        </div>
        <div id="current-month-table">
          ${currentMonthStats.length === 0 ? `<p id="current-month-no-data" class="text-sm text-secondary text-center" style="padding:var(--space-md);">No data for this month</p>` : ''}
        </div>
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

  // Render current month table
  if (currentMonthStats.length > 0) {
    renderCurrentMonthTable();
  }

  // Always fetch monthly overview to get correct month-over-month ELO change.
  // The fallback from local matches uses players_summary.previousElo which is
  // per-tournament, not per-month — so we must replace it once overview arrives.
  if (Store.getGitHubConfig()?.pat) {
    const noDataEl = container.querySelector('#current-month-no-data');
    if (currentMonthStats.length === 0 && noDataEl) {
      noDataEl.textContent = '⏳ Loading…';
    }
    import('../services/github.js').then(({ pullMonthlyOverview }) =>
      Promise.all([
        pullMonthlyOverview(currentYearMonth),
        pullMonthlyOverview(prevYearMonth),
      ])
    ).then(() => {
      const tableEl = container.querySelector('#current-month-table');
      if (!tableEl) return;
      const freshStats = resolveCurrentMonthStats();
      if (freshStats.length > 0) {
        currentMonthStats = freshStats;
        tableEl.innerHTML = '';
        renderCurrentMonthTable();
      } else {
        const nd = container.querySelector('#current-month-no-data');
        if (nd) nd.textContent = 'No data for this month';
      }
    }).catch(() => {
      const nd = container.querySelector('#current-month-no-data');
      if (nd && nd.isConnected && currentMonthStats.length === 0) {
        nd.textContent = 'No data for this month';
      }
    });
  }

  // Title = force-clear cached tournament data
  const titleEl = container.querySelector('#home-title');
  if (titleEl) {
    titleEl.addEventListener('click', () => {
      if (!confirm('Clear all cached tournament data and reload?')) return;
      Store.remove('matches');
      Store.remove('matches_fully_loaded');
      Store.clearActiveTournament();
      Store.remove('completion_marker');
      location.reload();
    });
  }

  // Tournament confirmation popup — once per tournament per user
  if (activeTournament) {
    const currentUser = Store.getCurrentUser();
    const confirmKey = `confirmed_tournament_${activeTournament.tournamentDate}`;
    const alreadyConfirmed = !!Store.get(confirmKey);
    if (shouldShowConfirmationPopup(activeTournament, currentUser, alreadyConfirmed) &&
        !document.getElementById('tournament-confirm-overlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'tournament-confirm-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:var(--space-md);';

      const modal = document.createElement('div');
      modal.style.cssText = 'background:var(--bg-card);border-radius:var(--radius-lg);padding:var(--space-xl);max-width:360px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.4);';

      const title = document.createElement('h2');
      title.textContent = '🎾 Active Tournament';
      title.style.cssText = 'margin:0 0 var(--space-md);font-size:var(--font-size-lg);';

      const body = document.createElement('p');
      body.textContent = `You are registered for the tournament on ${activeTournament.tournamentDate}. Please confirm your attendance.`;
      body.style.cssText = 'margin:0 0 var(--space-xl);color:var(--text-secondary);font-size:var(--font-size-sm);';

      const btn = document.createElement('button');
      btn.textContent = 'CONFIRM';
      btn.className = 'btn btn-primary';
      btn.style.cssText = 'width:100%;font-size:var(--font-size-md);';
      btn.addEventListener('click', () => {
        Store.set(confirmKey, true);
        confirmAttendance(currentUser);
        overlay.remove();
        import('../services/telegram.js').then(({ sendTournamentConfirmationAlert }) => {
          sendTournamentConfirmationAlert(currentUser, activeTournament.tournamentDate)
            .catch(err => console.warn('[telegram] confirmation alert error:', err));
        }).catch(() => {});
      });

      modal.appendChild(title);
      modal.appendChild(body);
      modal.appendChild(btn);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
    }
  }
}
