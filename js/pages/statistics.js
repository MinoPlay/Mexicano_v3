import { calculatePlayerStatistics, calculateOpponentStats, calculatePartnershipStats, generatePlayerSummary } from '../services/statistics.js';
import { calculateAllEloRankings } from '../services/elo.js';
import { Store } from '../store.js';

// ─── Helpers ───

function getUniqueDates(matches) {
  const dates = [...new Set(matches.map(m => m.date))];
  dates.sort();
  return dates;
}

function filterByDate(matches, date) {
  return matches.filter(m => m.date === date);
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
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

// ─── Column definitions ───

const FULL_COLUMNS = [
  { key: 'rank', label: '#', cls: 'rank-cell' },
  { key: 'name', label: 'Name', cls: 'name-cell' },
  { key: 'wins', label: 'W', cls: 'num-cell' },
  { key: 'losses', label: 'L', cls: 'num-cell' },
  { key: 'points', label: 'Pts', cls: 'num-cell' },
  { key: 'average', label: 'Avg', cls: 'num-cell' },
  { key: 'winRate', label: 'Win%', cls: 'num-cell' },
  { key: 'tightWins', label: 'TW', cls: 'num-cell' },
  { key: 'solidWins', label: 'SW', cls: 'num-cell' },
  { key: 'dominatingWins', label: 'DW', cls: 'num-cell' },
];

const OVERVIEW_COLUMNS = [
  { key: 'rank', label: '#', cls: 'rank-cell' },
  { key: 'name', label: 'Name', cls: 'name-cell' },
  { key: 'wins', label: 'W', cls: 'num-cell' },
  { key: 'losses', label: 'L', cls: 'num-cell' },
  { key: 'points', label: 'Pts', cls: 'num-cell' },
  { key: 'average', label: 'Avg', cls: 'num-cell' },
  { key: 'winRate', label: 'Win%', cls: 'num-cell' },
];

const LATEST_COLUMNS = [
  { key: 'rank', label: '#', cls: 'rank-cell' },
  { key: 'name', label: 'Name', cls: 'name-cell' },
  { key: 'wins', label: 'W', cls: 'num-cell' },
  { key: 'losses', label: 'L', cls: 'num-cell' },
  { key: 'average', label: 'Avg', cls: 'num-cell' },
  { key: 'winRate', label: 'Win%', cls: 'num-cell' },
  { key: 'elo', label: 'ELO', cls: 'num-cell' },
  { key: 'eloChange', label: '±ELO', cls: 'num-cell' },
];

// ─── Aggregate monthly overviews into all-time stats ───

function aggregateOverviews() {
  const months = Store.getMonthlyOverviewMonths();
  const playerMap = {};

  for (const m of months) {
    const overview = Store.getMonthlyOverview(m);
    for (const p of overview) {
      if (!playerMap[p.name]) {
        playerMap[p.name] = { name: p.name, wins: 0, losses: 0, points: 0 };
      }
      playerMap[p.name].wins += p.wins;
      playerMap[p.name].losses += p.losses;
      playerMap[p.name].points += p.totalPoints;
    }
  }

  const stats = Object.values(playerMap).map(p => {
    const totalMatches = p.wins + p.losses;
    return {
      rank: 0,
      name: p.name,
      wins: p.wins,
      losses: p.losses,
      points: p.points,
      average: totalMatches > 0 ? Math.round((p.points / totalMatches) * 100) / 100 : 0,
      winRate: totalMatches > 0 ? Math.round((p.wins / totalMatches) * 100 * 100) / 100 : 0,
      change: 0,
      tightWins: 0,
      solidWins: 0,
      dominatingWins: 0,
    };
  });

  stats.sort((a, b) => {
    if (b.average !== a.average) return b.average - a.average;
    return b.winRate - a.winRate;
  });

  let currentRank = 1;
  for (let i = 0; i < stats.length; i++) {
    if (i > 0 && stats[i].average === stats[i - 1].average && stats[i].winRate === stats[i - 1].winRate) {
      stats[i].rank = stats[i - 1].rank;
    } else {
      currentRank = i + 1;
      stats[i].rank = currentRank;
    }
  }

  return stats;
}

// ─── Convert monthly overview to stats rows ───

function overviewToStats(overview) {
  const stats = overview.map(p => {
    const totalMatches = p.wins + p.losses;
    return {
      rank: 0,
      name: p.name,
      wins: p.wins,
      losses: p.losses,
      points: p.totalPoints,
      average: p.average,
      winRate: totalMatches > 0 ? Math.round((p.wins / totalMatches) * 100 * 100) / 100 : 0,
      change: 0,
      tightWins: 0,
      solidWins: 0,
      dominatingWins: 0,
    };
  });

  stats.sort((a, b) => {
    if (b.average !== a.average) return b.average - a.average;
    return b.winRate - a.winRate;
  });

  let currentRank = 1;
  for (let i = 0; i < stats.length; i++) {
    if (i > 0 && stats[i].average === stats[i - 1].average && stats[i].winRate === stats[i - 1].winRate) {
      stats[i].rank = stats[i - 1].rank;
    } else {
      currentRank = i + 1;
      stats[i].rank = currentRank;
    }
  }

  return stats;
}

// ─── Sortable Table Renderer ───

function renderSortableTable(container, stats, onPlayerClick, columns = FULL_COLUMNS, defaultSort = 'points') {
  let sortCol = defaultSort;
  let sortDir = 'desc';

  function sortedData() {
    const rows = stats.map((s, i) => ({ ...s, rank: i + 1 }));
    rows.sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    rows.forEach((r, i) => r.rank = i + 1);
    return rows;
  }

  function render() {
    const rows = sortedData();
    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'data-table';
    const table = document.createElement('table');

    // thead
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label;
      th.className = col.cls || '';
      if (col.key === sortCol) {
        th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      }
      if (col.key !== 'rank') {
        th.addEventListener('click', () => {
          if (sortCol === col.key) {
            sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            sortCol = col.key;
            sortDir = col.key === 'name' ? 'asc' : 'desc';
          }
          render();
        });
      }
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // tbody
    const tbody = document.createElement('tbody');
    rows.forEach(row => {
      const tr = document.createElement('tr');
      columns.forEach(col => {
        const td = document.createElement('td');
        td.className = col.cls || '';
        if (col.key === 'winRate') {
          td.textContent = row[col.key].toFixed(1) + '%';
        } else if (col.key === 'average') {
          td.textContent = typeof row[col.key] === 'number' ? row[col.key].toFixed(1) : row[col.key];
        } else if (col.key === 'elo') {
          td.textContent = Math.round(row[col.key] ?? 0);
        } else if (col.key === 'eloChange') {
          const val = row[col.key] ?? 0;
          const rounded = Math.round(val * 10) / 10;
          td.textContent = (rounded > 0 ? '+' : '') + rounded.toFixed(1);
          td.style.color = rounded > 0 ? 'var(--color-success, #22c55e)' : rounded < 0 ? 'var(--color-danger, #ef4444)' : '';
        } else {
          td.textContent = row[col.key] ?? '';
        }
        if (col.key === 'name' && onPlayerClick) {
          td.addEventListener('click', () => onPlayerClick(row.name));
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    container.appendChild(wrapper);
  }

  render();
}

// ─── Player Profile Dialog ───

function showPlayerProfile(playerName) {
  const allProfileMatches = Store.getMatches();
  const summary = generatePlayerSummary(playerName, allProfileMatches);
  const opponents = calculateOpponentStats(playerName, allProfileMatches);
  const partners = calculatePartnershipStats(playerName, allProfileMatches);

  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay active';

  const dialog = document.createElement('div');
  dialog.className = 'dialog';

  // Header
  const header = document.createElement('div');
  header.className = 'dialog-header';
  header.innerHTML = `
    <h2 style="font-size:var(--font-size-lg);font-weight:var(--font-weight-semibold)">${playerName}</h2>
    <button class="btn btn-ghost btn-sm dialog-close">✕</button>
  `;
  dialog.appendChild(header);

  // Tabs
  const tabsEl = document.createElement('div');
  tabsEl.className = 'tabs';
  const tabItems = ['Overview', 'Head-to-Head', 'Partners'];
  let activeTab = 'Overview';

  function renderTabs() {
    tabsEl.innerHTML = '';
    tabItems.forEach(name => {
      const t = document.createElement('button');
      t.className = 'tab' + (activeTab === name ? ' active' : '');
      t.textContent = name;
      t.addEventListener('click', () => { activeTab = name; renderTabs(); renderBody(); });
      tabsEl.appendChild(t);
    });
  }

  dialog.appendChild(tabsEl);

  // Body
  const body = document.createElement('div');
  body.className = 'dialog-body';
  dialog.appendChild(body);

  function renderBody() {
    body.innerHTML = '';
    if (activeTab === 'Overview') {
      renderOverview(body, summary);
    } else if (activeTab === 'Head-to-Head') {
      renderH2H(body, opponents);
    } else {
      renderPartners(body, partners);
    }
  }

  function renderOverview(el, s) {
    if (!s) { el.innerHTML = '<p class="text-secondary">No data</p>'; return; }
    const grid = document.createElement('div');
    grid.className = 'home-quick-stats';
    const totalGames = s.totalWins + s.totalLosses;
    const winRate = totalGames > 0 ? s.totalWins / totalGames : 0;
    const avgPoints = totalGames > 0 ? s.totalPoints / totalGames : 0;
    const stats = [
      { label: 'Tournaments', value: s.totalTournaments },
      { label: 'Total Games', value: totalGames },
      { label: 'Wins', value: s.totalWins },
      { label: 'Losses', value: s.totalLosses },
      { label: 'Win Rate', value: (winRate * 100).toFixed(1) + '%' },
      { label: 'Avg Points', value: avgPoints.toFixed(1) },
      { label: 'Tight Wins', value: s.tightWins ?? 0 },
      { label: 'Solid Wins', value: s.solidWins ?? 0 },
      { label: 'Dominant Wins', value: s.dominatingWins ?? 0 },
      { label: 'Total Points', value: s.totalPoints ?? 0 },
    ];
    stats.forEach(({ label, value }) => {
      const card = document.createElement('div');
      card.className = 'quick-stat-card';
      card.innerHTML = `<div class="stat-value">${value}</div><div class="stat-label">${label}</div>`;
      grid.appendChild(card);
    });
    el.appendChild(grid);
  }

  function renderH2H(el, opps) {
    if (!opps || opps.length === 0) { el.innerHTML = '<p class="text-secondary">No data</p>'; return; }
    const wrapper = document.createElement('div');
    wrapper.className = 'data-table';
    const t = document.createElement('table');
    t.innerHTML = `<thead><tr>
      <th>Opponent</th><th class="num-cell">Games</th><th class="num-cell">W</th>
      <th class="num-cell">L</th><th class="num-cell">Win%</th>
    </tr></thead>`;
    const tb = document.createElement('tbody');
    opps.forEach(o => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="name-cell">${o.opponentName}</td>
        <td class="num-cell">${o.gamesPlayed}</td>
        <td class="num-cell">${o.wins}</td>
        <td class="num-cell">${o.losses}</td>
        <td class="num-cell">${(o.winRate ?? 0).toFixed(1)}%</td>`;
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrapper.appendChild(t);
    el.appendChild(wrapper);
  }

  function renderPartners(el, parts) {
    if (!parts || parts.length === 0) { el.innerHTML = '<p class="text-secondary">No data</p>'; return; }
    const wrapper = document.createElement('div');
    wrapper.className = 'data-table';
    const t = document.createElement('table');
    t.innerHTML = `<thead><tr>
      <th>Partner</th><th class="num-cell">Games</th><th class="num-cell">W</th>
      <th class="num-cell">L</th><th class="num-cell">Avg Pts</th>
    </tr></thead>`;
    const tb = document.createElement('tbody');
    parts.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="name-cell">${p.partnerName}</td>
        <td class="num-cell">${p.gamesPlayed}</td>
        <td class="num-cell">${p.wins}</td>
        <td class="num-cell">${p.losses}</td>
        <td class="num-cell">${(p.averagePointsPerGame ?? 0).toFixed(1)}</td>`;
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrapper.appendChild(t);
    el.appendChild(wrapper);
  }

  // Close handlers
  header.querySelector('.dialog-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  renderTabs();
  renderBody();

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// ─── Main Render ───

export function renderStatistics(container, params = {}) {
  container.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = '<h1>Statistics</h1>';
  container.appendChild(header);

  const content = document.createElement('div');
  content.className = 'page-content';
  container.appendChild(content);

  const allMatches = Store.getMatches();
  const overviewMonths = Store.getMonthlyOverviewMonths();
  const hasSummaryData = overviewMonths.length > 0;
  const tournamentDates = hasSummaryData
    ? [...Store.getTournamentDates()].sort()
    : getUniqueDates(allMatches);

  if (!allMatches.length && !hasSummaryData) {
    content.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📊</div>
      <div class="empty-state-text">No statistics yet</div>
      <p class="text-secondary text-sm">Play some tournaments to see stats</p>
    </div>`;
    return;
  }

  const dates = tournamentDates;
  const latestDate = dates.length > 0 ? dates[dates.length - 1] : null;

  let activeFilter = 'latest';

  // Filter bar
  const filterBar = document.createElement('div');
  filterBar.className = 'stats-filter-bar';
  content.appendChild(filterBar);

  // Table container
  const tableContainer = document.createElement('div');
  tableContainer.className = 'mt-md';
  content.appendChild(tableContainer);

  function renderFilterBar() {
    filterBar.innerHTML = '';

    const filters = [
      { id: 'all', label: 'All Time' },
      { id: 'latest', label: 'Latest' },
    ];

    filters.forEach(f => {
      const chip = document.createElement('button');
      chip.className = 'chip' + (activeFilter === f.id ? ' selected' : '');
      chip.textContent = f.label;
      chip.addEventListener('click', () => { activeFilter = f.id; renderFilterBar(); renderTable(); });
      filterBar.appendChild(chip);
    });

    // Month picker (from overviews)
    if (overviewMonths.length > 1) {
      const monthSelect = document.createElement('select');
      monthSelect.style.cssText = 'width:auto;min-width:120px;padding:var(--space-xs) var(--space-sm);font-size:var(--font-size-sm);border-radius:var(--radius-full);';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'Pick month…';
      defaultOpt.disabled = true;
      defaultOpt.selected = !/^\d{4}-\d{2}$/.test(activeFilter);
      monthSelect.appendChild(defaultOpt);
      [...overviewMonths].reverse().forEach(ym => {
        const opt = document.createElement('option');
        opt.value = ym;
        opt.textContent = formatMonth(ym);
        if (activeFilter === ym) opt.selected = true;
        monthSelect.appendChild(opt);
      });
      monthSelect.addEventListener('change', () => { activeFilter = monthSelect.value; renderFilterBar(); renderTable(); });
      filterBar.appendChild(monthSelect);
    }

    // Per-tournament date selector
    if (dates.length > 1) {
      const select = document.createElement('select');
      select.style.cssText = 'width:auto;min-width:120px;padding:var(--space-xs) var(--space-sm);font-size:var(--font-size-sm);border-radius:var(--radius-full);';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'Pick date…';
      defaultOpt.disabled = true;
      defaultOpt.selected = !dates.includes(activeFilter);
      select.appendChild(defaultOpt);
      [...dates].reverse().forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = formatDate(d);
        if (activeFilter === d) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener('change', () => { activeFilter = select.value; renderFilterBar(); renderTable(); });
      filterBar.appendChild(select);
    }
  }

  function renderTable() {
    // "All Time" — prefer aggregated overviews
    if (activeFilter === 'all') {
      if (hasSummaryData) {
        const stats = aggregateOverviews();
        tableContainer.innerHTML = '';
        if (!stats.length) {
          tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data for this filter</p>';
          return;
        }
        renderSortableTable(tableContainer, stats, null, OVERVIEW_COLUMNS);
      } else {
        const stats = calculatePlayerStatistics(allMatches);
        tableContainer.innerHTML = '';
        if (!stats.length) {
          tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data for this filter</p>';
          return;
        }
        renderSortableTable(tableContainer, stats, name => showPlayerProfile(name));
      }
      return;
    }

    // Monthly overview
    if (/^\d{4}-\d{2}$/.test(activeFilter)) {
      const overview = Store.getMonthlyOverview(activeFilter);
      const stats = overviewToStats(overview);
      tableContainer.innerHTML = '';
      if (!stats.length) {
        tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data for this month</p>';
        return;
      }
      renderSortableTable(tableContainer, stats, null, OVERVIEW_COLUMNS);
      return;
    }

    // Per-date: "latest" or specific date — load on demand
    const targetDate = activeFilter === 'latest' ? latestDate : activeFilter;
    if (!targetDate) {
      tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data available</p>';
      return;
    }

    const isLatest = activeFilter === 'latest';

    // Check locally cached matches first
    let dayMatches = allMatches.filter(m => m.date === targetDate);
    if (dayMatches.length > 0) {
      renderDayStats(dayMatches, { withElo: isLatest });
      return;
    }

    // Try loading from GitHub
    if (Store.getGitHubConfig()?.pat) {
      tableContainer.innerHTML = '<p class="text-center mt-lg">⏳ Loading…</p>';
      import('../services/github.js').then(({ ensureDayMatchesLoaded }) =>
        ensureDayMatchesLoaded(targetDate)
      ).then(matches => {
        if (matches.length > 0) {
          renderDayStats(matches, { withElo: isLatest });
        } else {
          tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data for this date</p>';
        }
      }).catch(() => {
        tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">Failed to load data</p>';
      });
    } else {
      tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data for this filter</p>';
    }
  }

  function renderDayStats(matches, { withElo = false } = {}) {
    const stats = calculatePlayerStatistics(matches);
    tableContainer.innerHTML = '';
    if (!stats.length) {
      tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data for this filter</p>';
      return;
    }
    if (withElo) {
      const freshMatches = Store.getMatches();
      const { rankings } = calculateAllEloRankings(freshMatches.length > 0 ? freshMatches : matches);
      const eloMap = {};
      rankings.forEach(r => { eloMap[r.name] = r; });
      for (const stat of stats) {
        const eloData = eloMap[stat.name];
        stat.elo = eloData ? eloData.elo : 1000;
        stat.eloChange = eloData ? eloData.change : 0;
      }
      renderSortableTable(tableContainer, stats, name => showPlayerProfile(name), LATEST_COLUMNS, 'elo');
    } else {
      renderSortableTable(tableContainer, stats, name => showPlayerProfile(name));
    }
  }

  renderFilterBar();
  renderTable();
}
