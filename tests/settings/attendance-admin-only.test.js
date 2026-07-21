/**
 * Settings — Attendance section is admin-only.
 * The "Add Attendance" section (#attendance-section) must only be visible
 * when the current user is an administrator (Store.isAdministrator()).
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
import ADMINISTRATORS from '../../data/administrators.json';

beforeEach(() => {
  localStorageStub.clear();
  Store.setAdministrators(ADMINISTRATORS);
});

describe('Settings — Attendance section visibility', () => {
  it('hides Add Attendance for non-admin user', () => {
    Store.setCurrentUser('Alice');
    expect(Store.isAdministrator()).toBe(false);

    const container = document.createElement('div');
    renderSettings(container, {});

    const section = container.querySelector('#attendance-section');
    expect(section).not.toBeNull();
    expect(section.style.display).toBe('none');
  });

  it('shows Add Attendance for administrator', () => {
    Store.setCurrentUser('Mino');
    expect(Store.isAdministrator()).toBe(true);

    const container = document.createElement('div');
    renderSettings(container, {});

    const section = container.querySelector('#attendance-section');
    expect(section).not.toBeNull();
    expect(section.style.display).not.toBe('none');
  });

  it('toggles Add Attendance visibility when switching users', () => {
    Store.setCurrentUser('Mino');
    const container = document.createElement('div');
    renderSettings(container, {});

    const section = container.querySelector('#attendance-section');
    expect(section.style.display).not.toBe('none');

    const select = container.querySelector('#settings-user-select');
    select.value = 'Alice';
    select.dispatchEvent(new Event('change'));

    expect(section.style.display).toBe('none');
  });
});
