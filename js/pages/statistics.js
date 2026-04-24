import { calculatePlayerStatistics } from '../services/statistics.js';
import { calculateAllEloRankings, getEloSnapshots, getEloForDate, getEloForMonth } from '../services/elo.js';
import { Store } from '../store.js';

// ─── Text measurement helper for column auto-fit ───
let _measureCanvas;
function measureTextWidth(text, font) {
  if (!_measureCanvas) _measureCanvas = document.createElement('canvas');
  const ctx = _measureCanvas.getContext('2d');
  ctx.font = font;
  return ctx.measureText(String(text ?? '')).width;
}

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

function truncateName(name, maxLength = 15) {
  if (name.length > maxLength) {
    return name.substring(0, maxLength) + '...';
  }
  return name;
}

// ─── Column definitions ───

const STAT_COLUMNS = [
  { key: 'rank',      label: '#',    cls: 'rank-cell' },
  { key: 'name',      label: 'NAME', cls: 'name-cell' },
  { key: 'wl',        label: 'W/T',  cls: 'num-cell' },
  { key: 'points',    label: 'PTS',  cls: 'num-cell' },
  { key: 'average',   label: 'AVG',  cls: 'num-cell' },
  { key: 'winRate',   label: 'WIN',  cls: 'num-cell' },
  { key: 'elo',       label: 'ELO',  cls: 'num-cell' },
  { key: 'eloChange', label: 'WLO',  cls: 'num-cell' },
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
      wl: totalMatches,
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

function overviewToStats(overview, prevOverview = []) {
  // Build a map of previous month's ELO per player
  const prevEloMap = {};
  prevOverview.forEach(p => { prevEloMap[p.name] = p.elo; });

  const stats = overview.map(p => {
    const totalMatches = p.wins + p.losses;
    const elo = p.elo ?? null;
    const prevElo = prevEloMap[p.name] ?? null;
    const eloChange = elo != null && prevElo != null
      ? Math.round((elo - prevElo) * 100) / 100
      : null;
    return {
      rank: 0,
      name: p.name,
      wins: p.wins,
      losses: p.losses,
      points: p.totalPoints,
      wl: totalMatches,
      average: p.average,
      winRate: totalMatches > 0 ? Math.round((p.wins / totalMatches) * 100 * 100) / 100 : 0,
      elo,
      eloChange,
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

function renderSortableTable(container, stats, onPlayerClick, columns = STAT_COLUMNS, defaultSort = 'elo') {
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

    // colgroup for resize
    const colgroup = document.createElement('colgroup');
    const colEls = columns.map(() => {
      const col = document.createElement('col');
      colgroup.appendChild(col);
      return col;
    });
    table.appendChild(colgroup);

    // thead
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    columns.forEach((col, colIdx) => {
      const th = document.createElement('th');
      th.textContent = col.label;
      th.className = col.cls || '';
      th.style.position = 'relative';
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

      // Resize handle
      const handle = document.createElement('div');
      handle.className = 'col-resize-handle';
      handle.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        // Auto-fit: measure all cells in this column
        const thStyle = getComputedStyle(th);
        const thFont = `${thStyle.fontWeight} ${thStyle.fontSize} ${thStyle.fontFamily}`;
        const firstTd = tbody.querySelector('tr td:nth-child(' + (colIdx + 1) + ')');
        const tdFont = firstTd ? (() => { const s = getComputedStyle(firstTd); return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`; })() : thFont;

        let maxW = measureTextWidth(th.childNodes[0]?.textContent || col.label, thFont) + 14;
        tbody.querySelectorAll('tr').forEach(tr => {
          const td = tr.children[colIdx];
          if (td) {
            const w = measureTextWidth(td.textContent, tdFont) + 10;
            if (w > maxW) maxW = w;
          }
        });
        colEls[colIdx].style.width = Math.ceil(maxW) + 'px';
      });
      handle.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const startX = e.clientX;
        const startW = colEls[colIdx].offsetWidth || th.offsetWidth;
        function onMove(e) {
          const newW = Math.max(18, startW + e.clientX - startX);
          colEls[colIdx].style.width = newW + 'px';
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      th.appendChild(handle);

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
        
        if (col.key === 'rank') {
          const rank = row[col.key];
          td.textContent = rank;
          if (rank === 1) td.classList.add('rank-class-gold');
          else if (rank === 2) td.classList.add('rank-class-silver');
          else if (rank === 3) td.classList.add('rank-class-bronze');
        } else if (col.key === 'name') {
          td.textContent = row[col.key];
          if (onPlayerClick) {
            td.style.cursor = 'pointer';
            td.addEventListener('click', () => onPlayerClick(row.name));
          }
        } else if (col.key === 'wl') {
          td.textContent = `${row.wins}/${row[col.key]}`;
        } else if (col.key === 'points') {
          td.textContent = Math.round(row[col.key]);
        } else if (col.key === 'average') {
          td.textContent = typeof row[col.key] === 'number' ? row[col.key].toFixed(1) : row[col.key];
        } else if (col.key === 'winRate') {
          const winRate = row[col.key];
          td.textContent = winRate.toFixed(1) + '%';
          if (winRate >= 75) td.classList.add('win-excellent');
          else if (winRate < 35) td.classList.add('win-poor');
          else td.classList.add('win-moderate');
        } else if (col.key === 'elo') {
          td.textContent = row[col.key] == null ? '—' : Math.round(row[col.key]);
        } else if (col.key === 'eloChange') {
          if (row[col.key] == null) {
            td.textContent = '—';
          } else {
            const val = row[col.key];
            const rounded = Math.round(val * 10) / 10;
            const changeIcon = rounded > 0 ? '▲' : rounded < 0 ? '▼' : '–';
            const changeText = rounded !== 0 ? Math.abs(rounded).toFixed(1) : '';
            td.textContent = changeIcon + changeText;
            if (rounded > 0) td.style.color = 'var(--color-success, #22c55e)';
            else if (rounded < 0) td.style.color = 'var(--color-danger, #ef4444)';
          }
        } else {
          td.textContent = row[col.key] ?? '';
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
  let summaryData = null;

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
    if (!summaryData) return;
    if (activeTab === 'Overview') {
      renderOverview(body, summaryData);
    } else if (activeTab === 'Head-to-Head') {
      renderH2H(body, summaryData.opponents);
    } else {
      renderPartners(body, summaryData.partners);
    }
  }

  function renderOverview(el, s) {
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
      { label: '🥇 1st Place', value: s.firstPlaceFinishes ?? 0 },
      { label: '🥈 2nd Place', value: s.secondPlaceFinishes ?? 0 },
      { label: '🥉 3rd Place', value: s.thirdPlaceFinishes ?? 0 },
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
    const sorted = [...opps].sort((a, b) => b.gamesPlayed - a.gamesPlayed);
    const wrapper = document.createElement('div');
    wrapper.className = 'data-table';
    const t = document.createElement('table');
    t.innerHTML = `<thead><tr>
      <th>Opponent</th><th class="num-cell">Games</th><th class="num-cell">W</th>
      <th class="num-cell">L</th><th class="num-cell">Win%</th>
    </tr></thead>`;
    const tb = document.createElement('tbody');
    sorted.forEach(o => {
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
    const sorted = [...parts].sort((a, b) => b.gamesPlayed - a.gamesPlayed);
    const wrapper = document.createElement('div');
    wrapper.className = 'data-table';
    const t = document.createElement('table');
    t.innerHTML = `<thead><tr>
      <th>Partner</th><th class="num-cell">Games</th><th class="num-cell">W</th>
      <th class="num-cell">L</th><th class="num-cell">Avg Pts</th>
    </tr></thead>`;
    const tb = document.createElement('tbody');
    sorted.forEach(p => {
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

  // Show spinner immediately, then fetch summary
  renderTabs();
  body.innerHTML = '<p class="text-center mt-lg">⏳ Loading…</p>';

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  import('../services/github.js').then(({ readPlayerSummary }) =>
    readPlayerSummary(playerName)
  ).then(data => {
    if (data) {
      summaryData = data;
      renderBody();
    } else {
      const hasGitHub = !!Store.getGitHubConfig()?.pat;
      body.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📊</div>
          <div class="empty-state-text">No summary data</div>
          ${hasGitHub
            ? '<p class="text-secondary text-sm">Go to <strong>Settings → Generate Summaries</strong> to build player statistics.</p>'
            : '<p class="text-secondary text-sm">Connect a GitHub backend in Settings, then generate player summaries.</p>'
          }
        </div>`;
    }
  }).catch(() => {
    body.innerHTML = '<p class="text-secondary text-center mt-lg">Failed to load summary.</p>';
  });
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
  content.style.paddingLeft = '0';
  content.style.paddingRight = '0';
  container.appendChild(content);

  const allMatches = Store.getMatches();
  const overviewMonths = Store.getMonthlyOverviewMonths();
  const hasSummaryData = overviewMonths.length > 0;
  const storedDates = Store.getTournamentDates();
  const tournamentDates = storedDates.length > 0 ? [...storedDates].sort() : getUniqueDates(allMatches);

  // Derive months from local match dates when no overview months synced
  const localMonths = !hasSummaryData
    ? [...new Set(allMatches.map(m => m.date?.slice(0, 7)).filter(Boolean))].sort()
    : [];
  // Prefer all months derived from tournament_dates so the dropdown always shows
  // every available month even before their overviews are fetched from GitHub.
  const allTournamentMonths = [...new Set(tournamentDates.map(d => d.slice(0, 7)))].sort();
  const availableMonths = allTournamentMonths.length > 0
    ? allTournamentMonths
    : overviewMonths.length > 0 ? overviewMonths : localMonths;

  if (!allMatches.length && !hasSummaryData && tournamentDates.length === 0) {
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
  filterBar.style.padding = '0 var(--space-md) var(--space-xs)';
  content.appendChild(filterBar);

  // Table container
  const tableContainer = document.createElement('div');
  tableContainer.className = 'mt-md';
  tableContainer.style.padding = '0 2px';
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

    // Month picker (from overviews or local match dates)
    if (availableMonths.length > 1) {
      const monthSelect = document.createElement('select');
      monthSelect.style.cssText = 'flex:1;min-width:0;padding:var(--space-xs) var(--space-sm);font-size:var(--font-size-xs);border-radius:var(--radius-full);';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'Pick month…';
      defaultOpt.disabled = true;
      defaultOpt.selected = !/^\d{4}-\d{2}$/.test(activeFilter);
      monthSelect.appendChild(defaultOpt);
      [...availableMonths].reverse().forEach(ym => {
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
      select.style.cssText = 'flex:1;min-width:0;padding:var(--space-xs) var(--space-sm);font-size:var(--font-size-xs);border-radius:var(--radius-full);';
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

  function attachEloFromSummary(stats, mode) {
    const summary = Store.getPlayersSummary();
    if (summary.length === 0) return;
    const summaryMap = {};
    for (const p of summary) summaryMap[p.name] = p;
    for (const stat of stats) {
      const p = summaryMap[stat.name];
      if (!p) continue;
      stat.elo = p.elo;
      if (mode === 'alltime') {
        stat.eloChange = Math.round((p.elo - 1000) * 100) / 100;
      } else {
        stat.eloChange = Math.round(((p.elo ?? 1000) - (p.previousElo ?? 1000)) * 100) / 100;
      }
    }
  }

  function attachEloFromSnapshots(stats, eloMap) {
    for (const stat of stats) {
      const data = eloMap[stat.name];
      if (data) {
        stat.elo = data.elo;
        stat.eloChange = data.eloChange;
      } else {
        stat.elo = null;
        stat.eloChange = null;
      }
    }
  }

  async function renderTable() {
    // "All Time" — use players_summary (players.json) if it has win/loss data
    if (activeFilter === 'all') {
      const summary = Store.getPlayersSummary();
      if (summary.length > 0 && summary[0].wins != null) {
        const stats = summary.map((p, i) => {
          const totalMatches = (p.wins || 0) + (p.losses || 0);
          return {
            rank: i + 1,
            name: p.name,
            wins: p.wins || 0,
            losses: p.losses || 0,
            points: p.points || 0,
            wl: totalMatches,
            average: p.average || 0,
            winRate: totalMatches > 0 ? Math.round((p.wins / totalMatches) * 100 * 100) / 100 : 0,
            elo: p.elo,
            eloChange: Math.round(((p.elo ?? 1000) - 1000) * 100) / 100,
            change: 0,
            tightWins: 0,
            solidWins: 0,
            dominatingWins: 0,
          };
        });
        tableContainer.innerHTML = '';
        if (!stats.length) {
          tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data for this filter</p>';
          return;
        }
        renderSortableTable(tableContainer, stats, name => showPlayerProfile(name));
        return;
      }
      // Fall back to aggregated monthly overviews (already cached locally, no fetch)
      const freshOverviewMonths = Store.getMonthlyOverviewMonths();
      if (freshOverviewMonths.length > 0) {
        const stats = aggregateOverviews();
        tableContainer.innerHTML = '';
        if (!stats.length) {
          tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data for this filter</p>';
          return;
        }
        attachEloFromSummary(stats, 'alltime');
        renderSortableTable(tableContainer, stats, null);
      } else {
        const stats = calculatePlayerStatistics(allMatches);
        tableContainer.innerHTML = '';
        if (!stats.length) {
          tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data for this filter</p>';
          return;
        }
        const { rankings } = calculateAllEloRankings(allMatches);
        const eloMap = {};
        rankings.forEach(r => {
          eloMap[r.name] = { elo: r.elo, eloChange: Math.round((r.elo - 1000) * 100) / 100 };
        });
        attachEloFromSnapshots(stats, eloMap);
        renderSortableTable(tableContainer, stats, name => showPlayerProfile(name));
      }
      return;
    }

    // Monthly overview — lazy-fetch this month if needed
    if (/^\d{4}-\d{2}$/.test(activeFilter)) {
      if (Store.getGitHubConfig()?.pat) {
        tableContainer.innerHTML = '<p class="text-center mt-lg">⏳ Loading…</p>';
        try {
          const { pullMonthlyOverview } = await import('../services/github.js');
          await pullMonthlyOverview(activeFilter);
        } catch { /* continue with cached data */ }
      }
      const overview = Store.getMonthlyOverview(activeFilter);
      let stats;
      if (overview.length > 0) {
        // Derive previous month string for ELO delta
        const [y, mo] = activeFilter.split('-').map(Number);
        const prevMonth = mo === 1
          ? `${y - 1}-12`
          : `${y}-${String(mo - 1).padStart(2, '0')}`;
        const prevOverview = Store.getMonthlyOverview(prevMonth);
        stats = overviewToStats(overview, prevOverview);
      } else {
        // Fall back to computing stats from local matches for this month
        const monthMatches = allMatches.filter(m => m.date?.startsWith(activeFilter));
        stats = calculatePlayerStatistics(monthMatches);
        // Attach ELO from snapshots for the fallback path
        const availableMatches = Store.getMatches();
        if (availableMatches.length > 0) {
          const { snapshots } = getEloSnapshots(availableMatches);
          const eloMap = getEloForMonth(snapshots, activeFilter);
          attachEloFromSnapshots(stats, eloMap);
        }
      }
      tableContainer.innerHTML = '';
      if (!stats.length) {
        tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data for this month</p>';
        return;
      }
      renderSortableTable(tableContainer, stats, name => showPlayerProfile(name));
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
      renderDayStats(dayMatches, targetDate, isLatest);
      return;
    }

    // Try loading from GitHub
    if (Store.getGitHubConfig()?.pat) {
      tableContainer.innerHTML = '<p class="text-center mt-lg">⏳ Loading…</p>';
      import('../services/github.js').then(({ ensureDayMatchesLoaded }) =>
        ensureDayMatchesLoaded(targetDate)
      ).then(matches => {
        if (matches.length > 0) {
          renderDayStats(matches, targetDate, isLatest);
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

  function renderDayStats(matches, targetDate, isLatest) {
    const stats = calculatePlayerStatistics(matches);
    tableContainer.innerHTML = '';
    if (!stats.length) {
      tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data for this filter</p>';
      return;
    }

    if (isLatest) {
      // Use stored ELO/previousElo from players_summary
      attachEloFromSummary(stats, 'latest');
    }

    // For non-latest dates (or if summary didn't have data), compute from matches
    const needsElo = stats.some(s => s.elo == null);
    if (needsElo) {
      const freshMatches = Store.getMatches();
      if (freshMatches.length > 0) {
        const { snapshots } = getEloSnapshots(freshMatches);
        const eloMap = getEloForDate(snapshots, targetDate);
        attachEloFromSnapshots(stats, eloMap);
      }
    }

    renderSortableTable(tableContainer, stats, name => showPlayerProfile(name));
  }

  renderFilterBar();
  renderTable();
}
