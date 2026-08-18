/**
 * Tournament lifecycle tests.
 * Verifies that Store (localStorage) and State events are correctly updated
 * when a tournament is created, updated, and ended.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mock dynamic imports used by store.js and tournament.js ───

// Holds the "full" match history that ensureAllMatchesLoaded resolves with.
// Defined via vi.hoisted so it is safely available inside the hoisted vi.mock factory.
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
  pushTournamentDayFile: vi.fn().mockResolvedValue(true),
  pushCompletedTournament: vi.fn().mockResolvedValue(undefined),
  readDayMatches: vi.fn(async (date) => eloFixture.full.filter(m => m.date === date).map(m => ({ ...m }))),
  FAST_TIMEOUTS: [2000, 3000],
  // Return a fresh copy each call so completeTournament appending entities
  // never mutates the shared fixture between runs.
  ensureAllMatchesLoaded: vi.fn(async () => eloFixture.full.map(m => ({ ...m }))),
}));

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
  startNextRound,
  completeTournament,
  isMatchComplete,
  isRoundComplete,
} from '../../js/services/tournament.js';
import { Store } from '../../js/store.js';
import { State } from '../../js/state.js';

// ─── Helpers ───

const DATE = '2025-06-01';
const PLAYERS_4 = ['Alice', 'Bob', 'Carol', 'Dave'];
const PLAYERS_8 = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank'];

function makeCompletedTournament() {
  const t = createTournament(DATE, PLAYERS_4);
  startTournament(t);
  // Round 1 has exactly 1 match for 4 players
  setMatchScore(t, 1, 1, 15, 10);
  return t;
}

// ─── Reset state between tests ───

beforeEach(() => {
  localStorageStub.clear();
  State._listeners = {};
  eloFixture.full = [];
  // ELO baseline sources are read, not recomputed — start every test from a
  // clean players_summary so one test's completion cannot seed the next.
  Store.setPlayersSummaryCache([]);
  Store.setTournamentsIndex([]);
});

// ─── Tests ───

describe('createTournament', () => {
  it('sets active tournament in Store', () => {
    const t = createTournament(DATE, PLAYERS_4);

    const stored = Store.getActiveTournament();
    expect(stored).not.toBeNull();
    expect(stored.id).toBe(t.id);
    expect(stored.tournamentDate).toBe(DATE);
    expect(stored.players).toHaveLength(4);
    expect(stored.rounds).toEqual([]);
    expect(stored.isStarted).toBe(false);
    expect(stored.isCompleted).toBe(false);
  });

  it('emits tournament-changed with tournament', () => {
    const events = [];
    State.on('tournament-changed', (data) => events.push(data));

    const t = createTournament(DATE, PLAYERS_4);

    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(t.id);
  });

  it('players initialised with zero stats', () => {
    const t = createTournament(DATE, PLAYERS_4);

    for (const p of t.players) {
      expect(p.totalPoints).toBe(0);
      expect(p.gamesPlayed).toBe(0);
      expect(p.wins).toBe(0);
      expect(p.losses).toBe(0);
    }
  });
});

describe('startTournament', () => {
  it('marks tournament as started', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);

    expect(t.isStarted).toBe(true);
    expect(t.startedAt).not.toBeNull();
    expect(t.currentRoundNumber).toBe(1);
  });

  it('creates round 1 with correct number of matches', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);

    expect(t.rounds).toHaveLength(1);
    expect(t.rounds[0].roundNumber).toBe(1);
    // 4 players → 1 match
    expect(t.rounds[0].matches).toHaveLength(1);
  });

  it('creates round 1 with correct number of matches for 8 players', () => {
    const t = createTournament(DATE, PLAYERS_8);
    startTournament(t);

    // 8 players → 2 matches
    expect(t.rounds[0].matches).toHaveLength(2);
  });

  it('persists started tournament in Store', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);

    const stored = Store.getActiveTournament();
    expect(stored.isStarted).toBe(true);
    expect(stored.rounds).toHaveLength(1);
  });

  it('Store.getMatches is empty before any score is set', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);

    expect(Store.getMatches()).toHaveLength(0);
  });

  it('throws if tournament already started', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);

    expect(() => startTournament(t)).toThrow('Tournament already started');
  });
});

describe('setMatchScore', () => {
  it('updates match scores in the round', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);

    setMatchScore(t, 1, 1, 15, 10);

    const match = t.rounds[0].matches[0];
    expect(match.team1Score).toBe(15);
    expect(match.team2Score).toBe(10);
    expect(isMatchComplete(match)).toBe(true);
  });

  it('recalculates player stats after score', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);

    setMatchScore(t, 1, 1, 15, 10);

    const winners = t.players.filter(p => p.wins === 1);
    const losers = t.players.filter(p => p.losses === 1);

    expect(winners).toHaveLength(2);
    expect(losers).toHaveLength(2);

    for (const w of winners) {
      expect(w.totalPoints).toBe(15);
      expect(w.gamesPlayed).toBe(1);
    }
    for (const l of losers) {
      expect(l.totalPoints).toBe(10);
      expect(l.gamesPlayed).toBe(1);
    }
  });

  it('persists completed match entity in Store.getMatches', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);

    setMatchScore(t, 1, 1, 15, 10);

    const matches = Store.getMatches();
    expect(matches).toHaveLength(1);
    expect(matches[0].date).toBe(DATE);
    expect(matches[0].roundNumber).toBe(1);
    expect(matches[0].scoreTeam1).toBe(15);
    expect(matches[0].scoreTeam2).toBe(10);
    expect(matches[0]._key).toBe(`${DATE}_R1M1`);
  });

  it('persists updated active_tournament in Store', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);

    setMatchScore(t, 1, 1, 20, 5);

    const stored = Store.getActiveTournament();
    expect(stored.rounds[0].matches[0].team1Score).toBe(20);
  });

  it('emits tournament-changed after score update', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);

    const events = [];
    State.on('tournament-changed', (data) => events.push(data));

    setMatchScore(t, 1, 1, 15, 10);

    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('throws when scores do not sum to 25', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);

    expect(() => setMatchScore(t, 1, 1, 10, 10)).toThrow('Scores must sum to 25');
  });
});

describe('startNextRound', () => {
  it('advances to round 2', () => {
    const t = makeCompletedTournament();

    startNextRound(t);

    expect(t.currentRoundNumber).toBe(2);
    expect(t.rounds).toHaveLength(2);
  });

  it('marks round 1 as completed', () => {
    const t = makeCompletedTournament();

    startNextRound(t);

    expect(t.rounds[0].completedAt).not.toBeNull();
  });

  it('round 2 has correct matches', () => {
    const t = makeCompletedTournament();

    startNextRound(t);

    const round2 = t.rounds[1];
    expect(round2.roundNumber).toBe(2);
    expect(round2.matches).toHaveLength(1);
    expect(round2.matches[0].roundNumber).toBe(2);
  });

  it('Store.getMatches contains round 1 entities after advancing', () => {
    const t = makeCompletedTournament();

    startNextRound(t);

    const matches = Store.getMatches();
    const round1Matches = matches.filter(m => m.roundNumber === 1);
    expect(round1Matches).toHaveLength(1);
  });

  it('persists updated tournament in Store', () => {
    const t = makeCompletedTournament();

    startNextRound(t);

    const stored = Store.getActiveTournament();
    expect(stored.currentRoundNumber).toBe(2);
    expect(stored.rounds).toHaveLength(2);
  });

  it('throws if round is not complete', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);

    expect(() => startNextRound(t)).toThrow('Current round is not complete');
  });
});

describe('completeTournament', () => {
  it('marks tournament as completed', async () => {
    const t = makeCompletedTournament();

    await completeTournament(t);

    expect(t.isCompleted).toBe(true);
    expect(t.completedAt).not.toBeNull();
  });

  it('keeps active tournament in Store until push succeeds (offline-safe)', async () => {
    const { pushCompletedTournament } = await import('../../js/services/github.js');
    pushCompletedTournament.mockRejectedValueOnce(new Error('Request timed out after 2000ms'));

    const t = makeCompletedTournament();

    await completeTournament(t);
    await Promise.resolve();

    // Tournament stays in localStorage marked completed — cleared only after push succeeds
    const stored = Store.getActiveTournament();
    expect(stored).not.toBeNull();
    expect(stored.isCompleted).toBe(true);
  });

  it('Store.getMatches contains all completed match entities', async () => {
    const t = makeCompletedTournament();

    await completeTournament(t);

    const matches = Store.getMatches();
    expect(matches).toHaveLength(1);
    expect(matches[0].date).toBe(DATE);
    expect(matches[0].scoreTeam1).toBe(15);
    expect(matches[0].scoreTeam2).toBe(10);
  });

  it('match entities have correct _key format', async () => {
    const t = makeCompletedTournament();

    await completeTournament(t);

    const matches = Store.getMatches();
    expect(matches[0]._key).toBe(`${DATE}_R1M1`);
  });

  it('match entities have all player names', async () => {
    const t = makeCompletedTournament();

    await completeTournament(t);

    const m = Store.getMatches()[0];
    const allNames = [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name];
    expect(allNames.every(n => typeof n === 'string' && n.length > 0)).toBe(true);
  });

  it('match entities have embedded ELO fields after completion', async () => {
    const t = makeCompletedTournament();

    await completeTournament(t);

    const m = Store.getMatches()[0];
    expect(typeof m.team1Player1Elo).toBe('number');
    expect(typeof m.team1Player2Elo).toBe('number');
    expect(typeof m.team2Player1Elo).toBe('number');
    expect(typeof m.team2Player2Elo).toBe('number');
    expect(m.team1Player1Elo).toBeGreaterThan(0);
    expect(m.team1Player2Elo).toBeGreaterThan(0);
    expect(m.team2Player1Elo).toBeGreaterThan(0);
    expect(m.team2Player2Elo).toBeGreaterThan(0);
  });

  it('multi-round: all match entities have embedded ELO fields', async () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);
    setMatchScore(t, 1, 1, 15, 10);
    startNextRound(t);
    setMatchScore(t, 2, 1, 13, 12);

    await completeTournament(t);

    const matches = Store.getMatches();
    for (const m of matches) {
      expect(typeof m.team1Player1Elo).toBe('number');
      expect(typeof m.team2Player2Elo).toBe('number');
    }
  });

  it('embeds ELO from the persisted baseline, without pulling the full history', async () => {
    const { ensureAllMatchesLoaded } = await import('../../js/services/github.js');
    ensureAllMatchesLoaded.mockClear();

    // Previous tournament day file carries authoritative post-match ELO.
    // The local match cache is EMPTY: the baseline must come from that file.
    eloFixture.full = [{
      date: '2025-05-01', roundNumber: 1, _key: '2025-05-01_R1M1',
      team1Player1Name: 'Alice', team1Player2Name: 'Bob',
      team2Player1Name: 'Carol', team2Player2Name: 'Dave',
      scoreTeam1: 21, scoreTeam2: 3,
      team1Player1Elo: 1016, team1Player2Elo: 1016,
      team2Player1Elo: 984, team2Player2Elo: 984,
    }];
    Store.setMatches([]);
    Store.setTournamentsIndex([{ date: '2025-05-01', isComplete: true }]);

    const t = makeCompletedTournament();
    await completeTournament(t);

    const entity = Store.getMatches().find(m => m.date === DATE && m.roundNumber === 1);
    const baseline = { Alice: 1016, Bob: 1016, Carol: 984, Dave: 984 };
    const team1Won = entity.scoreTeam1 > entity.scoreTeam2;

    // Every embedded ELO moves off its baseline in the right direction — proof
    // the baseline was read from the previous day file, not restarted at 1000.
    const delta = (name, elo) => elo - baseline[name];
    expect(delta(entity.team1Player1Name, entity.team1Player1Elo)).toBeGreaterThan(team1Won ? 0 : -100);
    expect(Math.sign(delta(entity.team1Player1Name, entity.team1Player1Elo))).toBe(team1Won ? 1 : -1);
    expect(Math.sign(delta(entity.team2Player1Name, entity.team2Player1Elo))).toBe(team1Won ? -1 : 1);

    expect(ensureAllMatchesLoaded).not.toHaveBeenCalled();
  });

  it('emits tournament-changed', async () => {
    const t = makeCompletedTournament();

    const events = [];
    State.on('tournament-changed', (data) => events.push(data));

    await completeTournament(t);

    expect(events).toHaveLength(1);
    expect(events[0].isCompleted).toBe(true);
  });

  it('multi-round: all rounds persisted to Store.getMatches', async () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);
    setMatchScore(t, 1, 1, 15, 10);
    startNextRound(t);
    setMatchScore(t, 2, 1, 13, 12);

    await completeTournament(t);

    const matches = Store.getMatches();
    expect(matches).toHaveLength(2);
    expect(matches.some(m => m.roundNumber === 1)).toBe(true);
    expect(matches.some(m => m.roundNumber === 2)).toBe(true);
  });

  it('updates tournaments index immediately with isComplete=true', async () => {
    const t = makeCompletedTournament();

    // Clear index to start fresh
    Store.setTournamentsIndex([]);
    expect(Store.getTournamentsIndex()).toHaveLength(0);

    await completeTournament(t);

    // Index should be updated immediately (synchronously)
    const index = Store.getTournamentsIndex();
    expect(index).toHaveLength(1);
    expect(index[0].date).toBe(DATE);
    expect(index[0].isComplete).toBe(true);
    expect(index[0].playerCount).toBe(4);
    expect(index[0].roundCount).toBe(1);
  });
});
