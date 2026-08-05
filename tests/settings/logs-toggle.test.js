/**
 * Logs toggle — admin setting to enable/disable the round Logs feature.
 * Store flag + logRoundResult gating + bottom-nav visibility.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

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

import { Store } from '../../js/store.js';
import { renderNav } from '../../js/components/nav.js';
import { logRoundResult, getRoundLog, clearRoundLog } from '../../js/services/round-log.js';
import ADMINISTRATORS from '../../data/administrators.json';

const hasLogs = (nav) => !!nav.querySelector('.nav-item[data-path="/logs"]');

const SAMPLE_TOURNAMENT = {
  tournamentDate: '2026-08-05',
  rounds: [
    {
      roundNumber: 1,
      matches: [
        { player1: 'A', player2: 'B', player3: 'C', player4: 'D', team1Score: 21, team2Score: 15 },
      ],
    },
  ],
};

beforeEach(() => {
  localStorageStub.clear();
  Store.setAdministrators([]);
  Store.setCurrentUser('');
});

describe('Store logs-enabled flag', () => {
  it('defaults to enabled when nothing stored', () => {
    expect(Store.isLogsEnabled()).toBe(true);
  });

  it('persists disabled state', () => {
    Store.setLogsEnabled(false);
    expect(Store.isLogsEnabled()).toBe(false);
  });

  it('persists re-enabled state', () => {
    Store.setLogsEnabled(false);
    Store.setLogsEnabled(true);
    expect(Store.isLogsEnabled()).toBe(true);
  });
});

describe('logRoundResult respects logs toggle', () => {
  beforeEach(() => {
    Store.setAdministrators(ADMINISTRATORS);
    Store.setCurrentUser('Mino');
    clearRoundLog();
  });

  it('logs when admin and logs enabled', () => {
    Store.setLogsEnabled(true);
    logRoundResult(SAMPLE_TOURNAMENT, 1);
    expect(getRoundLog().length).toBe(1);
  });

  it('does not log when logs disabled', () => {
    Store.setLogsEnabled(false);
    logRoundResult(SAMPLE_TOURNAMENT, 1);
    expect(getRoundLog().length).toBe(0);
  });
});

describe('Bottom nav — Logs tab gated by toggle', () => {
  beforeEach(() => {
    Store.setAdministrators(ADMINISTRATORS);
    Store.setCurrentUser('Mino');
  });

  it('shows Logs when admin and enabled', () => {
    Store.setLogsEnabled(true);
    const nav = renderNav();
    expect(hasLogs(nav)).toBe(true);
  });

  it('hides Logs when admin but disabled', () => {
    Store.setLogsEnabled(false);
    const nav = renderNav();
    expect(hasLogs(nav)).toBe(false);
  });

  it('re-renders to hide Logs when toggled off after render', () => {
    Store.setLogsEnabled(true);
    const nav = renderNav();
    expect(hasLogs(nav)).toBe(true);

    Store.setLogsEnabled(false);
    expect(hasLogs(nav)).toBe(false);
  });
});
