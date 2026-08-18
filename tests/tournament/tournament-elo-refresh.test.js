/**
 * After a tournament is completed, the cached players summary (source of ELO for
 * the Home "Latest Tournament" table and Statistics) must be refreshed with the
 * freshly computed ELO values — without requiring a manual app refresh.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const eloFixture = vi.hoisted(() => ({ full: [] }));

vi.mock('../../js/services/github.js', () => ({
  schedulePush: vi.fn(),
  cancelPendingSync: vi.fn(),
  flushPush: vi.fn().mockResolvedValue(undefined),
  updateTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  markMatchDateDirty: vi.fn(),
  keyToPath: vi.fn().mockReturnValue(null),
  readFile: vi.fn().mockResolvedValue(null),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  pushTournamentDayFile: vi.fn().mockResolvedValue(undefined),
  ensureAllMatchesLoaded: vi.fn(async () => eloFixture.full.map(m => ({ ...m }))),
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

const localStorageStub = makeLocalStorage();
vi.stubGlobal('localStorage', localStorageStub);

import {
  createTournament,
  startTournament,
  setMatchScore,
  completeTournament,
} from '../../js/services/tournament.js';
import { Store } from '../../js/store.js';
import { State } from '../../js/state.js';
import { Cache } from '../../js/cache.js';

const DATE = '2025-07-01';
const PLAYERS_4 = ['Alice', 'Bob', 'Carol', 'Dave'];

beforeEach(() => {
  localStorageStub.clear();
  Cache.keys('').forEach(k => Cache.del(k));
  State._listeners = {};
  eloFixture.full = [];
});

describe('players summary refresh after tournament completion', () => {
  it('updates cached elo/previousElo with the newly computed values', async () => {
    // Stale cache: everyone at 1000 with an outdated previous value
    Store.setPlayersSummaryCache([
      { name: 'Alice', elo: 1000, previousElo: 950 },
      { name: 'Bob', elo: 1000, previousElo: 950 },
      { name: 'Carol', elo: 1000, previousElo: 950 },
      { name: 'Dave', elo: 1000, previousElo: 950 },
      { name: 'Zoe', elo: 1234, previousElo: 1200 },
    ]);

    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);
    setMatchScore(t, 1, 1, 15, 10);

    const match = t.rounds[0].matches[0];
    const winners = [match.player1.name, match.player2.name];
    const losers = [match.player3.name, match.player4.name];

    await completeTournament(t);

    const summary = Store.getPlayersSummary();
    const byName = Object.fromEntries(summary.map(p => [p.name, p]));

    for (const name of winners) {
      expect(byName[name].elo).toBe(1016);
      expect(byName[name].previousElo).toBe(1000);
    }
    for (const name of losers) {
      expect(byName[name].elo).toBe(984.74);
      expect(byName[name].previousElo).toBe(1000);
    }

    // Non-participants untouched
    expect(byName['Zoe'].elo).toBe(1234);
    expect(byName['Zoe'].previousElo).toBe(1200);
  });

  it('adds summary entries for players missing from the cached summary', async () => {
    Store.setPlayersSummaryCache([{ name: 'Zoe', elo: 1234, previousElo: 1200 }]);

    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);
    setMatchScore(t, 1, 1, 15, 10);

    await completeTournament(t);

    const summary = Store.getPlayersSummary();
    const names = summary.map(p => p.name).sort();
    expect(names).toEqual(['Alice', 'Bob', 'Carol', 'Dave', 'Zoe']);
  });
});
