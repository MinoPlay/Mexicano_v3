/**
 * Home header — version label + refresh action.
 * Home page header must render:
 *   - #home-title showing "🎾 Mexicano v<APP_VERSION>"
 *   - #app-refresh-btn (refresh icon) inside the header that calls refreshApp()
 * Settings page must no longer render #app-refresh-btn.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const { refreshAppMock } = vi.hoisted(() => ({
  refreshAppMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../js/version.js', () => ({
  APP_VERSION: 42,
  getVersionLabel: () => 'mexicano-v42',
  refreshApp: refreshAppMock,
}));

vi.mock('../../js/services/tournament.js', () => ({
  getActiveTournament: vi.fn(() => null),
  getLatestCompleteTournamentDate: vi.fn(() => null),
  confirmAttendanceAndPush: vi.fn(),
}));

vi.mock('../../js/services/members.js', () => ({
  getMembers: vi.fn(() => []),
}));

vi.mock('../../js/services/statistics.js', () => ({
  calculatePlayerStatistics: vi.fn(() => []),
}));

vi.mock('../../js/services/elo.js', () => ({
  calculateAllEloRankings: vi.fn(() => []),
  getEloSnapshots: vi.fn(() => ({ snapshots: [] })),
  getEloForDate: vi.fn(() => ({})),
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

import { renderHome } from '../../js/pages/home.js';

beforeEach(() => {
  localStorageStub.clear();
  refreshAppMock.mockClear();
});

describe('Home header — version + refresh', () => {
  it('renders the title with the version number', () => {
    const container = document.createElement('div');
    renderHome(container, {});

    const title = container.querySelector('#home-title');
    expect(title).not.toBeNull();
    expect(title.textContent).toContain('Mexicano v42');
  });

  it('renders a refresh button inside the title that calls refreshApp()', async () => {
    const container = document.createElement('div');
    renderHome(container, {});

    const btn = container.querySelector('#home-title #app-refresh-btn');
    expect(btn).not.toBeNull();

    btn.click();
    await Promise.resolve();
    expect(refreshAppMock).toHaveBeenCalled();
  });
});
