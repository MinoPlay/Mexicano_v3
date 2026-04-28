import { Store } from '../store.js';
import { getMembers, addMember, removeMember } from '../services/members.js';
import { renderThemeToggle } from '../components/theme-toggle.js';
import { showToast } from '../components/toast.js';
import { testConnection, onSyncStatus, getSyncStatus, readFile, pushDoodleNow } from '../services/github.js';
import { writeDoodle } from '../services/local.js';
import { State } from '../state.js';
import { generatePlayersJson } from '../scripts/generate-players-json.js';
import { generateEloHistory } from '../scripts/generate-elo-history.js';
import { generateMonthlyOverviews } from '../scripts/generate-monthly-overviews.js';
import { generateOrUpdatePlayerSummary } from '../scripts/generate-player-summary.js';
import { uploadToAzure } from '../scripts/azure-upload.js';
import { syncDoodleFromAzure } from '../scripts/azure-doodle-sync.js';

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
          <p class="text-sm text-secondary" style="margin:0;">
            Reads all monthly <code>backup-data/YYYY/YYYY-MM/players_overview.json</code> files, sums stats across months per player, and writes <code>backup-data/players.json</code>. Full rebuild — requires all monthly overviews to be up to date first.
          </p>
          <button id="gen-players-btn" class="btn btn-primary" style="width:100%;">Generate players.json</button>
          <p class="text-sm text-secondary" style="margin:0;">
            Reads all day-match files and replays the full ELO timeline from the beginning. Writes <code>backup-data/elo_history.json</code> with a per-player ELO value for every tournament date. Always a full rebuild.
          </p>
          <button id="gen-elo-history-btn" class="btn btn-secondary" style="width:100%;">Generate elo_history.json</button>
          <p class="text-sm text-secondary" style="margin:0;">
            Reads day-match files for the selected month (<code>backup-data/YYYY/YYYY-MM/*.json</code>), seeds starting ELO from the previous month's <code>players_overview.json</code>, and writes <code>backup-data/YYYY/YYYY-MM/players_overview.json</code>.
          </p>
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

      <!-- Azure Doodle Sync -->
      <div class="settings-section" id="azure-doodle-section" style="display:none;">
        <details id="azure-doodle-details">
          <summary class="settings-section-title members-summary">Azure Doodle Sync</summary>
          <p class="text-sm text-secondary" style="margin:var(--space-sm) 0;">
            Pull doodle availability from the Azure <code>Doodle</code> table and overwrite the
            local doodle JSON for the selected month. Uses the same connection string as Azure Upload.
          </p>
          <div class="flex flex-col gap-sm">
            <label class="text-sm" for="azure-doodle-month">Month</label>
            <div class="flex gap-sm">
              <input type="month" id="azure-doodle-month" style="flex:1;" />
              <button id="azure-doodle-sync-btn" class="btn btn-primary">Sync from Azure</button>
            </div>
          </div>
          <div id="azure-doodle-status" class="text-sm mt-sm" style="min-height:1.25rem;"></div>
        </details>
      </div>

      <!-- Azure Upload -->
      <div class="settings-section" id="azure-upload-section" style="display:none;">
        <details id="azure-upload-details">
          <summary class="settings-section-title members-summary">Azure Upload</summary>
          <p class="text-sm text-secondary" style="margin:var(--space-sm) 0;">
            Upload a backup JSON file directly to Azure Tables storage.
            Enter the backup date, save your connection string, then click Upload.
          </p>
          <div class="flex flex-col gap-sm">
            <label class="text-sm" for="azure-conn-str">Connection String</label>
            <div class="flex gap-sm">
              <input type="password" id="azure-conn-str" placeholder="DefaultEndpointsProtocol=https;AccountName=…" style="flex:1;" autocomplete="off" />
              <button id="azure-conn-save-btn" class="btn btn-primary">Save</button>
            </div>
            <label class="text-sm" for="azure-date-input">Backup Date</label>
            <div class="flex gap-sm">
              <input type="text" id="azure-date-input" placeholder="2026-04-28" style="flex:1;" autocomplete="off" />
              <button id="azure-upload-btn" class="btn btn-primary">Upload</button>
            </div>
          </div>
          <div id="azure-upload-status" class="text-sm mt-sm" style="min-height:1.25rem;"></div>
        </details>
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
  const genEloHistoryBtn   = container.querySelector('#gen-elo-history-btn');
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
    genPlayersBtn.disabled    = disabled;
    genEloHistoryBtn.disabled = disabled;
    genOverviewsBtn.disabled  = disabled;
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

  genEloHistoryBtn.addEventListener('click', async () => {
    setRemoteBtnsDisabled(true);
    setRemoteDataMsg('Loading match files…');
    try {
      const { written } = await generateEloHistory((label) => setRemoteDataMsg(label));
      localStorage.removeItem('mexicano_elo_history');
      setRemoteDataMsg(`Done! elo_history.json written with ${written} players.`);
      showToast('elo_history.json generated');
    } catch (e) {
      setRemoteDataMsg(`Error: ${e.message}`, true);
      showToast('Failed to generate elo_history.json', 'error');
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

  // ─── Azure Upload ──────────────────────────────────────────────────────────

  const azureSection   = container.querySelector('#azure-upload-section');
  const azureConnInput = container.querySelector('#azure-conn-str');
  const azureConnSave  = container.querySelector('#azure-conn-save-btn');
  const azureDateInput = container.querySelector('#azure-date-input');
  const azureUploadBtn = container.querySelector('#azure-upload-btn');
  const azureStatus    = container.querySelector('#azure-upload-status');

  const AZURE_CONN_KEY = 'mexicano_azure_conn_str';

  function setAzureStatus(msg, isError = false) {
    azureStatus.textContent = msg;
    azureStatus.style.color = isError ? 'var(--color-danger, #ef4444)' : 'var(--color-success, #22c55e)';
  }

  function refreshAzureSection() {
    azureSection.style.display = Store.getGitHubConfig()?.pat ? '' : 'none';
  }
  refreshAzureSection();

  const savedConn = localStorage.getItem(AZURE_CONN_KEY);
  if (savedConn) azureConnInput.value = savedConn;

  function dateToRepoPath(date) {
    const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const [, year, month] = m;
    return `mexicano_v3/backup-data/${year}/${year}-${month}/${date}.json`;
  }

  azureConnSave.addEventListener('click', () => {
    const conn = azureConnInput.value.trim();
    if (!conn) { setAzureStatus('Enter a connection string first.', true); return; }
    localStorage.setItem(AZURE_CONN_KEY, conn);
    setAzureStatus('Connection string saved.');
  });

  azureDateInput.addEventListener('input', () => setAzureStatus(''));

  azureUploadBtn.addEventListener('click', async () => {
    const conn = azureConnInput.value.trim();
    const date = azureDateInput.value.trim();

    if (!conn) { setAzureStatus('Enter a connection string first.', true); return; }
    if (!date) { setAzureStatus('Enter a backup date first.', true); return; }

    const repoPath = dateToRepoPath(date);
    if (!repoPath) { setAzureStatus('Invalid date format (use YYYY-MM-DD).', true); return; }

    azureUploadBtn.disabled = true;
    setAzureStatus('Loading backup from GitHub…');

    try {
      const result = await readFile(repoPath);
      if (!result) { setAzureStatus(`File not found: ${repoPath}`, true); return; }

      const total = await uploadToAzure(conn, result.content, (uploaded, total) => {
        setAzureStatus(`Uploading ${uploaded} / ${total}…`);
      });

      setAzureStatus(`Done — ${total} entities uploaded.`);
    } catch (err) {
      setAzureStatus(`Upload failed: ${err.message}`, true);
    } finally {
      azureUploadBtn.disabled = false;
    }
  });

  // Show/hide Azure section when GitHub config changes
  container.querySelector('#github-save-btn').addEventListener('click', refreshAzureSection, { capture: true });
  container.querySelector('#github-clear-btn').addEventListener('click', () => {
    azureSection.style.display = 'none';
  }, { capture: true });

  // ─── Azure Doodle Sync ─────────────────────────────────────────────────────

  const azureDoodleSection  = container.querySelector('#azure-doodle-section');
  const azureDoodleMonth    = container.querySelector('#azure-doodle-month');
  const azureDoodleSyncBtn  = container.querySelector('#azure-doodle-sync-btn');
  const azureDoodleStatus   = container.querySelector('#azure-doodle-status');

  const now2 = new Date();
  azureDoodleMonth.value = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}`;

  function setDoodleSyncStatus(msg, isError = false) {
    azureDoodleStatus.textContent = msg;
    azureDoodleStatus.style.color = isError ? 'var(--color-danger, #ef4444)' : 'var(--color-success, #22c55e)';
  }

  function refreshAzureDoodleSection() {
    azureDoodleSection.style.display = Store.getGitHubConfig()?.pat ? '' : 'none';
  }
  refreshAzureDoodleSection();

  azureDoodleSyncBtn.addEventListener('click', async () => {
    const conn = localStorage.getItem(AZURE_CONN_KEY) || '';
    const ym   = azureDoodleMonth.value.trim();

    if (!conn) { setDoodleSyncStatus('No Azure connection string saved. Enter it in Azure Upload first.', true); return; }
    if (!ym)   { setDoodleSyncStatus('Select a month first.', true); return; }

    const [year, month] = ym.split('-').map(Number);

    azureDoodleSyncBtn.disabled = true;
    setDoodleSyncStatus('');

    try {
      const entries = await syncDoodleFromAzure(conn, ym, msg => setDoodleSyncStatus(msg));

      Store.setDoodle(ym, entries);

      setDoodleSyncStatus('Writing to GitHub…');
      await pushDoodleNow(ym);

      await writeDoodle(year, month, entries).catch(() => {});

      State.emit('doodle-changed', { year, month });

      const total = entries.reduce((s, e) => s + e.selectedDates.length, 0);
      setDoodleSyncStatus(`Done — ${entries.length} player(s), ${total} selection(s) synced for ${ym}.`);
      showToast(`Doodle synced for ${ym}`);
    } catch (err) {
      setDoodleSyncStatus(`Sync failed: ${err.message}`, true);
      showToast('Doodle sync failed', 'error');
    } finally {
      azureDoodleSyncBtn.disabled = false;
    }
  });

  container.querySelector('#github-save-btn').addEventListener('click', refreshAzureDoodleSection, { capture: true });
  container.querySelector('#github-clear-btn').addEventListener('click', () => {
    azureDoodleSection.style.display = 'none';
  }, { capture: true });
}
