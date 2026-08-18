/**
 * End Tournament — minimal network footprint.
 *
 * Repro for "End Tournament hangs": completion pulled the ENTIRE match history
 * (one sequential GitHub read per tournament date) and then pushed through the
 * shared debounced pushAll() queue.
 *
 * Completing a tournament must only:
 *   • resolve the ELO baseline without a full-history pull, and
 *   • write this tournament's day file + tournaments.json (queue-free).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const gh = vi.hoisted(() => ({
  ensureAllMatchesLoaded: vi.fn(async () => []),
  flushPush: vi.fn().mockResolvedValue(undefined),
  pushCompletedTournament: vi.fn().mockResolvedValue(undefined),
  updateTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  cancelPendingSync: vi.fn(),
  readDayMatches: vi.fn(async () => []),
}));

vi.mock('../../js/services/github.js', () => ({
  schedulePush: vi.fn(),
  cancelPendingSync: gh.cancelPendingSync,
  flushPush: gh.flushPush,
  updateTournamentIndexEntry: gh.updateTournamentIndexEntry,
  markMatchDateDirty: vi.fn(),
  keyToPath: vi.fn().mockReturnValue(null),
  readFile: vi.fn().mockResolvedValue(null),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  pushTournamentDayFile: vi.fn().mockResolvedValue(true),
  pushCompletedTournament: gh.pushCompletedTournament,
  readDayMatches: gh.readDayMatches,
  ensureAllMatchesLoaded: gh.ensureAllMatchesLoaded,
  FAST_TIMEOUTS: [2000, 3000],
}));

vi.mock('../../js/services/local.js', () => ({
  writeTournamentDay: vi.fn().mockResolvedValue(undefined),
  writeTournamentsIndex: vi.fn().mockResolvedValue(undefined),
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
const ls = makeLocalStorage();
vi.stubGlobal('localStorage', ls);

import {
  createTournament,
  startTournament,
  setMatchScore,
  completeTournament,
  ELO_BASELINE_KEY,
} from '../../js/services/tournament.js';
import { Store } from '../../js/store.js';
import { State } from '../../js/state.js';
import { Cache } from '../../js/cache.js';

const DATE = '2025-06-08';
const PLAYERS_4 = ['Alice', 'Bob', 'Carol', 'Dave'];

function makePlayedTournament() {
  const t = createTournament(DATE, PLAYERS_4);
  startTournament(t);
  setMatchScore(t, 1, 1, 15, 10);
  return t;
}

beforeEach(() => {
  ls.clear();
  Cache.clear?.();
  State._listeners = {};
  Object.values(gh).forEach(fn => fn.mockClear?.());
  gh.ensureAllMatchesLoaded.mockResolvedValue([]);
  gh.readDayMatches.mockResolvedValue([]);
  Store.setTournamentsIndex([{ date: '2025-06-01', isComplete: true }]);
  Store.setPlayersSummaryCache(PLAYERS_4.map(name => ({ name, elo: 1000 })));
  localStorage.setItem(ELO_BASELINE_KEY, JSON.stringify({
    date: '2025-06-01',
    elo: { Alice: 1000, Bob: 1000, Carol: 1000, Dave: 1000 },
  }));
});

describe('completeTournament network footprint', () => {
  it('never pulls the full match history', async () => {
    const t = makePlayedTournament();
    await completeTournament(t, () => {});

    expect(gh.ensureAllMatchesLoaded).not.toHaveBeenCalled();
    expect(gh.readDayMatches).not.toHaveBeenCalled();
  });

  it('pushes only the day file + index, bypassing the debounced pushAll queue', async () => {
    const t = makePlayedTournament();
    await completeTournament(t, () => {});

    expect(gh.flushPush).not.toHaveBeenCalled();
    expect(gh.pushCompletedTournament).toHaveBeenCalledTimes(1);

    const [date, dayMatches, indexEntry] = gh.pushCompletedTournament.mock.calls[0];
    expect(date).toBe(DATE);
    expect(dayMatches.every(m => m.date === DATE)).toBe(true);
    expect(dayMatches.length).toBe(1);
    expect(indexEntry).toMatchObject({ date: DATE, isComplete: true, matchCount: 1 });
  });

  it('embeds ELO derived from the baseline, not from a full replay', async () => {
    const t = makePlayedTournament();
    await completeTournament(t, () => {});

    const [, dayMatches] = gh.pushCompletedTournament.mock.calls[0];
    const m = dayMatches[0];
    // Winners gain, losers lose, starting from the 1000 baseline.
    expect(m.team1Player1Elo).toBeGreaterThan(1000);
    expect(m.team2Player1Elo).toBeLessThan(1000);
  });

  it('writes an ELO snapshot so the next completion needs zero extra reads', async () => {
    const t = makePlayedTournament();
    await completeTournament(t, () => {});

    const snapshot = JSON.parse(localStorage.getItem(ELO_BASELINE_KEY));
    expect(snapshot.date).toBe(DATE);
    expect(snapshot.elo.Alice).toBeGreaterThan(1000);
    expect(snapshot.elo.Carol).toBeLessThan(1000);
  });

  it('clears local tournament data once the push succeeds', async () => {
    const t = makePlayedTournament();
    await completeTournament(t, () => {});

    expect(Store.getActiveTournament()).toBeNull();
    expect(localStorage.getItem('mexicano_completion_marker')).toBeNull();
  });

  it('keeps local data for retry when the push fails', async () => {
    gh.pushCompletedTournament.mockRejectedValueOnce(new Error('Request timed out after 2000ms'));
    const t = makePlayedTournament();

    await expect(completeTournament(t, () => {})).rejects.toThrow(/timed out/i);

    expect(Store.getActiveTournament()).not.toBeNull();
    expect(localStorage.getItem('mexicano_completion_marker')).toBe(DATE);
  });
});
