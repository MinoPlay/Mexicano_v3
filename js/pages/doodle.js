import { getDoodle, saveDoodle, deleteDoodle, getChangelog, getAllDatesInMonth } from '../services/doodle.js';
import { Store } from '../store.js';
import { showToast } from '../components/toast.js';
import { getMembers } from '../services/members.js';

// ─── Helpers ───

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return { day: d.getDate(), weekday: WEEKDAY_SHORT[d.getDay()] };
}

// ─── Main Render ───

export function renderDoodle(container, params = {}) {
  container.innerHTML = '';

  const now = new Date();
  let currentYear = now.getFullYear();
  let currentMonth = now.getMonth() + 1;

  const currentUser = Store.getCurrentUser();

  // Header
  const header = document.createElement('div');
  header.className = 'page-header';
  header.innerHTML = `
    <h1>Doodle</h1>
    ${currentUser
      ? `<div class="user-selector">
           <div class="user-avatar">${currentUser.charAt(0).toUpperCase()}</div>
           <span class="text-sm text-medium">${currentUser}</span>
         </div>`
      : '<span class="text-sm text-secondary">No user selected</span>'}
  `;
  container.appendChild(header);

  const content = document.createElement('div');
  content.className = 'page-content';
  container.appendChild(content);

  if (!currentUser) {
    content.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">👤</div>
      <div class="empty-state-text">No user selected</div>
      <p class="text-secondary text-sm">Go to Settings to select your name</p>
    </div>`;
    return;
  }

  // Month nav
  const nav = document.createElement('div');
  nav.className = 'flex items-center justify-between mb-md';
  content.appendChild(nav);

  // Matrix container
  const matrixContainer = document.createElement('div');
  matrixContainer.className = 'mt-md';
  content.appendChild(matrixContainer);

  // Changelog container
  const changelogSection = document.createElement('div');
  changelogSection.className = 'mt-lg';
  content.appendChild(changelogSection);

  function renderNav() {
    nav.innerHTML = `
      <button class="btn btn-ghost btn-sm" data-dir="prev">◀</button>
      <span class="text-medium">${MONTHS[currentMonth - 1]} ${currentYear}</span>
      <button class="btn btn-ghost btn-sm" data-dir="next">▶</button>
    `;
    nav.querySelector('[data-dir="prev"]').addEventListener('click', () => {
      currentMonth--;
      if (currentMonth < 1) { currentMonth = 12; currentYear--; }
      renderAll();
    });
    nav.querySelector('[data-dir="next"]').addEventListener('click', () => {
      currentMonth++;
      if (currentMonth > 12) { currentMonth = 1; currentYear++; }
      renderAll();
    });
  }

  function renderMatrix() {
    matrixContainer.innerHTML = '';

    const doodleData = getDoodle(currentYear, currentMonth);
    const allDates = getAllDatesInMonth(currentYear, currentMonth);

    if (!allDates || allDates.length === 0) {
      matrixContainer.innerHTML = '<p class="text-secondary text-center">No dates for this month</p>';
      return;
    }

    // Collect players: use Members list as source of truth
    const members = getMembers();
    const playerSet = new Set(members.length > 0 ? members : []);
    if (currentUser && !playerSet.has(currentUser)) playerSet.add(currentUser);
    const players = [...playerSet].sort((a, b) => a.localeCompare(b));

    // Build lookup: player → Set of selected dates
    const selections = {};
    players.forEach(p => { selections[p] = new Set(); });
    if (doodleData) {
      doodleData.forEach(entry => {
        if (selections[entry.name] && entry.selected) {
          Object.keys(entry.selected).forEach(d => {
            if (entry.selected[d]) selections[entry.name].add(d);
          });
        }
      });
    }

    // Totals
    const totals = {};
    allDates.forEach(d => { totals[d] = 0; });
    players.forEach(p => {
      selections[p].forEach(d => { if (totals[d] !== undefined) totals[d]++; });
    });
    const maxTotal = Math.max(0, ...Object.values(totals));

    // Build table
    const wrapper = document.createElement('div');
    wrapper.className = 'doodle-matrix';

    const table = document.createElement('table');
    table.className = 'doodle-table';

    // Header row
    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    const cornerTh = document.createElement('th');
    cornerTh.className = 'player-col';
    cornerTh.textContent = 'Player';
    hRow.appendChild(cornerTh);

    allDates.forEach(dateStr => {
      const { day, weekday } = formatDay(dateStr);
      const th = document.createElement('th');
      th.innerHTML = `${day}<br><span style="font-weight:normal;font-size:0.6rem">${weekday}</span>`;
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    // Body rows
    const tbody = document.createElement('tbody');
    players.forEach(player => {
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      nameTd.className = 'player-col';
      nameTd.textContent = player;
      if (player === currentUser) {
        nameTd.style.fontWeight = 'var(--font-weight-bold)';
        nameTd.style.color = 'var(--color-primary)';
      }
      tr.appendChild(nameTd);

      allDates.forEach(dateStr => {
        const td = document.createElement('td');
        const isSelected = selections[player].has(dateStr);
        const isOwn = player === currentUser;

        const cell = document.createElement('div');
        cell.className = 'doodle-cell' + (isSelected ? ' selected' : '') + (!isOwn ? ' readonly' : '');
        cell.textContent = isSelected ? '✓' : '';

        if (isOwn) {
          cell.addEventListener('click', () => {
            if (isSelected) {
              selections[player].delete(dateStr);
            } else {
              selections[player].add(dateStr);
            }
            const updatedDates = [...selections[player]].sort();
            saveDoodle(player, currentYear, currentMonth, updatedDates);
            showToast('Availability updated');
            renderMatrix();
            renderChangelog();
          });
        }

        td.appendChild(cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    // Total row
    const tfoot = document.createElement('tfoot');
    const totalRow = document.createElement('tr');
    totalRow.className = 'doodle-total-row';
    const totalLabel = document.createElement('td');
    totalLabel.className = 'player-col';
    totalLabel.textContent = 'Total';
    totalRow.appendChild(totalLabel);

    allDates.forEach(dateStr => {
      const td = document.createElement('td');
      td.textContent = totals[dateStr] || 0;
      if (maxTotal > 0 && totals[dateStr] === maxTotal) {
        td.classList.add('doodle-best');
      }
      totalRow.appendChild(td);
    });
    tfoot.appendChild(totalRow);
    table.appendChild(tfoot);

    wrapper.appendChild(table);
    matrixContainer.appendChild(wrapper);
  }

  function renderChangelog() {
    changelogSection.innerHTML = '';
    const changelog = getChangelog();
    if (!changelog || !changelog.length) return;

    const title = document.createElement('h3');
    title.className = 'card-title mb-sm';
    title.textContent = 'Recent Changes';
    changelogSection.appendChild(title);

    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-xs);';

    changelog.slice(0, 20).forEach(entry => {
      const item = document.createElement('div');
      item.className = 'card';
      item.style.padding = 'var(--space-sm) var(--space-md)';
      item.style.fontSize = 'var(--font-size-xs)';

      const label = entry.playerName || 'Unknown';
      const month = entry.month ? `${entry.year}-${String(entry.month).padStart(2, '0')}` : '';
      const dates = (entry.selectedDates || []).join(', ');

      item.innerHTML = `
        <span class="text-medium">${label}</span>
        <span class="text-secondary"> updated for ${month}</span>
        ${dates ? `<div class="text-secondary mt-xs">Selected: ${dates}</div>` : ''}
      `;
      list.appendChild(item);
    });

    changelogSection.appendChild(list);
  }

  function renderAll() {
    renderNav();
    renderMatrix();
    renderChangelog();
  }

  renderAll();
}
