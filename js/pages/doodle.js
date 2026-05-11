import { getDoodle, saveDoodle, deleteDoodle, getChangelog, getAllDatesInMonth } from '../services/doodle.js';
import { Store } from '../store.js';
import { State } from '../state.js';
import { showToast } from '../components/toast.js';
import { calculateAllEloRankings } from '../services/elo.js';
import { pushDoodleNow, cancelPendingSync, pullDoodleMonth, clearSessionTTL } from '../services/github.js';
import { sendDoodleAlert } from '../services/whatsapp.js';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ─── Edit Session Management ───

class DoodleEditSession {
  constructor(yearMonth, currentUser) {
    this.yearMonth = yearMonth;
    this.currentUser = currentUser;
    this.currentEdits = {}; // playerName → Set of selected dates
    this.originalState = {}; // playerName → Set of original selected dates (snapshot)
    this.listeners = new Set();
    this.isSaving = false; // Prevent concurrent saves
    this._captureCurrentState();
  }

  _captureCurrentState() {
    const doodleData = getDoodle(parseInt(this.yearMonth.slice(0, 4)), parseInt(this.yearMonth.slice(5, 7)));
    if (doodleData) {
      doodleData.forEach(entry => {
        const selected = new Set();
        Object.entries(entry.selected).forEach(([date, isSelected]) => {
          if (isSelected) selected.add(date);
        });
        this.originalState[entry.name] = selected;
        this.currentEdits[entry.name] = new Set(selected); // clone
      });
    }
  }

  isDirty() {
    for (const [player, editedSet] of Object.entries(this.currentEdits)) {
      const originalSet = this.originalState[player] || new Set();
      if (editedSet.size !== originalSet.size) return true;
      for (const date of editedSet) {
        if (!originalSet.has(date)) return true;
      }
    }
    return false;
  }

  addChange(playerName, dateStr) {
    if (!this.currentEdits[playerName]) {
      this.currentEdits[playerName] = new Set(this.originalState[playerName] || []);
    }
    const set = this.currentEdits[playerName];
    if (set.has(dateStr)) {
      set.delete(dateStr);
    } else {
      set.add(dateStr);
    }
    this._notifyChange();
  }

  getEffectiveSelection(playerName) {
    return this.currentEdits[playerName] || new Set();
  }

  async save() {
    // Prevent concurrent saves
    if (this.isSaving) {
      console.warn('Save already in progress, ignoring duplicate save request');
      return false;
    }

    this.isSaving = true;
    this._notifyChange();

    try {
      const ym = this.yearMonth;
      const year = parseInt(ym.slice(0, 4));
      const month = parseInt(ym.slice(5, 7));

      // Pull latest changes from GitHub
      const { content: remoteContent, changelog: remoteChangelog } = await pullDoodleMonth(ym);
      if (remoteContent && Array.isArray(remoteContent)) {
        // Merge remote entries with local store
        const mergedEntries = [...Store.getDoodle(ym)];
        let changed = false;
        remoteContent.forEach(entry => {
          const existing = mergedEntries.find(e => e.name === entry.name);
          if (!existing) {
            mergedEntries.push(entry);
            changed = true;
          }
        });
        if (changed) Store.setDoodle(ym, mergedEntries);
      }
      if (remoteChangelog && Array.isArray(remoteChangelog)) {
        Store.setDoodleChangelog(ym, remoteChangelog);
      }

      // Apply accumulated edits to Store (all in one batch)
      const pendingAlerts = [];
      for (const [playerName, editedSet] of Object.entries(this.currentEdits)) {
        const selectedDates = [...editedSet].sort();
        const change = saveDoodle(playerName, year, month, selectedDates);
        if (change) pendingAlerts.push(change);
      }

      // Push to GitHub (single batched commit)
      await pushDoodleNow(ym);
      void Promise.allSettled(
        pendingAlerts.map(change =>
          sendDoodleAlert(
            change.playerName,
            change.yearMonth,
            change.selectedAdded || [],
            change.selectedRemoved || []
          ).catch(err => console.warn('[whatsapp] alert error:', err))
        )
      );
      cancelPendingSync();
      showToast('Doodle saved');
      return true;
    } catch (e) {
      console.error('Doodle save failed:', e);
      // Distinguish error types for better user feedback
      if (e.message?.includes('401') || e.message?.includes('403')) {
        showToast('Authentication failed — check your GitHub token');
      } else if (e.message?.includes('Network') || e.message?.includes('fetch')) {
        showToast('Network error — please check your connection and retry');
      } else {
        showToast('Save failed — please retry');
      }
      // Keep edit mode open so user can retry
      return false;
    } finally {
      this.isSaving = false;
      this._notifyChange();
    }
  }

  revert() {
    this._captureCurrentState();
    this._notifyChange();
    showToast('Changes cancelled');
  }

  _notifyChange() {
    this.listeners.forEach(fn => fn());
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

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
  let editSession = null;
  let unsavedChangesModal = null;

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

  // Footer for Save/Cancel buttons
  const footer = document.createElement('div');
  footer.className = 'doodle-footer';
  footer.style.display = 'none';
  container.appendChild(footer);

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
    nav.querySelector('[data-dir="prev"]').addEventListener('click', async () => {
      if (editSession?.isDirty()) {
        const result = await showUnsavedChangesModal('month');
        if (result === 'cancel') return;
      }
      currentMonth--;
      if (currentMonth < 1) { currentMonth = 12; currentYear--; }
      editSession = null;
      renderAll();
    });
    nav.querySelector('[data-dir="next"]').addEventListener('click', async () => {
      if (editSession?.isDirty()) {
        const result = await showUnsavedChangesModal('month');
        if (result === 'cancel') return;
      }
      currentMonth++;
      if (currentMonth > 12) { currentMonth = 1; currentYear++; }
      editSession = null;
      renderAll();
    });
  }

  function renderUserCalendar() {
    calContainer.innerHTML = '';

    const todayStr = new Date().toISOString().slice(0, 10);
    const doodleData = getDoodle(currentYear, currentMonth);

    // Build user's selected dates set - use edit session if active, otherwise use Store
    const userSelected = editSession 
      ? new Set(editSession.getEffectiveSelection(currentUser)) 
      : new Set();
    if (!editSession && doodleData) {
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
      
      // Mark as pending if in edit session but different from original
      if (editSession && editSession.getEffectiveSelection(currentUser).has(dateStr) 
          && !(editSession.originalState[currentUser]?.has(dateStr))) {
        cell.classList.add('doodle-pending');
      } else if (editSession && !editSession.getEffectiveSelection(currentUser).has(dateStr)
          && editSession.originalState[currentUser]?.has(dateStr)) {
        cell.classList.add('doodle-pending');
      }
      
      cell.textContent = d;

      if (isPlayable && !isPast) {
        cell.addEventListener('click', async () => {
          if (!editSession) {
            editSession = new DoodleEditSession(`${currentYear}-${String(currentMonth).padStart(2, '0')}`, currentUser);
            setupEditSessionListeners();
          }
          
          editSession.addChange(currentUser, dateStr);
          renderUserCalendar();
          renderMatrix();
          updateFooter();
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

    // Build selections lookup - use edit session if active
    const selections = {};
    allPlayers.forEach(p => { selections[p] = editSession ? new Set(editSession.getEffectiveSelection(p)) : new Set(); });
    if (!editSession && doodleData) {
      doodleData.forEach(entry => {
        if (selections[entry.name] && entry.selected) {
          Object.keys(entry.selected).forEach(d => {
            if (entry.selected[d]) selections[entry.name].add(d);
          });
        }
      });
    } else if (editSession && doodleData) {
      // Merge Store data for non-current users
      doodleData.forEach(entry => {
        if (entry.name !== currentUser && entry.selected) {
          selections[entry.name] = new Set();
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
            if (!editSession) {
              editSession = new DoodleEditSession(`${currentYear}-${String(currentMonth).padStart(2, '0')}`, currentUser);
              setupEditSessionListeners();
            }
            editSession.addChange(player, dateStr);
            renderUserCalendar();
            renderMatrix();
            updateFooter();
          });
        }

        // Apply pending styling if in edit session
        if (editSession && player === currentUser) {
          const isEditedSelected = editSession.getEffectiveSelection(player).has(dateStr);
          const wasOriginallySelected = editSession.originalState[player]?.has(dateStr);
          if (isEditedSelected !== wasOriginallySelected) {
            cell.classList.add('doodle-pending');
          }
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
    const changelog = getChangelog(currentYear, currentMonth);
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
      const month = entry.yearMonth || (entry.month ? `${entry.year}-${String(entry.month).padStart(2, '0')}` : '');
      const selected = (entry.selectedAdded || []).join(', ');
      const removed = (entry.selectedRemoved || []).join(', ');
      const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '';

      item.innerHTML = `
        <span class="text-medium">${label}</span>
        <span class="text-secondary"> updated for ${month}</span>
        ${selected ? `<div class="text-secondary mt-xs">Selected: ${selected}</div>` : ''}
        ${removed ? `<div class="text-secondary mt-xs">Removed: ${removed}</div>` : ''}
        ${timestamp ? `<div class="text-secondary mt-xs">${timestamp}</div>` : ''}
      `;
      list.appendChild(item);
    });

    changelogSection.appendChild(list);
  }

  function setupFooterButtons() {
    footer.innerHTML = `
      <button class="btn btn-primary" id="doodle-save-btn">Save Changes</button>
      <button class="btn btn-ghost" id="doodle-cancel-btn">Cancel</button>
    `;

    const saveBtn = document.getElementById('doodle-save-btn');
    const cancelBtn = document.getElementById('doodle-cancel-btn');

    saveBtn.addEventListener('click', async () => {
      // Disable buttons during save
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Saving...';

      const success = await editSession.save();
      
      if (success) {
        // Save succeeded, clear edit session and refresh UI
        editSession = null;
        renderUserCalendar();
        renderMatrix();
        renderChangelog();
        updateFooter();
      } else {
        // Save failed, re-enable buttons for retry
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
        saveBtn.textContent = originalText;
      }
    });

    cancelBtn.addEventListener('click', () => {
      editSession.revert();
      renderUserCalendar();
      renderMatrix();
      updateFooter();
    });
  }

  function updateFooter() {
    if (!editSession) {
      footer.style.display = 'none';
      footer.innerHTML = '';
      return;
    }

    if (editSession.isDirty()) {
      footer.style.display = 'flex';
      
      // Only set up buttons if they don't exist yet
      if (!document.getElementById('doodle-save-btn')) {
        setupFooterButtons();
      }

      // Update button states based on saving status
      const saveBtn = document.getElementById('doodle-save-btn');
      const cancelBtn = document.getElementById('doodle-cancel-btn');
      if (saveBtn && cancelBtn) {
        saveBtn.disabled = editSession.isSaving;
        cancelBtn.disabled = editSession.isSaving;
      }
    } else {
      footer.style.display = 'none';
    }
  }

  function showUnsavedChangesModal(action) {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'doodle-modal-overlay';
      
      const modalContent = document.createElement('div');
      modalContent.className = 'doodle-modal';
      modalContent.innerHTML = `
        <h3>Unsaved Changes</h3>
        <p>You have unsaved doodle changes. Save them before leaving?</p>
        <div class="modal-buttons">
          <button class="btn btn-primary" id="modal-save">Save</button>
          <button class="btn btn-danger" id="modal-cancel">Cancel</button>
        </div>
      `;
      modal.appendChild(modalContent);
      document.body.appendChild(modal);

      // Keep track if modal has been resolved to prevent double-resolve
      let resolved = false;

      const closeModal = () => {
        try {
          if (modal.parentNode) document.body.removeChild(modal);
        } catch (e) {
          console.warn('Modal already removed', e);
        }
      };

      const handleSave = async () => {
        if (resolved) return;
        const saveBtn = document.getElementById('modal-save');
        const cancelBtn = document.getElementById('modal-cancel');
        
        if (!saveBtn || !cancelBtn) return; // Modal might be removed
        
        // Disable buttons during save
        saveBtn.disabled = true;
        cancelBtn.disabled = true;
        const originalText = saveBtn.textContent;
        saveBtn.textContent = 'Saving...';

        const success = await editSession.save();
        if (success) {
          resolved = true;
          closeModal();
          editSession = null;
          resolve('save');
        } else {
          // Save failed, re-enable buttons for retry
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
          saveBtn.textContent = originalText;
        }
      };

      const handleCancel = () => {
        if (resolved) return;
        resolved = true;
        closeModal();
        editSession.revert();
        editSession = null;
        resolve('discard');
      };

      const modalSaveBtn = document.getElementById('modal-save');
      const modalCancelBtn = document.getElementById('modal-cancel');
      
      if (modalSaveBtn) modalSaveBtn.addEventListener('click', handleSave);
      if (modalCancelBtn) modalCancelBtn.addEventListener('click', handleCancel);

      // Click outside modal to close (acts as Cancel)
      modal.addEventListener('click', (e) => {
        if (e.target === modal && !resolved) {
          handleCancel();
        }
      });
    });
  }

  function setupEditSessionListeners() {
    // Block beforeunload for tab close
    const beforeUnloadHandler = (e) => {
      if (editSession?.isDirty()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);

    // Register route blocker to prevent navigation with unsaved changes
    const routeBlocker = async () => {
      if (editSession?.isDirty()) {
        const result = await showUnsavedChangesModal('route');
        
        if (result === 'cancel') {
          // Block route change
          return false;
        } else if (result === 'discard') {
          // Discard changes and allow route change
          editSession.revert();
          editSession = null;
          return true;
        } else if (result === 'save') {
          // Save succeeded, allow route change
          editSession = null;
          return true;
        }
      }
      return true; // No unsaved changes, allow route change
    };

    const unblockRoute = State.addRouteBlocker(routeBlocker);

    // Store cleanup listeners for when edit session ends or page unloads
    editSession._beforeUnloadHandler = beforeUnloadHandler;
    editSession._unblockRoute = unblockRoute;
  }

  function cleanupEditSession() {
    if (editSession) {
      if (editSession._beforeUnloadHandler) {
        window.removeEventListener('beforeunload', editSession._beforeUnloadHandler);
      }
      if (editSession._unblockRoute) {
        editSession._unblockRoute();
      }
      // Clear footer when edit session ends
      footer.innerHTML = '';
      footer.style.display = 'none';
    }
  }

  function renderAll() {
    renderNav();
    renderUserCalendar();
    renderMatrix();
    renderChangelog();
    updateFooter();
    const ym = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    if (Store.getGitHubConfig()?.pat) {
      clearSessionTTL(`doodle_${ym}`);
      pullDoodleMonth(ym).then(({ content, changelog, updated }) => {
        if (updated) {
          if (content) Store.setDoodle(ym, content);
          if (changelog) Store.setDoodleChangelog(ym, changelog);
          State.emit('doodle-changed', { year: currentYear, month: currentMonth });
        }
      }).catch(() => {});
    }
  }

  const unsubDoodle = State.on('doodle-changed', ({ year, month } = {}) => {
    if (!year || (year === currentYear && month === currentMonth)) {
      if (!editSession) {
        renderUserCalendar();
        renderMatrix();
        renderChangelog();
      }
    }
  });

  const beforePageUnloadHandler = (e) => {
    if (editSession?.isDirty()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', beforePageUnloadHandler);

  renderAll();
  
  return () => {
    unsubDoodle();
    cleanupEditSession();
    window.removeEventListener('beforeunload', beforePageUnloadHandler);
  };
}
