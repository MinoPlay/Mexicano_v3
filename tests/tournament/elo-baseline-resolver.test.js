/**
 * ELO baseline resolver tests.
 *
 * Ending a tournament used to derive the pre-tournament ELO baseline by
 * replaying the ENTIRE match history, which forced a sequential GitHub read of
 * every tournament day file (the "End Tournament hangs" bug).
 *
 * Absolute ELO is already persisted, so the baseline is READ, not recomputed:
 *   1. local snapshot written by the previous completion   → 0 requests
 *   2. players_summary (players.json, already cached)      → 0 requests
 *   3. previous tournament day file (overlay, authoritative) → ≤1 request
 *   4. replay of locally cached matches                    → 0 requests
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const gh = vi.hoisted(() => ({
  readDayMatches: vi.fn(async () => []),
  ensureAllMatchesLoaded: vi.fn(async () => { throw new Error('must not pull full history'); }),
}));

vi.mock('../../js/services/github.js', () => ({
  schedulePush: vi.fn(),
  cancelPendingSync: vi.fn(),
  flushPush: vi.fn().mockResolvedValue(undefined),
  updateTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  markMatchDateDirty: vi.fn(),
  keyToPath: vi.fn().mockReturnValue(null),
  readFile: vi.fn().mockResolvedValue(null),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  pushTournamentDayFile: vi.fn().mockResolvedValue(true),
  pushCompletedTournament: vi.fn().mockResolvedValue(undefined),
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

import { resolveEloBaseline, ELO_BASELINE_KEY } from '../../js/services/tournament.js';
import { Store } from '../../js/store.js';
import { Cache } from '../../js/cache.js';

const TODAY = '2025-06-08';
const PREV = '2025-06-01';

beforeEach(() => {
  ls.clear();
  Cache.clear?.();
  gh.readDayMatches.mockReset();
  gh.readDayMatches.mockResolvedValue([]);
  Store.setTournamentsIndex([
    { date: PREV, isComplete: true },
    { date: '2025-05-25', isComplete: true },
  ]);
});

describe('resolveEloBaseline', () => {
  it('uses the local snapshot when it matches the previous tournament — no network', async () => {
    localStorage.setItem(ELO_BASELINE_KEY, JSON.stringify({
      date: PREV,
      elo: { Alice: 1120, Bob: 980 },
    }));
    Store.setPlayersSummaryCache([{ name: 'Alice', elo: 1 }, { name: 'Bob', elo: 2 }]);

    const { elo, source } = await resolveEloBaseline(TODAY);

    expect(source).toBe('snapshot');
    expect(elo.Alice).toBe(1120);
    expect(elo.Bob).toBe(980);
    expect(gh.readDayMatches).not.toHaveBeenCalled();
    expect(gh.ensureAllMatchesLoaded).not.toHaveBeenCalled();
  });

  it('falls back to players_summary and overlays the previous day file (1 read max)', async () => {
    Store.setPlayersSummaryCache([
      { name: 'Alice', elo: 1000 },
      { name: 'Bob', elo: 1000 },
      { name: 'Zoe', elo: 1234 },
    ]);
    // players.json is stale: it does not yet include the previous tournament.
    gh.readDayMatches.mockResolvedValue([
      {
        date: PREV, roundNumber: 1,
        team1Player1Name: 'Alice', team1Player2Name: 'Bob',
        team2Player1Name: 'Carol', team2Player2Name: 'Dave',
        scoreTeam1: 15, scoreTeam2: 10,
        team1Player1Elo: 1016, team1Player2Elo: 1016,
        team2Player1Elo: 984, team2Player2Elo: 984,
      },
    ]);

    const { elo } = await resolveEloBaseline(TODAY);

    expect(gh.readDayMatches).toHaveBeenCalledTimes(1);
    expect(gh.readDayMatches).toHaveBeenCalledWith(PREV, expect.anything());
    expect(elo.Alice).toBe(1016);   // overlay wins over stale summary
    expect(elo.Carol).toBe(984);    // player missing from summary is added
    expect(elo.Zoe).toBe(1234);     // untouched summary entries survive
    expect(gh.ensureAllMatchesLoaded).not.toHaveBeenCalled();
  });

  it('uses locally cached matches for the previous day instead of fetching', async () => {
    Store.setPlayersSummaryCache([{ name: 'Alice', elo: 1000 }]);
    Store.setMatches([
      {
        date: PREV, roundNumber: 1,
        team1Player1Name: 'Alice', team1Player2Name: 'Bob',
        team2Player1Name: 'Carol', team2Player2Name: 'Dave',
        scoreTeam1: 15, scoreTeam2: 10,
        team1Player1Elo: 1016, team1Player2Elo: 1016,
        team2Player1Elo: 984, team2Player2Elo: 984,
      },
    ]);

    const { elo } = await resolveEloBaseline(TODAY);

    expect(gh.readDayMatches).not.toHaveBeenCalled();
    expect(elo.Alice).toBe(1016);
  });

  it('replays locally cached matches when there is no summary and no day-file ELO', async () => {
    Store.setPlayersSummaryCache([]);
    Store.setTournamentsIndex([]);
    Store.setMatches([
      {
        date: PREV, roundNumber: 1,
        team1Player1Name: 'Alice', team1Player2Name: 'Bob',
        team2Player1Name: 'Carol', team2Player2Name: 'Dave',
        scoreTeam1: 15, scoreTeam2: 10,
      },
    ]);

    const { elo, source } = await resolveEloBaseline(TODAY);

    expect(source).toBe('local-replay');
    expect(elo.Alice).toBeGreaterThan(1000);
    expect(elo.Carol).toBeLessThan(1000);
    expect(gh.readDayMatches).not.toHaveBeenCalled();
  });

  it('never rejects — a failed day-file read degrades to the summary', async () => {
    Store.setPlayersSummaryCache([{ name: 'Alice', elo: 1100 }]);
    gh.readDayMatches.mockRejectedValue(new Error('Request timed out after 2000ms'));

    const { elo } = await resolveEloBaseline(TODAY);

    expect(elo.Alice).toBe(1100);
  });
});
