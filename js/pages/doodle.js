import { getDoodle, saveDoodle, deleteDoodle, getChangelog, getAllDatesInMonth, syncDoodleFromLocal } from '../services/doodle.js';
import { Store } from '../store.js';
import { State } from '../state.js';
import { showToast } from '../components/toast.js';
import { calculateAllEloRankings } from '../services/elo.js';
import { pushDoodleNow, cancelPendingSync, pullDoodleMonth } from '../services/github.js';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Build a name→ELO map, preferring pre-computed players_summary. */
function buildEloMap() {
  const summary = Store.getPlayersSummary();
  if (summary.length > 0) {
    const map = {};
    for (const p of summary) map[p.name] = p.elo;
    return map;
  }
  const { players } = calculateAllEloRankings(Store.getMatches());
  const map = {};
  for (const [name, data] of Object.entries(players)) map[name] = data.elo;
  return map;
}

// ─── Helpers ───

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

function formatDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return { day: d.getDate(), weekday: WEEKDAY_LABELS[d.getDay()] };
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

  // User calendar container
  const calContainer = document.createElement('div');
  calContainer.className = 'mt-sm';
  content.appendChild(calContainer);

  // Overall collapsible
  const overallDetails = document.createElement('details');
  overallDetails.className = 'doodle-overall mt-lg';
  const overallSummary = document.createElement('summary');
  overallSummary.className = 'doodle-overall-summary';
  overallSummary.textContent = 'Overall availability';
  overallDetails.appendChild(overallSummary);
  const matrixContainer = document.createElement('div');
  matrixContainer.className = 'mt-sm';
  overallDetails.appendChild(matrixContainer);
  content.appendChild(overallDetails);

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

  function renderUserCalendar() {
    calContainer.innerHTML = '';

    const todayStr = new Date().toISOString().slice(0, 10);
    const doodleData = getDoodle(currentYear, currentMonth);

    // Build user's selected dates set
    const userSelected = new Set();
    if (doodleData) {
      const entry = doodleData.find(e => e.name === currentUser);
      if (entry && entry.selected) {
        Object.keys(entry.selected).forEach(d => {
          if (entry.selected[d]) userSelected.add(d);
        });
      }
    }

    // Build calendar grid: find first day of month and total days
    const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay(); // 0=Sun
    const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();

    // Weekday header
    const grid = document.createElement('div');
    grid.className = 'doodle-cal-grid';

    WEEKDAY_LABELS.forEach(label => {
      const hCell = document.createElement('div');
      hCell.className = 'doodle-cal-header';
      hCell.textContent = label;
      grid.appendChild(hCell);
    });

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'doodle-cal-cell doodle-cal-empty';
      grid.appendChild(empty);
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(currentYear, currentMonth - 1, d);
      const dow = date.getDay();
      const mm = String(currentMonth).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const dateStr = `${currentYear}-${mm}-${dd}`;

      const isPlayable = dow === 2 || dow === 4; // Tue or Thu
      const isPast = dateStr < todayStr;
      const isSelected = userSelected.has(dateStr);

      const cell = document.createElement('div');
      cell.className = 'doodle-cal-cell'
        + (isPlayable ? ' playable' : ' inactive')
        + (isSelected ? ' selected' : '')
        + (isPast ? ' past' : '');
      cell.textContent = d;

      if (isPlayable && !isPast) {
        cell.addEventListener('click', async () => {
          if (isSelected) {
            userSelected.delete(dateStr);
          } else {
            userSelected.add(dateStr);
          }
          const updatedDates = [...userSelected].sort();
          saveDoodle(currentUser, currentYear, currentMonth, updatedDates);
          const yearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
          try {
            await pushDoodleNow(yearMonth);
            cancelPendingSync();
          } catch (e) {
            console.error('Doodle push failed:', e);
            showToast('Sync failed — saved locally');
          }
        });
      }

      grid.appendChild(cell);
    }

    calContainer.appendChild(grid);
  }

  function renderMatrix() {
    matrixContainer.innerHTML = '';

    const todayStr = new Date().toISOString().slice(0, 10);
    const doodleData = getDoodle(currentYear, currentMonth);
    const allDates = getAllDatesInMonth(currentYear, currentMonth);
    const visibleDates = allDates.filter(d => d >= todayStr);

    if (!visibleDates.length) {
      matrixContainer.innerHTML = '<p class="text-secondary text-center">No upcoming dates this month</p>';
      return;
    }

    // Collect players
    const allPlayerSet = new Set();
    if (currentUser) allPlayerSet.add(currentUser);
    if (doodleData) {
      doodleData.forEach(entry => { if (entry.name) allPlayerSet.add(entry.name); });
    }
    const allPlayers = [...allPlayerSet];

    // Build selections lookup
    const selections = {};
    allPlayers.forEach(p => { selections[p] = new Set(); });
    if (doodleData) {
      doodleData.forEach(entry => {
        if (selections[entry.name] && entry.selected) {
          Object.keys(entry.selected).forEach(d => {
            if (entry.selected[d]) selections[entry.name].add(d);
          });
        }
      });
    }

    const players = allPlayers
      .filter(p => p === currentUser || visibleDates.some(d => selections[p].has(d)))
      .sort((a, b) => a.localeCompare(b));

    const totals = {};
    visibleDates.forEach(d => { totals[d] = 0; });
    players.forEach(p => {
      selections[p].forEach(d => { if (totals[d] !== undefined) totals[d]++; });
    });
    const maxTotal = Math.max(0, ...Object.values(totals));

    const wrapper = document.createElement('div');
    wrapper.className = 'doodle-matrix';

    const table = document.createElement('table');
    table.className = 'doodle-table';

    const thead = document.createElement('thead');
    const hRow = document.createElement('tr');
    const cornerTh = document.createElement('th');
    cornerTh.className = 'player-col';
    cornerTh.textContent = 'Player';
    hRow.appendChild(cornerTh);

    visibleDates.forEach(dateStr => {
      const { day, weekday } = formatDay(dateStr);
      const isPast = dateStr < todayStr;
      const th = document.createElement('th');
      if (isPast) th.classList.add('doodle-past');
      th.innerHTML = `${day}<br><span style="font-weight:normal;font-size:0.6rem">${weekday}</span>`;
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

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

      visibleDates.forEach(dateStr => {
        const td = document.createElement('td');
        const isSelected = selections[player].has(dateStr);
        const isOwn = player === currentUser;
        const isPast = dateStr < todayStr;

        const cell = document.createElement('div');
        cell.className = 'doodle-cell'
          + (isSelected ? ' selected' : '')
          + ((!isOwn || isPast) ? ' readonly' : '')
          + (isPast ? ' past' : '');
        cell.textContent = isSelected ? '✓' : '';

        if (isOwn && !isPast) {
          cell.addEventListener('click', async () => {
            if (isSelected) {
              selections[player].delete(dateStr);
            } else {
              selections[player].add(dateStr);
            }
            const updatedDates = [...selections[player]].sort();
            saveDoodle(player, currentYear, currentMonth, updatedDates);
            const yearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
            try {
              await pushDoodleNow(yearMonth);
              cancelPendingSync();
            } catch (e) {
              console.error('Doodle push failed:', e);
              showToast('Sync failed — saved locally');
            }
          });
        }

        td.appendChild(cell);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    const tfoot = document.createElement('tfoot');
    const totalRow = document.createElement('tr');
    totalRow.className = 'doodle-total-row';
    const totalLabel = document.createElement('td');
    totalLabel.className = 'player-col';
    totalLabel.textContent = 'Total';
    totalRow.appendChild(totalLabel);

    visibleDates.forEach(dateStr => {
      const td = document.createElement('td');
      const isPast = dateStr < todayStr;
      const count = totals[dateStr] || 0;
      td.textContent = count;
      if (isPast) td.classList.add('doodle-past');
      if (maxTotal > 0 && totals[dateStr] === maxTotal) {
        td.classList.add('doodle-best');
      }

      if (count > 0 && !isPast) {
        td.classList.add('doodle-total-clickable');
        td.addEventListener('click', () => {
          const availablePlayers = players.filter(p => selections[p].has(dateStr));
          const eloMap = buildEloMap();
          availablePlayers.sort((a, b) => {
            const eloA = eloMap[a] ?? 1000;
            const eloB = eloMap[b] ?? 1000;
            return eloB - eloA;
          });
          const namesParam = availablePlayers.map(n => encodeURIComponent(n)).join(',');
          window.location.hash = `#/create-tournament?date=${dateStr}&names=${namesParam}`;
        });
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
    renderUserCalendar();
    renderMatrix();
    renderChangelog();
    syncDoodleFromLocal(currentYear, currentMonth).catch(() => {});
    const ym = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    if (Store.getGitHubConfig()?.pat) {
      pullDoodleMonth(ym).then(({ content, updated }) => {
        if (updated && content) {
          Store.setDoodle(ym, content);
          State.emit('doodle-changed', { year: currentYear, month: currentMonth });
        }
      }).catch(() => {});
    }
  }

  const unsubDoodle = State.on('doodle-changed', ({ year, month } = {}) => {
    if (!year || (year === currentYear && month === currentMonth)) {
      renderUserCalendar();
      renderMatrix();
      renderChangelog();
    }
  });

  renderAll();
  return unsubDoodle;
}
