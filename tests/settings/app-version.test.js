/**
 * Settings — App Version section + Refresh button.
 * Settings page must render:
 *   - #app-version showing the version label "mexicano-v3"
 *   - #app-refresh-btn button to pull the latest version
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../js/services/members.js', () => ({
  getMembers: vi.fn(() => ['Mino', 'Alice']),
  addMember: vi.fn(),
  removeMember: vi.fn(),
}));

vi.mock('../../js/services/github.js', () => ({
  testConnection: vi.fn().mockResolvedValue({ ok: true, message: '' }),
  onSyncStatus: vi.fn(() => () => {}),
  getSyncStatus: vi.fn(() => 'idle'),
  pushDoodleNow: vi.fn(),
  addPlayerToPlayersJson: vi.fn().mockResolvedValue(undefined),
  schedulePush: vi.fn(),
}));

vi.mock('../../js/components/install-prompt.js', () => ({
  isInstalled: vi.fn(() => false),
}));

vi.mock('../../js/services/telegram.js', () => ({
  sendTelegramTestAlert: vi.fn().mockResolvedValue(undefined),
  sendTournamentTestAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../js/components/toast.js', () => ({
  showToast: vi.fn(),
}));

vi.mock('../../js/components/manual-attendance-dialog.js', () => ({
  showManualAttendanceDialog: vi.fn(),
}));

// ─── In-memory localStorage stub ───
function makeLocalStorage() {
  let store = {};
  return {
    getItem: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}
const localStorageStub = makeLocalStorage();
vi.stubGlobal('localStorage', localStorageStub);

import { renderSettings } from '../../js/pages/settings.js';
import { Store } from '../../js/store.js';
import { APP_VERSION, getVersionLabel } from '../../js/version.js';
import ADMINISTRATORS from '../../data/administrators.json';

beforeEach(() => {
  localStorageStub.clear();
  Store.setAdministrators(ADMINISTRATORS);
});

describe('Settings — App Version', () => {
  it('exposes integer version and label from js/version.js', () => {
    expect(Number.isInteger(APP_VERSION)).toBe(true);
    expect(APP_VERSION).toBeGreaterThan(0);
    expect(getVersionLabel()).toBe(`mexicano-v${APP_VERSION}`);
  });

  it('renders the version label as the refresh button #app-refresh-btn', () => {
    const container = document.createElement('div');
    renderSettings(container, {});

    const btn = container.querySelector('#app-refresh-btn');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain(getVersionLabel());
  });

  it('sw.js declares APP_VERSION and version.js imports it (single source of truth)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sw = fs.readFileSync(path.resolve(process.cwd(), 'sw.js'), 'utf8');
    const ver = fs.readFileSync(path.resolve(process.cwd(), 'js/version.js'), 'utf8');
    expect(sw).toMatch(/export\s+const\s+APP_VERSION\s*=\s*\d+/);
    expect(sw).toMatch(/CACHE_NAME\s*=\s*[`'"]mexicano-v\$\{APP_VERSION\}/);
    expect(ver).toMatch(/import\s*\{\s*APP_VERSION\s*\}\s*from\s*['"]\.\.\/sw\.js['"]/);
  });
});


