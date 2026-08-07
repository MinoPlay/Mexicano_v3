/**
 * Tournament delete tests.
 * A non-completed tournament can be deleted: it is removed from the in-memory
 * tournaments index, its match entities are purged from the Store, the active
 * tournament is cleared, and the remote index entry + date file are removed.
 * A completed tournament cannot be deleted.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mock dynamic imports used by store.js and tournament.js ───

const githubMock = vi.hoisted(() => ({
  schedulePush: vi.fn(),
  cancelPendingSync: vi.fn(),
  flushPush: vi.fn().mockResolvedValue(undefined),
  updateTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  removeTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  deleteTournamentDayFile: vi.fn().mockResolvedValue(undefined),
  markMatchDateDirty: vi.fn(),
  keyToPath: vi.fn().mockReturnValue(null),
  readFile: vi.fn().mockResolvedValue(null),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  ensureAllMatchesLoaded: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../js/services/github.js', () => githubMock);

vi.mock('../../js/services/local.js', () => ({
  writeTournamentDay: vi.fn().mockResolvedValue(undefined),
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

// ─── Imports after mocks/stubs ───

import {
  createTournament,
  startTournament,
  setMatchScore,
  deleteTournament,
} from '../../js/services/tournament.js';
import { Store } from '../../js/store.js';
import { State } from '../../js/state.js';

// ─── Helpers ───

const DATE = '2025-06-01';
const OTHER_DATE = '2025-05-01';
const PLAYERS_4 = ['Alice', 'Bob', 'Carol', 'Dave'];

function makeStartedTournament() {
  const t = createTournament(DATE, PLAYERS_4);
  startTournament(t);
  setMatchScore(t, 1, 1, 15, 10); // one completed match, tournament still not completed
  return t;
}

beforeEach(() => {
  localStorageStub.clear();
  State._listeners = {};
  githubMock.removeTournamentIndexEntry.mockClear();
  githubMock.deleteTournamentDayFile.mockClear();
});

describe('deleteTournament', () => {
  it('removes the entry from the in-memory tournaments index', async () => {
    makeStartedTournament();
    Store.setTournamentsIndex([
      { date: DATE, isComplete: false, playerCount: 4, roundCount: 1 },
      { date: OTHER_DATE, isComplete: true, playerCount: 4, roundCount: 3 },
    ]);

    await deleteTournament(DATE);

    const index = Store.getTournamentsIndex();
    expect(index.map(e => e.date)).toEqual([OTHER_DATE]);
  });

  it('purges match entities for that date from the Store', async () => {
    makeStartedTournament();
    // seed a match belonging to another date that must be kept
    const kept = Store.getMatches();
    kept.push({ date: OTHER_DATE, roundNumber: 1, _key: `${OTHER_DATE}_R1M1` });
    Store.setMatches(kept);

    await deleteTournament(DATE);

    const remaining = Store.getMatches();
    expect(remaining.every(m => m.date !== DATE)).toBe(true);
    expect(remaining.some(m => m.date === OTHER_DATE)).toBe(true);
  });

  it('clears the active tournament when it matches the deleted date', async () => {
    makeStartedTournament();

    await deleteTournament(DATE);

    expect(Store.getActiveTournament()).toBeNull();
  });

  it('leaves other tournaments untouched in the index', async () => {
    makeStartedTournament();
    Store.setTournamentsIndex([
      { date: DATE, isComplete: false, playerCount: 4, roundCount: 1 },
      { date: OTHER_DATE, isComplete: true, playerCount: 4, roundCount: 3 },
    ]);

    await deleteTournament(DATE);

    const index = Store.getTournamentsIndex();
    expect(index).toHaveLength(1);
    expect(index[0].date).toBe(OTHER_DATE);
  });

  it('throws when the tournament is completed (per index)', async () => {
    makeStartedTournament();
    Store.setTournamentsIndex([{ date: DATE, isComplete: true, playerCount: 4, roundCount: 3 }]);

    await expect(deleteTournament(DATE)).rejects.toThrow('Cannot delete a completed tournament');
  });

  it('throws for non-admin users', async () => {
    makeStartedTournament();
    Store.setCurrentUser('SomeGuest');

    await expect(deleteTournament(DATE)).rejects.toThrow('admin');
  });
});
