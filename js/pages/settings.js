import { Store } from '../store.js';
import { getMembers, addMember, removeMember } from '../services/members.js';
import { renderThemeToggle } from '../components/theme-toggle.js';
import { showToast } from '../components/toast.js';
import { testConnection, onSyncStatus, getSyncStatus, generatePlayersJson, generateMonthlyOverviews } from '../services/github.js';

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
        <details class="members-collapsible">
          <summary class="settings-section-title members-summary">Members</summary>
          <div id="members-list"></div>
          <form id="add-member-form" class="flex gap-sm mt-md">
            <input type="text" id="new-member-input" placeholder="New member name" maxlength="50" style="flex:1;" />
            <button type="submit" class="btn btn-primary">Add</button>
          </form>
        </details>
      </div>

      <!-- Theme -->
      <div class="settings-section">
        <div class="settings-section-title">Theme</div>
        <div id="theme-toggle-container" class="flex items-center gap-sm">
          <span class="text-sm">Toggle light / dark mode</span>
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
          <input type="text"  id="github-repo"      value="DataHub"                    disabled style="opacity:0.6;cursor:not-allowed;" />
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

      <!-- Remote Data Tools -->
      <div class="settings-section" id="remote-data-section" style="display:none;">
        <div class="settings-section-title">Remote Data Tools</div>
        <p class="text-sm text-secondary" style="margin-bottom:var(--space-sm);">
          Regenerate pre-computed data files in the GitHub repository.
          Reads all match files, recomputes stats &amp; ELO, and commits results directly to the repo.
        </p>
        <div class="flex flex-col gap-sm">
          <button id="gen-players-btn" class="btn btn-primary" style="width:100%;">Generate players.json</button>
          <div class="flex gap-sm">
            <input type="month" id="gen-overviews-month" style="flex:1;" />
            <button id="gen-overviews-btn" class="btn btn-secondary">Generate monthly overview</button>
          </div>
        </div>
        <div id="remote-data-status" class="text-sm mt-sm" style="min-height:1.25rem;"></div>
      </div>


      <div class="settings-section" id="player-summaries-section" style="display:none;">
        <div class="settings-section-title">Player Summary</div>
        <p class="text-sm text-secondary" style="margin-bottom:var(--space-sm);">
          Generate or update the statistics summary for the currently selected user.
          Required for the player profile dialog to show complete historical data.
        </p>
        <button id="generate-summaries-btn" class="btn btn-primary" style="width:100%;" disabled>Select a user first</button>
        <div id="summaries-status-msg" class="text-sm mt-sm" style="min-height:1.25rem;"></div>
      </div>

    </div>
  `;

  // Render members list
  const membersListEl = container.querySelector('#members-list');
  renderMembersList(membersListEl);

  // Theme toggle
  const themeContainer = container.querySelector('#theme-toggle-container');
  themeContainer.appendChild(renderThemeToggle());

  // Avatar ref
  const avatarEl = container.querySelector('#settings-avatar');

  // Current user select
  const userSelect = container.querySelector('#settings-user-select');
  userSelect.addEventListener('change', () => {
    Store.setCurrentUser(userSelect.value);
    updateAvatar(avatarEl);
    showToast(userSelect.value ? `Switched to ${userSelect.value}` : 'User cleared');
  });

  // Delete members
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

  addForm.addEventListener('submit', (e) => {
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
    addMember(name);
    nameInput.value = '';
    renderMembersList(membersListEl);
    refreshUserSelect();
    showToast(`${name} added`);
  });

  function refreshUserSelect() {
    const current = Store.getCurrentUser();
    const updated = getMembers();
    userSelect.innerHTML = `<option value="">Select user…</option>` +
      updated.map(m => `<option value="${m}" ${m === current ? 'selected' : ''}>${m}</option>`).join('');
    updateAvatar(avatarEl);
  }

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
    Store.setGitHubConfig({ owner: 'MinoPlay', repo: 'DataHub', pat, basePath: 'mexicano_v3/backup-data' });
    setGhStatusMsg('Configuration saved.');
    showToast('GitHub config saved');
  });

  // Test
  container.querySelector('#github-test-btn').addEventListener('click', async () => {
    const pat = ghPat.value.trim();
    if (!pat) {
      setGhStatusMsg('Enter a Personal Access Token before testing.', true);
      return;
    }
    // Temporarily save to let testConnection() read from Store
    Store.setGitHubConfig({ owner: 'MinoPlay', repo: 'DataHub', pat, basePath: 'mexicano_v3/backup-data' });
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

  // ─── Player Summaries ─────────────────────────────────────────────────────

  const summariesSection  = container.querySelector('#player-summaries-section');
  const summariesBtn      = container.querySelector('#generate-summaries-btn');
  const summariesStatus   = container.querySelector('#summaries-status-msg');

  function setSummariesMsg(msg, isError = false) {
    summariesStatus.textContent = msg;
    summariesStatus.style.color = isError ? 'var(--color-danger, #ef4444)' : 'var(--color-success, #22c55e)';
  }

  function refreshSummariesSection() {
    const hasGitHub = !!Store.getGitHubConfig()?.pat;
    summariesSection.style.display = hasGitHub ? '' : 'none';
    if (!hasGitHub) { setSummariesMsg(''); return; }
    updateSummariesBtn();
  }

  function updateSummariesBtn() {
    const user = Store.getCurrentUser();
    if (user) {
      summariesBtn.disabled = false;
      summariesBtn.textContent = `Generate / Update Summary for ${user}`;
    } else {
      summariesBtn.disabled = true;
      summariesBtn.textContent = 'Select a user first';
    }
  }

  refreshSummariesSection();

  // Keep button label in sync when user changes
  userSelect.addEventListener('change', updateSummariesBtn);

  summariesBtn.addEventListener('click', async () => {
    const user = Store.getCurrentUser();
    if (!user) return;
    summariesBtn.disabled = true;
    setSummariesMsg(`Processing ${user}…`);
    try {
      const { generateOrUpdatePlayerSummary } = await import('../services/github.js');
      const { newDates, upToDate } = await generateOrUpdatePlayerSummary(user, (label) => {
        setSummariesMsg(label);
      });
      if (upToDate) {
        setSummariesMsg(`${user}'s summary is already up to date.`);
        showToast('Summary already up to date');
      } else {
        setSummariesMsg(`Done! Added ${newDates} new tournament${newDates !== 1 ? 's' : ''} for ${user}.`);
        showToast(`Summary updated for ${user}`);
      }
    } catch (e) {
      setSummariesMsg(`Error: ${e.message}`, true);
      showToast('Failed to generate summary', 'error');
    } finally {
      updateSummariesBtn();
    }
  });

  // Show/hide summaries section when GitHub config changes
  container.querySelector('#github-save-btn').addEventListener('click', refreshSummariesSection, { capture: true });
  container.querySelector('#github-clear-btn').addEventListener('click', () => {
    summariesSection.style.display = 'none';
    setSummariesMsg('');
  }, { capture: true });

  // ─── Remote Data Tools ────────────────────────────────────────────────────

  const remoteDataSection  = container.querySelector('#remote-data-section');
  const genPlayersBtn      = container.querySelector('#gen-players-btn');
  const genOverviewsBtn    = container.querySelector('#gen-overviews-btn');
  const genOverviewsMonth  = container.querySelector('#gen-overviews-month');
  const remoteDataStatus   = container.querySelector('#remote-data-status');

  // Default month input to current month
  const now = new Date();
  genOverviewsMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  function setRemoteDataMsg(msg, isError = false) {
    remoteDataStatus.textContent = msg;
    remoteDataStatus.style.color = isError ? 'var(--color-danger, #ef4444)' : 'var(--color-success, #22c55e)';
  }

  function refreshRemoteDataSection() {
    remoteDataSection.style.display = Store.getGitHubConfig()?.pat ? '' : 'none';
  }
  refreshRemoteDataSection();

  function setRemoteBtnsDisabled(disabled) {
    genPlayersBtn.disabled   = disabled;
    genOverviewsBtn.disabled = disabled;
  }

  genPlayersBtn.addEventListener('click', async () => {
    setRemoteBtnsDisabled(true);
    setRemoteDataMsg('Loading match files…');
    try {
      const { written } = await generatePlayersJson((label) => setRemoteDataMsg(label));
      setRemoteDataMsg(`Done! players.json written with ${written} players.`);
      showToast('players.json generated');
    } catch (e) {
      setRemoteDataMsg(`Error: ${e.message}`, true);
      showToast('Failed to generate players.json', 'error');
    } finally {
      setRemoteBtnsDisabled(false);
    }
  });

  genOverviewsBtn.addEventListener('click', async () => {
    const month = genOverviewsMonth.value.trim();
    if (!month) {
      setRemoteDataMsg('Select a month first.', true);
      return;
    }
    setRemoteBtnsDisabled(true);
    setRemoteDataMsg('Loading match files…');
    try {
      const { month: written } = await generateMonthlyOverviews(month, (label) => setRemoteDataMsg(label));
      setRemoteDataMsg(`Done! players_overview.json written for ${month}.`);
      showToast(`Overview generated for ${month}`);
    } catch (e) {
      setRemoteDataMsg(`Error: ${e.message}`, true);
      showToast('Failed to generate overview', 'error');
    } finally {
      setRemoteBtnsDisabled(false);
    }
  });

  // Keep remote data section in sync with GitHub config changes
  container.querySelector('#github-save-btn').addEventListener('click', refreshRemoteDataSection, { capture: true });
  container.querySelector('#github-clear-btn').addEventListener('click', () => {
    remoteDataSection.style.display = 'none';
    setRemoteDataMsg('');
  }, { capture: true });
}
