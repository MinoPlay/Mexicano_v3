/**
 * Attendance confirmation tests.
 * A player (admin OR non-admin) can confirm their own attendance for the active
 * tournament. Confirmation is stored on the tournament.players[] entry as
 * `confirmed: true` and persisted via saveTournamentState (which pushes the day file).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const githubMock = vi.hoisted(() => ({
  schedulePush: vi.fn(),
  cancelPendingSync: vi.fn(),
  flushPush: vi.fn().mockResolvedValue(undefined),
  updateTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  markMatchDateDirty: vi.fn(),
  keyToPath: vi.fn().mockReturnValue(null),
  readFile: vi.fn().mockResolvedValue(null),
  ensureAllMatchesLoaded: vi.fn().mockResolvedValue([]),
  pushTournamentDayFile: vi.fn().mockResolvedValue(true),
  dispatchConfirmAttendance: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../js/services/github.js', () => githubMock);
vi.mock('../../js/services/local.js', () => ({
  writeTournamentDay: vi.fn().mockResolvedValue(undefined),
}));

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

import {
  createTournament,
  startTournament,
  markPlayerConfirmed,
  confirmAttendance,
  confirmAttendanceAndPush,
} from '../../js/services/tournament.js';
import { Store } from '../../js/store.js';
import { State } from '../../js/state.js';

const DATE = '2025-06-01';
const PLAYERS_4 = ['Alice', 'Bob', 'Carol', 'Dave'];

function makeStarted() {
  const t = createTournament(DATE, PLAYERS_4);
  startTournament(t);
  return t;
}

beforeEach(() => {
  localStorageStub.clear();
  State._listeners = {};
  githubMock.markMatchDateDirty.mockClear();
  githubMock.cancelPendingSync.mockClear();
  githubMock.pushTournamentDayFile.mockClear();
  githubMock.pushTournamentDayFile.mockResolvedValue(true);
  githubMock.dispatchConfirmAttendance.mockClear();
  githubMock.dispatchConfirmAttendance.mockResolvedValue(true);
});

// ─── markPlayerConfirmed (pure) ───

describe('markPlayerConfirmed', () => {
  it('sets confirmed:true on the matching player', () => {
    const t = createTournament(DATE, PLAYERS_4);
    const { changed } = markPlayerConfirmed(t, 'Bob');
    expect(changed).toBe(true);
    const bob = t.players.find(p => p.name === 'Bob');
    expect(bob.confirmed).toBe(true);
  });

  it('matches case-insensitively', () => {
    const t = createTournament(DATE, PLAYERS_4);
    const { changed } = markPlayerConfirmed(t, 'aLiCe');
    expect(changed).toBe(true);
    expect(t.players.find(p => p.name === 'Alice').confirmed).toBe(true);
  });

  it('does not touch other players', () => {
    const t = createTournament(DATE, PLAYERS_4);
    markPlayerConfirmed(t, 'Bob');
    expect(t.players.find(p => p.name === 'Alice').confirmed).toBeFalsy();
    expect(t.players.find(p => p.name === 'Carol').confirmed).toBeFalsy();
  });

  it('is a no-op when the name is not a player', () => {
    const t = createTournament(DATE, PLAYERS_4);
    const { changed } = markPlayerConfirmed(t, 'Zoe');
    expect(changed).toBe(false);
    expect(t.players.every(p => !p.confirmed)).toBe(true);
  });

  it('is a no-op when already confirmed', () => {
    const t = createTournament(DATE, PLAYERS_4);
    markPlayerConfirmed(t, 'Bob');
    const { changed } = markPlayerConfirmed(t, 'Bob');
    expect(changed).toBe(false);
  });
});

// ─── confirmAttendance (service) ───

describe('confirmAttendance', () => {
  it('confirms for a non-admin user without throwing', () => {
    makeStarted();
    Store.setCurrentUser('Bob'); // non-admin

    const changed = confirmAttendance('Bob');

    expect(changed).toBe(true);
    const active = Store.getActiveTournament();
    expect(active.players.find(p => p.name === 'Bob').confirmed).toBe(true);
  });

  it('persists confirmation to the active tournament in the Store', () => {
    makeStarted();
    confirmAttendance('Carol');
    const active = Store.getActiveTournament();
    expect(active.players.find(p => p.name === 'Carol').confirmed).toBe(true);
  });

  it('returns false when there is no active tournament', () => {
    Store.clearActiveTournament();
    expect(confirmAttendance('Bob')).toBe(false);
  });

  it('returns false when the name is not in the tournament', () => {
    makeStarted();
    expect(confirmAttendance('Zoe')).toBe(false);
  });

  it('returns false when already confirmed', () => {
    makeStarted();
    confirmAttendance('Alice');
    expect(confirmAttendance('Alice')).toBe(false);
  });
});

// ─── confirmAttendanceAndPush (dispatch to confirm-attendance workflow) ───
// Regression: confirmation used to push the day file directly from the
// browser. It now fires a repository_dispatch(confirm_attendance) instead —
// the data-repo workflow performs the actual day-file update + commit.

describe('confirmAttendanceAndPush', () => {
  it('dispatches a confirm_attendance event for the active tournament date', async () => {
    makeStarted();
    const result = await confirmAttendanceAndPush('Bob');

    expect(result.changed).toBe(true);
    expect(githubMock.dispatchConfirmAttendance).toHaveBeenCalledTimes(1);
    expect(githubMock.dispatchConfirmAttendance).toHaveBeenCalledWith(DATE, 'Bob');
  });

  it('does not dispatch when nothing changed', async () => {
    makeStarted();
    const result = await confirmAttendanceAndPush('Zoe'); // not a player
    expect(result.changed).toBe(false);
    expect(githubMock.dispatchConfirmAttendance).not.toHaveBeenCalled();
  });

  it('rejects when the dispatch fails so the caller can withhold the alert', async () => {
    makeStarted();
    githubMock.dispatchConfirmAttendance.mockRejectedValueOnce(new Error('network down'));
    await expect(confirmAttendanceAndPush('Carol')).rejects.toThrow('network down');
  });
});
