import { Store } from '../store.js';
import { Cache } from '../cache.js';
import { State } from '../state.js';
import { calculateAllEloRankings, getEloSnapshots, getEloForDate } from '../services/elo.js';
import { getLatestCompleteTournamentDate, getActiveTournament, confirmAttendanceAndPush } from '../services/tournament.js';
import { getMembers } from '../services/members.js';
import { calculatePlayerStatistics } from '../services/statistics.js';
import { APP_VERSION, refreshApp } from '../version.js';
import { currentDeployId } from '../deploy-env.js';
import { renderNotificationBell } from '../components/notification-bell.js';
import { showErrorDialog } from '../components/error-dialog.js';

export function shouldShowConfirmationPopup(activeTournament, currentUser, alreadyConfirmed = false) {
  if (!activeTournament || activeTournament.isCompleted) return false;
  if (!currentUser) return false;
  if (alreadyConfirmed) return false;
  const players = activeTournament.players || [];
  const me = players.find(p => p.name.toLowerCase() === currentUser.toLowerCase());
  if (!me) return false;
  if (me.confirmed) return false;
  return true;
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
  const getHomeMatches = () => Cache.get('home_matches') || Store.getMatches();
  const getHomePlayersSummary = () =>
    Cache.get('home_players_summary') || Store.getPlayersSummary();
  const _rawActive = getActiveTournament();
  // Guard: if the tournaments index already marks this date complete, don't show as active.
  // This prevents stale localStorage from showing a completed tournament before the pull clears it.
  const _index = Store.getTournamentsIndex();
  const activeTournament = (_rawActive && _index.some(e => e.date === _rawActive.tournamentDate && e.isComplete))
    ? null
    : _rawActive;
  const allMatches = getHomeMatches();

  // Get latest COMPLETE tournament date
  const latestDate = getLatestCompleteTournamentDate();

  // Helper: attach ELO ratings to a stats array for the latest date
  function attachEloToStats(stats) {
    const summary = getHomePlayersSummary();
    const matches = getHomeMatches();
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
      const summary = getHomePlayersSummary();
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
      const nameLink = document.createElement('a');
      nameLink.href = `#/players?p=${encodeURIComponent(stat.name)}`;
      nameLink.style.color = 'var(--text-primary)';
      nameLink.textContent = stat.name;
      tdName.appendChild(nameLink);
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
      const nameLink = document.createElement('a');
      nameLink.href = `#/players?p=${encodeURIComponent(stat.name)}`;
      nameLink.style.color = 'var(--text-primary)';
      nameLink.textContent = stat.name;
      tdName.appendChild(nameLink);
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
      <h1 id="home-title" style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:var(--space-xs);" title="Tap to clear cached data">🎾 Mexicano v${APP_VERSION}${currentDeployId() ? ` · preview:${currentDeployId()}` : ''}<button id="app-refresh-btn" type="button" title="Refresh to latest version" style="background:none;border:none;padding:0;color:inherit;font:inherit;cursor:pointer;line-height:1;">↻</button></h1>
      <div class="flex items-center gap-sm" id="home-header-right"></div>
    </header>
    <div class="page-content">
      <div class="dash-grid">
        <div class="span-12 kpi-row" id="home-kpis"></div>
        ${activeTournament ? `<a href="#/tournament/${activeTournament.tournamentDate}" class="panel span-12" style="text-decoration:none;color:inherit;border-left:3px solid var(--color-success);">
            <div class="panel-header">
              <span class="panel-title">Active Tournament</span>
              <span class="badge badge-success">Live</span>
            </div>
            <div class="panel-body text-sm text-secondary">
              ${formatDate(activeTournament.tournamentDate)} · ${activeTournament.players?.length || 0} players
            </div>
          </a>` : ''}

        <div class="panel span-6">
          <div class="panel-header">
            <span class="panel-title">Latest Tournament</span>
            ${latestDate ? `<a class="text-sm" href="#/tournament/${latestDate}">${formatDate(latestDate)} →</a>` : ''}
          </div>
          <div class="panel-body flush">
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

        <div class="panel span-6">
          <div class="panel-header">
            <span class="panel-title">Current Month</span>
            <span class="text-sm text-secondary">${formatMonth(currentYearMonth)}</span>
          </div>
          <div class="panel-body flush" id="current-month-table">
            ${currentMonthStats.length === 0 ? `<p id="current-month-no-data" class="text-sm text-secondary text-center" style="padding:var(--space-md);">No data for this month</p>` : ''}
          </div>
        </div>

        <div class="panel span-6">
          <div class="panel-header">
            <span class="panel-title">ELO movers — latest tournament</span>
            <a class="text-sm" href="#/elo-charts">ELO charts →</a>
          </div>
          <div class="panel-body" id="home-movers"></div>
        </div>

        <div class="panel span-6">
          <div class="panel-header"><span class="panel-title">Explore</span></div>
          <div class="panel-body kpi-row">
            <a class="kpi" href="#/players"><div class="kpi-label">👥 Players</div><div class="kpi-sub">Full profiles, partners, nemesis</div></a>
            <a class="kpi" href="#/statistics"><div class="kpi-label">📊 Statistics</div><div class="kpi-sub">Periods &amp; pair heatmaps</div></a>
            <a class="kpi" href="#/elo-charts"><div class="kpi-label">📈 ELO</div><div class="kpi-sub">Rating history</div></a>
            <a class="kpi" href="#/tournaments"><div class="kpi-label">📋 Tournaments</div><div class="kpi-sub">All results</div></a>
          </div>
        </div>
      </div>
    </div>
  `;

  function renderMovers() {
    const el = container.querySelector('#home-movers');
    if (!el) return;
    const rows = latestTournamentStats
      .filter(s => s.eloChange != null)
      .map(s => ({ name: s.name, delta: s.eloChange, elo: s.elo }))
      .sort((a, b) => b.delta - a.delta);
    if (!rows.length) { el.innerHTML = '<p class="text-sm text-secondary">No ELO data</p>'; return; }
    const max = Math.max(...rows.map(r => Math.abs(r.delta)), 1);
    el.innerHTML = rows.map(r => `
      <div class="flex items-center gap-sm text-sm" style="margin-bottom:4px">
        <span style="width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}</span>
        <span style="flex:1;display:flex;${r.delta >= 0 ? '' : 'justify-content:flex-end;'}">
          <span style="height:10px;border-radius:3px;width:${(Math.abs(r.delta) / max) * 100}%;background:${r.delta >= 0 ? 'var(--color-success)' : 'var(--color-danger)'};opacity:.75"></span>
        </span>
        <span class="num ${r.delta > 0 ? 'pos' : r.delta < 0 ? 'neg' : 'muted'}" style="width:56px;text-align:right">${r.delta > 0 ? '+' : ''}${(Math.round(r.delta * 10) / 10).toFixed(1)}</span>
        <span class="num muted" style="width:44px;text-align:right">${r.elo != null ? Math.round(r.elo) : ''}</span>
      </div>`).join('');
  }

  function renderKpis() {
    const el = container.querySelector('#home-kpis');
    if (!el) return;
    const top = [...latestTournamentStats].sort((a, b) => b.points - a.points)[0];
    const monthTop = [...currentMonthStats].sort((a, b) => (b.average ?? 0) - (a.average ?? 0))[0];
    const monthDates = Store.getTournamentsIndex().filter(e => e.date?.startsWith(currentYearMonth)).length;
    const k = (label, value, sub = '') => `<div class="kpi"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div>${sub ? `<div class="kpi-sub">${sub}</div>` : ''}</div>`;
    el.innerHTML = [
      k('Latest winner', top ? top.name : '—', top ? `${top.points} pts · ${top.wins}/${top.wins + top.losses} wins` : ''),
      k('Players last time', latestTournamentStats.length || '—', latestDate ? formatDate(latestDate) : ''),
      k('Month leader (avg)', monthTop ? monthTop.name : '—', monthTop ? `${monthTop.average.toFixed(1)} avg` : ''),
      k('Tournaments this month', monthDates, formatMonth(currentYearMonth)),
      k('Active players this month', currentMonthStats.length || '—'),
    ].join('');
  }

  // Render table after DOM is ready
  renderKpis();
  renderMovers();
  if (latestTournamentStats.length > 0) {
    renderTable();
  } else if (latestDate && Store.getSupabaseConfig()) {
    // Lazy-fetch the latest date if route hydration has not populated it yet.
    const noDataEl = container.querySelector('#latest-no-data');
    if (noDataEl) {
      noDataEl.textContent = '⏳ Loading…';
      import('../services/backend.js').then(({ ensureDayMatchesLoaded }) =>
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
          renderKpis();
          renderMovers();
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
  if (Store.getSupabaseConfig()) {
    const noDataEl = container.querySelector('#current-month-no-data');
    if (currentMonthStats.length === 0 && noDataEl) {
      noDataEl.textContent = '⏳ Loading…';
    }
    import('../services/backend.js').then(({ pullMonthlyOverview }) =>
      Promise.all([
        pullMonthlyOverview(currentYearMonth, { route: '#/' }),
        pullMonthlyOverview(prevYearMonth, { route: '#/' }),
      ])
    ).then(() => {
      const tableEl = container.querySelector('#current-month-table');
      if (!tableEl) return;
      const freshStats = resolveCurrentMonthStats();
      if (freshStats.length > 0) {
        currentMonthStats = freshStats;
        tableEl.innerHTML = '';
        renderCurrentMonthTable();
        renderKpis();
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

  // Notification bell — anchored right, same row as the title, home-only.
  const bellSlot = container.querySelector('#home-header-right');
  if (bellSlot) {
    renderNotificationBell().then(bell => {
      if (bellSlot.isConnected) bellSlot.appendChild(bell);
    });
  }

  // Refresh icon = clear all caches and reload to latest version
  const refreshBtn = container.querySelector('#app-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      refreshBtn.disabled = true;
      await refreshApp();
    });
  }

  // Title = force-clear cached tournament data
  const titleEl = container.querySelector('#home-title');
  if (titleEl) {
    titleEl.addEventListener('click', () => {
      if (!confirm('Clear all cached tournament data and reload?')) return;
      // Domain data is in-memory only, so a reload re-pulls everything from
      // Supabase; this just drops it early for a clean re-render.
      Store.setMatches([]);
      Store.setMatchesFullyLoaded(false);
      Store.clearActiveTournament();
      location.reload();
    });
  }

  // Tournament confirmation popup — driven by the confirmed flag pulled from
  // Supabase, so it follows the player across devices.
  if (activeTournament) {
    const currentUser = Store.getCurrentUser();
    if (shouldShowConfirmationPopup(activeTournament, currentUser) &&
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
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'CONFIRMING…';
        body.textContent = 'Sending your confirmation…';
        let result;
        try {
          // Dispatches to the data-repo confirm-attendance workflow, which
          // performs the actual day-file update BEFORE we alert.
          result = await confirmAttendanceAndPush(currentUser);
        } catch (err) {
          console.warn('[attendance] confirm dispatch failed:', err);
          btn.disabled = false;
          btn.textContent = 'CONFIRM';
          body.textContent = `You are registered for the tournament on ${activeTournament.tournamentDate}. Please confirm your attendance.`;
          showErrorDialog('Confirmation failed', err?.message || 'Could not send your confirmation — check your connection and tap CONFIRM to retry.');
          return;
        }
        if (!result.changed) { overlay.remove(); return; }
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
