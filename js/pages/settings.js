import { Store } from '../store.js';
import { getMembers, addMember, removeMember } from '../services/members.js';
import { renderThemeToggle } from '../components/theme-toggle.js';
import { showToast } from '../components/toast.js';
import { testConnection, pushAll, pullAll, onSyncStatus, getSyncStatus } from '../services/github.js';

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
        <div class="settings-section-title">Members</div>
        <div id="members-list"></div>
        <form id="add-member-form" class="flex gap-sm mt-md">
          <input type="text" id="new-member-input" placeholder="New member name" maxlength="50" style="flex:1;" />
          <button type="submit" class="btn btn-primary">Add</button>
        </form>
      </div>

      <!-- Theme -->
      <div class="settings-section">
        <div class="settings-section-title">Theme</div>
        <div id="theme-toggle-container" class="flex items-center gap-sm">
          <span class="text-sm">Toggle light / dark mode</span>
        </div>
      </div>

      <!-- Data Management -->
      <div class="settings-section">
        <div class="settings-section-title">Data Management</div>
        <div class="flex flex-col gap-sm">
          <button id="export-btn" class="btn btn-secondary btn-block">📤 Export Data</button>
          <label class="btn btn-secondary btn-block" style="cursor:pointer;">
            📥 Import Data
            <input type="file" id="import-input" accept=".json" class="hidden" />
          </label>
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
          <input type="text"  id="github-owner"     placeholder="GitHub owner (user or org)" maxlength="100" />
          <input type="text"  id="github-repo"      placeholder="Repository name"             maxlength="100" />
          <input type="password" id="github-pat"    placeholder="Personal Access Token (PAT)" maxlength="255" autocomplete="off" />
          <input type="text"  id="github-base-path" placeholder="Base path for tournament files (e.g. backup-data)" maxlength="200" />
        </div>
        <div class="flex gap-sm mt-sm">
          <button id="github-save-btn"  class="btn btn-primary"    style="flex:1;">Save</button>
          <button id="github-test-btn"  class="btn btn-secondary"  style="flex:1;">Test</button>
          <button id="github-clear-btn" class="btn btn-ghost"      style="flex:1;">Clear</button>
        </div>
        <div id="github-status-msg" class="text-sm mt-sm" style="min-height:1.25rem;"></div>
        <div class="flex gap-sm mt-sm">
          <button id="github-push-btn" class="btn btn-secondary" style="flex:1;">⬆ Push All</button>
          <button id="github-pull-btn" class="btn btn-secondary" style="flex:1;">⬇ Pull All</button>
        </div>
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

  // Export
  container.querySelector('#export-btn').addEventListener('click', () => {
    const data = Store.exportAll();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `mexicano-backup-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data exported');
  });

  // Import
  container.querySelector('#import-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        Store.importAll(data);
        showToast('Data imported successfully');
        location.reload();
      } catch (err) {
        showToast('Invalid JSON file');
      }
    };
    reader.readAsText(file);
  });

  // ─── GitHub Backend ───────────────────────────────────────────────────────

  const ghOwner    = container.querySelector('#github-owner');
  const ghRepo     = container.querySelector('#github-repo');
  const ghPat      = container.querySelector('#github-pat');
  const ghBasePath = container.querySelector('#github-base-path');
  const ghStatus   = container.querySelector('#github-status-msg');
  const ghSyncIcon = container.querySelector('#github-sync-icon');

  // Pre-fill saved config
  const savedCfg = Store.getGitHubConfig();
  if (savedCfg) {
    ghOwner.value    = savedCfg.owner    || '';
    ghRepo.value     = savedCfg.repo     || '';
    ghPat.value      = savedCfg.pat      || '';
    ghBasePath.value = savedCfg.basePath || '';
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
    const owner    = ghOwner.value.trim();
    const repo     = ghRepo.value.trim();
    const pat      = ghPat.value.trim();
    const basePath = ghBasePath.value.trim().replace(/^\/|\/$/g, ''); // strip leading/trailing slashes
    if (!owner || !repo || !pat) {
      setGhStatusMsg('All three fields are required.', true);
      return;
    }
    Store.setGitHubConfig({ owner, repo, pat, basePath });
    setGhStatusMsg('Configuration saved.');
    showToast('GitHub config saved');
  });

  // Test
  container.querySelector('#github-test-btn').addEventListener('click', async () => {
    const owner    = ghOwner.value.trim();
    const repo     = ghRepo.value.trim();
    const pat      = ghPat.value.trim();
    const basePath = ghBasePath.value.trim().replace(/^\/|\/$/g, '');
    if (!owner || !repo || !pat) {
      setGhStatusMsg('Fill in all fields before testing.', true);
      return;
    }
    // Temporarily save to let testConnection() read from Store
    Store.setGitHubConfig({ owner, repo, pat, basePath });
    setGhStatusMsg('Testing connection…');
    updateSyncIcon('syncing');
    const result = await testConnection();
    updateSyncIcon(result.ok ? 'success' : 'error');
    setGhStatusMsg(result.message, !result.ok);
  });

  // Clear
  container.querySelector('#github-clear-btn').addEventListener('click', () => {
    Store.clearGitHubConfig();
    ghOwner.value    = '';
    ghRepo.value     = '';
    ghPat.value      = '';
    ghBasePath.value = '';
    setGhStatusMsg('Configuration cleared.');
    updateSyncIcon('idle');
    showToast('GitHub config cleared');
  });

  // Push All
  container.querySelector('#github-push-btn').addEventListener('click', async () => {
    if (!Store.getGitHubConfig()?.pat) {
      setGhStatusMsg('Save a valid config first.', true);
      return;
    }
    updateSyncIcon('syncing');
    setGhStatusMsg('Pushing to GitHub…');
    try {
      await pushAll((key, total, i) => setGhStatusMsg(`Pushing ${key}… (${i}/${total})`), { allMatchDates: true });
      updateSyncIcon('success');
      setGhStatusMsg('All data pushed successfully.');
      showToast('Pushed to GitHub ✅');
    } catch (e) {
      updateSyncIcon('error');
      setGhStatusMsg(e.message || 'Push failed', true);
      showToast('Push failed ❌');
    }
  });

  // Pull All
  container.querySelector('#github-pull-btn').addEventListener('click', async () => {
    if (!Store.getGitHubConfig()?.pat) {
      setGhStatusMsg('Save a valid config first.', true);
      return;
    }
    if (!confirm('Pull from GitHub? This will overwrite local data with what is in the repo.')) return;
    updateSyncIcon('syncing');
    setGhStatusMsg('Pulling from GitHub…');
    try {
      await pullAll((key, total, i) => setGhStatusMsg(`Pulling ${key}… (${i}/${total})`));
      updateSyncIcon('success');
      setGhStatusMsg('All data pulled successfully.');
      showToast('Pulled from GitHub ✅');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      updateSyncIcon('error');
      setGhStatusMsg(e.message || 'Pull failed', true);
      showToast('Pull failed ❌');
    }
  });
}
