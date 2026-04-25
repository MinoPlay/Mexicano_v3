/**
 * Tournament lifecycle tests.
 * Verifies that Store (localStorage) and State events are correctly updated
 * when a tournament is created, updated, and ended.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mock dynamic imports used by store.js and tournament.js ───

vi.mock('../../js/services/github.js', () => ({
  schedulePush: vi.fn(),
  cancelPendingSync: vi.fn(),
  flushPush: vi.fn().mockResolvedValue(undefined),
  updateTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  markMatchDateDirty: vi.fn(),
  keyToPath: vi.fn().mockReturnValue(null),
  readFile: vi.fn().mockResolvedValue(null),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  generateMonthlyOverviews: vi.fn().mockResolvedValue(undefined),
  generatePlayersJson: vi.fn().mockResolvedValue(undefined),
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
  it('marks tournament as completed', () => {
    const t = makeCompletedTournament();

    completeTournament(t);

    expect(t.isCompleted).toBe(true);
    expect(t.completedAt).not.toBeNull();
  });

  it('clears active tournament from Store', () => {
    const t = makeCompletedTournament();

    completeTournament(t);

    expect(Store.getActiveTournament()).toBeNull();
  });

  it('Store.getMatches contains all completed match entities', () => {
    const t = makeCompletedTournament();

    completeTournament(t);

    const matches = Store.getMatches();
    expect(matches).toHaveLength(1);
    expect(matches[0].date).toBe(DATE);
    expect(matches[0].scoreTeam1).toBe(15);
    expect(matches[0].scoreTeam2).toBe(10);
  });

  it('match entities have correct _key format', () => {
    const t = makeCompletedTournament();

    completeTournament(t);

    const matches = Store.getMatches();
    expect(matches[0]._key).toBe(`${DATE}_R1M1`);
  });

  it('match entities have all player names', () => {
    const t = makeCompletedTournament();

    completeTournament(t);

    const m = Store.getMatches()[0];
    const allNames = [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name];
    expect(allNames.every(n => typeof n === 'string' && n.length > 0)).toBe(true);
  });

  it('emits tournament-changed', () => {
    const t = makeCompletedTournament();

    const events = [];
    State.on('tournament-changed', (data) => events.push(data));

    completeTournament(t);

    expect(events).toHaveLength(1);
    expect(events[0].isCompleted).toBe(true);
  });

  it('multi-round: all rounds persisted to Store.getMatches', () => {
    const t = createTournament(DATE, PLAYERS_4);
    startTournament(t);
    setMatchScore(t, 1, 1, 15, 10);
    startNextRound(t);
    setMatchScore(t, 2, 1, 13, 12);

    completeTournament(t);

    const matches = Store.getMatches();
    expect(matches).toHaveLength(2);
    expect(matches.some(m => m.roundNumber === 1)).toBe(true);
    expect(matches.some(m => m.roundNumber === 2)).toBe(true);
  });
});
