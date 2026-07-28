import { Store } from '../store.js';
import { getMembers, addMember, removeMember } from '../services/members.js';
import { showToast } from '../components/toast.js';
import { testConnection, onSyncStatus, getSyncStatus, pushDoodleNow, addPlayerToPlayersJson } from '../services/github.js';
import { isInstalled } from '../components/install-prompt.js';
import { sendTelegramTestAlert, sendTournamentTestAlert } from '../services/telegram.js';
import { showManualAttendanceDialog } from '../components/manual-attendance-dialog.js';
import { getVersionLabel, refreshApp } from '../version.js';

function renderMembersList(listEl) {
  const members = getMembers();
  listEl.innerHTML = members.length === 0
    ? '<div class="text-sm text-secondary" style="padding:var(--space-sm) 0;">No members added yet</div>'
    : members.map(name => `
        <div class="member-item" data-name="${name}">
          <span class="member-name">${name}</span>
          <button class="btn btn-ghost btn-sm member-delete" aria-label="Remove ${name}">×</button>
        </div>
      `).join('');
}

function updateAvatar(avatarEl) {
  const user = Store.getCurrentUser();
  avatarEl.textContent = user ? user.charAt(0).toUpperCase() : '?';
}

export function renderSettings(container, params) {
  const members = getMembers();
  const currentUser = Store.getCurrentUser();

  container.innerHTML = `
    <header class="page-header">
      <h1>Settings</h1>
    </header>
    <div class="page-content">

      <!-- App Version -->
      <div class="settings-section" style="display:flex;justify-content:flex-end;padding:var(--space-sm) 0;">
        <button id="app-refresh-btn" class="btn btn-secondary btn-sm" title="Refresh to latest version">${getVersionLabel()}</button>
      </div>

      <!-- Current User -->
      <div class="settings-section">
        <div class="settings-section-title">Current User</div>
        <div class="user-selector">
          <div class="user-avatar" id="settings-avatar">${currentUser ? currentUser.charAt(0).toUpperCase() : '?'}</div>
          <select id="settings-user-select">
            <option value="">Select user…</option>
            ${members.map(m => `<option value="${m}" ${m === currentUser ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Members -->
      <div class="settings-section">
        <div class="members-header">
          <details class="members-collapsible">
            <summary class="settings-section-title members-summary">Members</summary>
            <div id="members-list"></div>
          </details>
          <form id="add-member-form" class="flex gap-sm">
            <input type="text" id="new-member-input" placeholder="New member name" maxlength="50" style="flex:1;" />
            <button type="submit" class="btn btn-primary">Add</button>
          </form>
        </div>
      </div>

      <!-- GitHub Backend -->
      <div class="settings-section">
        <div class="settings-section-title">
          GitHub Backend
          <span id="github-sync-icon" class="github-sync-icon" title="Sync status">⬜</span>
        </div>
        <p class="text-sm text-secondary" style="margin-bottom:var(--space-sm);">
          Store app data in a GitHub repository. A Personal Access Token (PAT) with <strong>repo</strong> scope is required.
        </p>
        <div class="flex flex-col gap-sm">
          <input type="text"  id="github-owner"     value="MinoPlay"                   disabled style="opacity:0.6;cursor:not-allowed;" />
          <input type="text"  id="github-repo"      value="DataHub_Mexicano"                    disabled style="opacity:0.6;cursor:not-allowed;" />
          <input type="password" id="github-pat"    placeholder="Personal Access Token (PAT)" maxlength="255" autocomplete="off" />
          <input type="text"  id="github-base-path" value="mexicano_v3/backup-data"    disabled style="opacity:0.6;cursor:not-allowed;" />
        </div>
        <div class="flex gap-sm mt-sm">
          <button id="github-save-btn"  class="btn btn-primary"    style="flex:1;">Save</button>
          <button id="github-test-btn"  class="btn btn-secondary"  style="flex:1;">Test</button>
          <button id="github-clear-btn" class="btn btn-ghost"      style="flex:1;">Clear</button>
        </div>
        <div id="github-status-msg" class="text-sm mt-sm" style="min-height:1.25rem;"></div>
      </div>

      <!-- Manual Attendance -->
      <div class="settings-section" id="attendance-section">
        <div class="settings-section-title">Attendance</div>
        <p class="text-sm text-secondary" style="margin-bottom:var(--space-sm);">
          Record attendance for a day without a tournament. Only affects Stats → Attendance and the Doodle Player Overview.
        </p>
        <div class="flex gap-sm mt-sm">
          <button id="attendance-add-btn" class="btn btn-primary" style="flex:1;">➕ Add Attendance</button>
        </div>
      </div>

      <!-- Telegram Alerts -->
      <div class="settings-section">
        <div class="settings-section-title">Telegram Alerts</div>
        <p class="text-sm text-secondary" style="margin-bottom:var(--space-sm);">
          Doodle updates and tournament confirmations are relayed to a
          <a href="https://core.telegram.org/bots#botfather" target="_blank" rel="noopener">Telegram bot</a>
          through a GitHub Actions workflow, so alerts work even on networks that block Telegram.
        </p>
        <div class="flex gap-sm mt-sm">
          <button id="tg-test-btn" class="btn btn-primary" style="flex:1;">📞 Send Test Alert</button>
          <button id="tg-test-tournament-btn" class="btn btn-secondary" style="flex:1;">🎾 Test Tournament Group</button>
        </div>
        <div id="tg-status-msg" class="text-sm mt-sm" style="min-height:1.25rem;"></div>
      </div>


    </div>
  `;

  // Render members list
  const membersListEl = container.querySelector('#members-list');
  renderMembersList(membersListEl);

  // Avatar ref
  const avatarEl = container.querySelector('#settings-avatar');

  // ─── Mino-only section visibility ─────────────────────────────────────────
  // Only Members has no GitHub gate — controlled directly here.
  // All other admin-only sections are gated by their own refresh functions
  // (refreshSummariesSection, etc.) which check isAdministrator().
  const membersSection = container.querySelector('.members-header')?.closest('.settings-section');
  const attendanceSection = container.querySelector('#attendance-section');

  function refreshAdminVisibility() {
    const isAdmin = Store.isAdministrator();
    if (membersSection) membersSection.style.display = isAdmin ? '' : 'none';
    if (attendanceSection) attendanceSection.style.display = isAdmin ? '' : 'none';
  }
  refreshAdminVisibility();

  // Current user select
  const userSelect = container.querySelector('#settings-user-select');
  userSelect.addEventListener('change', () => {
    Store.setCurrentUser(userSelect.value);
    updateAvatar(avatarEl);
    refreshAdminVisibility();
    showToast(userSelect.value ? `Switched to ${userSelect.value}` : 'User cleared');
  });
  membersListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.member-delete');
    if (!btn) return;
    const item = btn.closest('.member-item');
    const name = item.dataset.name;
    if (!confirm(`Remove "${name}" from members?`)) return;
    removeMember(name);
    renderMembersList(membersListEl);
    refreshUserSelect();
    showToast(`${name} removed`);
  });

  // Add member form
  const addForm = container.querySelector('#add-member-form');
  const nameInput = container.querySelector('#new-member-input');
  const addBtn = addForm.querySelector('button[type="submit"]');

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    if (name.length < 1 || name.length > 50) {
      showToast('Name must be 1–50 characters');
      return;
    }
    const existing = getMembers().map(m => m.toLowerCase());
    if (existing.includes(name.toLowerCase())) {
      showToast('Member already exists');
      return;
    }

    addBtn.disabled = true;
    addBtn.textContent = 'Adding…';
    try {
      await addPlayerToPlayersJson(name);
      addMember(name);
      nameInput.value = '';
      renderMembersList(membersListEl);
      refreshUserSelect();
      showToast(`${name} added`);
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = 'Add';
    }
  });

  function refreshUserSelect() {
    const current = Store.getCurrentUser();
    const updated = getMembers();
    userSelect.innerHTML = `<option value="">Select user…</option>` +
      updated.map(m => `<option value="${m}" ${m === current ? 'selected' : ''}>${m}</option>`).join('');
    updateAvatar(avatarEl);
  }

  // Add attendance dialog
  container.querySelector('#attendance-add-btn').addEventListener('click', () => {
    showManualAttendanceDialog();
  });

  // ─── GitHub Backend ───────────────────────────────────────────────────────

  const ghPat      = container.querySelector('#github-pat');
  const ghStatus   = container.querySelector('#github-status-msg');
  const ghSyncIcon = container.querySelector('#github-sync-icon');

  // Pre-fill saved PAT (owner/repo/basePath are hardcoded)
  const savedCfg = Store.getGitHubConfig();
  if (savedCfg) {
    ghPat.value = savedCfg.pat || '';
  }

  // Live sync icon updates
  function updateSyncIcon(status) {
    const map = { idle: '⬜', syncing: '🔄', success: '✅', error: '❌' };
    ghSyncIcon.textContent = map[status] || '⬜';
    ghSyncIcon.title = `Sync: ${status}`;
  }
  updateSyncIcon(getSyncStatus());
  const unsubscribe = onSyncStatus(updateSyncIcon);
  // Clean up listener when page is torn down (next navigation)
  window.addEventListener('hashchange', () => unsubscribe(), { once: true });

  function setGhStatusMsg(msg, isError = false) {
    ghStatus.textContent = msg;
    ghStatus.style.color = isError ? 'var(--color-danger, #ef4444)' : 'var(--color-success, #22c55e)';
  }

  // Save
  container.querySelector('#github-save-btn').addEventListener('click', () => {
    const pat = ghPat.value.trim();
    if (!pat) {
      setGhStatusMsg('Personal Access Token is required.', true);
      return;
    }
    Store.setGitHubConfig({ owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat, basePath: 'mexicano_v3/backup-data' });
    showToast('GitHub config saved — reloading…');
    location.reload();
  });

  // Test
  container.querySelector('#github-test-btn').addEventListener('click', async () => {
    const pat = ghPat.value.trim();
    if (!pat) {
      setGhStatusMsg('Enter a Personal Access Token before testing.', true);
      return;
    }
    // Temporarily save to let testConnection() read from Store
    Store.setGitHubConfig({ owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat, basePath: 'mexicano_v3/backup-data' });
    setGhStatusMsg('Testing connection…');
    updateSyncIcon('syncing');
    const result = await testConnection();
    updateSyncIcon(result.ok ? 'success' : 'error');
    setGhStatusMsg(result.message, !result.ok);
  });

  // Clear
  container.querySelector('#github-clear-btn').addEventListener('click', () => {
    Store.clearGitHubConfig();
    ghPat.value = '';
    setGhStatusMsg('Configuration cleared.');
    updateSyncIcon('idle');
    showToast('GitHub config cleared');
  });

  // ─── App Version ───────────────────────────────────────────────────────────

  container.querySelector('#app-refresh-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    showToast('Refreshing to latest version…');
    await refreshApp();
  });

  // ─── Telegram Alerts ───────────────────────────────────────────────────────

  const tgTestBtn  = container.querySelector('#tg-test-btn');
  const tgTestTournamentBtn = container.querySelector('#tg-test-tournament-btn');
  const tgStatus   = container.querySelector('#tg-status-msg');

  function setTgStatus(msg, isError = false) {
    tgStatus.textContent = msg;
    tgStatus.style.color = isError ? 'var(--color-danger, #ef4444)' : 'var(--color-success, #22c55e)';
  }

  async function refreshTgTestBtn() {
    tgTestBtn.disabled = false;
  }

  refreshTgTestBtn();
  tgTestBtn.addEventListener('click', async () => {
    tgTestBtn.disabled = true;
    setTgStatus('Requesting Telegram test alert…');
    try {
      await sendTelegramTestAlert();
      setTgStatus('Relay triggered. Check Telegram shortly.');
      showToast('Telegram test alert triggered');
    } catch (err) {
      setTgStatus(`Test alert failed: ${err.message}`, true);
      showToast('Telegram test alert failed', 'error');
    } finally {
      refreshTgTestBtn();
    }
  });

  tgTestTournamentBtn.addEventListener('click', async () => {
    tgTestTournamentBtn.disabled = true;
    setTgStatus('Requesting tournament group test alert…');
    try {
      await sendTournamentTestAlert();
      setTgStatus('Relay triggered. Check the tournament group shortly.');
      showToast('Tournament group test alert triggered');
    } catch (err) {
      setTgStatus(`Tournament test alert failed: ${err.message}`, true);
      showToast('Tournament group test alert failed', 'error');
    } finally {
      tgTestTournamentBtn.disabled = false;
    }
  });
}
