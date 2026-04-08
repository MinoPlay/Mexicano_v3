import { calculatePlayerStatistics, calculateOpponentStats, calculatePartnershipStats, generatePlayerSummary } from '../services/statistics.js';
import { Store } from '../store.js';
import { getMembers } from '../services/members.js';

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

// ─── Sortable Table Renderer ───

function renderSortableTable(container, stats, onPlayerClick) {
  const columns = [
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

  let sortCol = 'points';
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
        } else {
          td.textContent = row[col.key] ?? '';
        }
        if (col.key === 'name') {
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

function showPlayerProfile(playerName, matches) {
  const summary = generatePlayerSummary(playerName, matches);
  const opponents = calculateOpponentStats(playerName, matches);
  const partners = calculatePartnershipStats(playerName, matches);

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
    const stats = [
      { label: 'Tournaments', value: s.tournaments ?? 0 },
      { label: 'Total Games', value: s.totalGames ?? 0 },
      { label: 'Wins', value: s.wins ?? 0 },
      { label: 'Losses', value: s.losses ?? 0 },
      { label: 'Win Rate', value: ((s.winRate ?? 0) * 100).toFixed(1) + '%' },
      { label: 'Avg Points', value: (s.avgPoints ?? 0).toFixed(1) },
      { label: 'Tight Wins', value: s.tightWins ?? 0 },
      { label: 'Solid Wins', value: s.solidWins ?? 0 },
      { label: 'Dominant Wins', value: s.dominantWins ?? 0 },
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
        <td class="name-cell">${o.opponent}</td>
        <td class="num-cell">${o.games}</td>
        <td class="num-cell">${o.wins}</td>
        <td class="num-cell">${o.losses}</td>
        <td class="num-cell">${((o.winRate ?? 0) * 100).toFixed(1)}%</td>`;
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
        <td class="name-cell">${p.partner}</td>
        <td class="num-cell">${p.games}</td>
        <td class="num-cell">${p.wins}</td>
        <td class="num-cell">${p.losses}</td>
        <td class="num-cell">${(p.avgPoints ?? 0).toFixed(1)}</td>`;
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
  if (!allMatches.length) {
    content.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📊</div>
      <div class="empty-state-text">No statistics yet</div>
      <p class="text-secondary text-sm">Play some tournaments to see stats</p>
    </div>`;
    return;
  }

  const dates = getUniqueDates(allMatches);
  const latestDate = dates[dates.length - 1];

  let activeFilter = 'all';

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
      dates.forEach(d => {
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
    let matches;
    if (activeFilter === 'all') {
      matches = allMatches;
    } else if (activeFilter === 'latest') {
      matches = filterByDate(allMatches, latestDate);
    } else {
      matches = filterByDate(allMatches, activeFilter);
    }

    const stats = calculatePlayerStatistics(matches);
    const members = getMembers();
    const memberSet = new Set(members.map(m => m.toLowerCase()));
    const filteredStats = memberSet.size > 0
      ? stats.filter(s => memberSet.has(s.name.toLowerCase()))
      : stats;
    tableContainer.innerHTML = '';

    if (!filteredStats.length) {
      tableContainer.innerHTML = '<p class="text-secondary text-center mt-lg">No data for this filter</p>';
      return;
    }

    renderSortableTable(tableContainer, filteredStats, name => showPlayerProfile(name, matches));
  }

  renderFilterBar();
  renderTable();
}
