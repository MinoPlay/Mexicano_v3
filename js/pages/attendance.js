import { getMonthlyAttendance, getAttendanceStatistics } from '../services/attendance.js';
import { Store } from '../store.js';

// ─── Helpers ───

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getInitialMonth(matches) {
  if (!matches.length) return { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  const dates = matches.map(m => m.date).sort();
  const last = dates[dates.length - 1];
  const d = new Date(last + 'T00:00:00');
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function firstWeekday(year, month) {
  // 0=Mon...6=Sun
  const d = new Date(year, month - 1, 1).getDay();
  return (d + 6) % 7;
}

// ─── Calendar Renderer ───

function renderCalendar(el, year, month, monthData) {
  el.innerHTML = '';

  // Weekday headers
  const headerRow = document.createElement('div');
  headerRow.className = 'attendance-calendar';
  WEEKDAYS.forEach(w => {
    const cell = document.createElement('div');
    cell.style.cssText = 'font-size:var(--font-size-xs);font-weight:var(--font-weight-semibold);color:var(--text-secondary);text-align:center;padding:var(--space-xs);';
    cell.textContent = w;
    headerRow.appendChild(cell);
  });
  el.appendChild(headerRow);

  // Calendar grid
  const grid = document.createElement('div');
  grid.className = 'attendance-calendar';

  const totalDays = daysInMonth(year, month);
  const startDay = firstWeekday(year, month);

  // Build lookup: day number → { count, players }
  const lookup = {};
  if (monthData && monthData.days) {
    monthData.days.forEach(d => {
      lookup[d.day] = d;
    });
  }

  // Leading empty cells
  for (let i = 0; i < startDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'attendance-day';
    empty.style.border = 'none';
    empty.style.background = 'transparent';
    grid.appendChild(empty);
  }

  // Day cells
  for (let day = 1; day <= totalDays; day++) {
    const cell = document.createElement('div');
    cell.className = 'attendance-day';
    const info = lookup[day];
    if (info) {
      cell.classList.add('has-tournament');
      cell.style.cursor = 'pointer';
      cell.innerHTML = `
        <span class="attendance-day-number">${day}</span>
        <span class="attendance-day-count">${info.count} 🏸</span>
      `;
      cell.addEventListener('click', () => showDayPlayers(info.players, year, month, day));
    } else {
      cell.innerHTML = `<span class="attendance-day-number">${day}</span>`;
    }
    grid.appendChild(cell);
  }

  el.appendChild(grid);
}

function showDayPlayers(players, year, month, day) {
  if (!players || !players.length) return;

  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay active';

  const dialog = document.createElement('div');
  dialog.className = 'dialog';
  dialog.style.maxHeight = '60dvh';

  const dateStr = new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  dialog.innerHTML = `
    <div class="dialog-header">
      <h2 style="font-size:var(--font-size-lg);font-weight:var(--font-weight-semibold)">${dateStr}</h2>
      <button class="btn btn-ghost btn-sm dialog-close">✕</button>
    </div>
    <div class="dialog-body">
      <p class="text-secondary text-sm mb-md">${players.length} players attended</p>
      <div style="display:flex;flex-direction:column;gap:var(--space-xs)">
        ${players.map(p => `<div class="leaderboard-item"><span class="leaderboard-name">${p}</span></div>`).join('')}
      </div>
    </div>
  `;

  dialog.querySelector('.dialog-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// ─── Stats Table ───

function renderStatsTable(el, allMatches) {
  const stats = getAttendanceStatistics(allMatches);
  el.innerHTML = '';

  if (!stats || !stats.length) {
    el.innerHTML = '<p class="text-secondary text-center mt-lg">No attendance data</p>';
    return;
  }

  const columns = [
    { key: 'rank', label: '#', cls: 'rank-cell' },
    { key: 'name', label: 'Player', cls: 'name-cell' },
    { key: 'attended', label: 'Attended', cls: 'num-cell' },
    { key: 'total', label: 'Total', cls: 'num-cell' },
    { key: 'rate', label: 'Attendance%', cls: 'num-cell' },
  ];

  let sortCol = 'attended';
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
    el.innerHTML = '';
    const rows = sortedData();
    const wrapper = document.createElement('div');
    wrapper.className = 'data-table';
    const table = document.createElement('table');

    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    columns.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col.label;
      th.className = col.cls || '';
      if (col.key === sortCol) th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      if (col.key !== 'rank') {
        th.addEventListener('click', () => {
          if (sortCol === col.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          else { sortCol = col.key; sortDir = col.key === 'name' ? 'asc' : 'desc'; }
          render();
        });
      }
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach(row => {
      const tr = document.createElement('tr');
      columns.forEach(col => {
        const td = document.createElement('td');
        td.className = col.cls || '';
        if (col.key === 'rate') {
          td.textContent = ((row.rate ?? 0) * 100).toFixed(1) + '%';
        } else {
          td.textContent = row[col.key] ?? '';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    el.appendChild(wrapper);
  }

  render();
}

// ─── Main Render ───

export function renderAttendance(container, params = {}) {
  container.innerHTML = '';

  const allMatches = Store.getMatches();
  const init = getInitialMonth(allMatches);
  let currentYear = init.year;
  let currentMonth = init.month;

  // Header
  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = '<h1>Attendance</h1>';
  container.appendChild(header);

  const content = document.createElement('div');
  content.className = 'page-content';
  container.appendChild(content);

  if (!allMatches.length) {
    content.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📅</div>
      <div class="empty-state-text">No attendance data</div>
      <p class="text-secondary text-sm">Play some tournaments first</p>
    </div>`;
    return;
  }

  // Month navigator
  const nav = document.createElement('div');
  nav.className = 'flex items-center justify-between mb-md';
  content.appendChild(nav);

  // Tabs
  const tabsEl = document.createElement('div');
  tabsEl.className = 'tabs';
  content.appendChild(tabsEl);

  // Body
  const body = document.createElement('div');
  body.className = 'mt-md';
  content.appendChild(body);

  let activeTab = 'calendar';

  function renderNav() {
    nav.innerHTML = `
      <button class="btn btn-ghost btn-sm" data-dir="prev">◀</button>
      <span class="text-medium">${MONTHS[currentMonth - 1]} ${currentYear}</span>
      <button class="btn btn-ghost btn-sm" data-dir="next">▶</button>
    `;
    nav.querySelector('[data-dir="prev"]').addEventListener('click', () => {
      currentMonth--;
      if (currentMonth < 1) { currentMonth = 12; currentYear--; }
      renderContent();
    });
    nav.querySelector('[data-dir="next"]').addEventListener('click', () => {
      currentMonth++;
      if (currentMonth > 12) { currentMonth = 1; currentYear++; }
      renderContent();
    });
  }

  function renderTabsBar() {
    tabsEl.innerHTML = '';
    [{ id: 'calendar', label: 'Calendar' }, { id: 'statistics', label: 'Statistics' }].forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'tab' + (activeTab === t.id ? ' active' : '');
      btn.textContent = t.label;
      btn.addEventListener('click', () => { activeTab = t.id; renderTabsBar(); renderBody(); });
      tabsEl.appendChild(btn);
    });
  }

  function renderBody() {
    body.innerHTML = '';
    if (activeTab === 'calendar') {
      const monthData = getMonthlyAttendance(currentYear, currentMonth);
      renderCalendar(body, currentYear, currentMonth, monthData);
    } else {
      renderStatsTable(body, allMatches);
    }
  }

  function renderContent() {
    renderNav();
    renderTabsBar();
    renderBody();
  }

  renderContent();
}
