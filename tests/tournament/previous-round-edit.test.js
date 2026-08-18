/**
 * Editing a PREVIOUS round mid-tournament.
 *
 * Rule: when the tournament is on round N and a match of round N-1 is re-scored,
 * round N-1 is overridden with the new result and round N is regenerated from
 * the updated standings. The change must also be persisted to GitHub, otherwise
 * the remote day file keeps the stale rounds and overwrites the edit on reload.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const github = vi.hoisted(() => ({
  cancelPendingSync: vi.fn(),
  flushPush: vi.fn().mockResolvedValue(undefined),
  markMatchDateDirty: vi.fn(),
  pushTournamentDayFile: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../js/services/github.js', () => ({
  schedulePush: vi.fn(),
  cancelPendingSync: github.cancelPendingSync,
  flushPush: github.flushPush,
  updateTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  removeTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  deleteTournamentDayFile: vi.fn().mockResolvedValue(undefined),
  pushTournamentDayFile: github.pushTournamentDayFile,
  markMatchDateDirty: github.markMatchDateDirty,
  keyToPath: vi.fn().mockReturnValue(null),
  readFile: vi.fn().mockResolvedValue(null),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  ensureAllMatchesLoaded: vi.fn(async () => []),
}));

vi.mock('../../js/services/local.js', () => ({
  writeTournamentDay: vi.fn().mockResolvedValue(undefined),
}));

function makeLocalStorage() {
  let store = {};
  return {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
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
  startNextRound,
  isRoundComplete,
} from '../../js/services/tournament.js';
import { Store } from '../../js/store.js';
import { State } from '../../js/state.js';

const DATE = '2025-06-01';
const PLAYERS_8 = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank'];

/** Score every match of the current round 15-10, then advance. */
function scoreAndAdvance(t) {
  const round = t.rounds.find(r => r.roundNumber === t.currentRoundNumber);
  for (const m of round.matches) setMatchScore(t, round.roundNumber, m.id, 15, 10);
  startNextRound(t);
}

/** Tournament sitting on round `target` with rounds 1..target-1 fully scored. */
function tournamentAtRound(target) {
  const t = createTournament(DATE, PLAYERS_8);
  startTournament(t);
  while (t.currentRoundNumber < target) scoreAndAdvance(t);
  return t;
}

beforeEach(() => {
  localStorageStub.clear();
  State._listeners = {};
  github.flushPush.mockClear();
  github.cancelPendingSync.mockClear();
  github.markMatchDateDirty.mockClear();
  github.pushTournamentDayFile.mockClear();
});

describe('editing the previous round', () => {
  it('overrides round 2 and regenerates round 3 when on round 3', () => {
    const t = tournamentAtRound(3);
    const r2 = t.rounds.find(r => r.roundNumber === 2);
    const matchId = r2.matches[0].id;

    setMatchScore(t, 2, matchId, 5, 20);

    const editedRound = t.rounds.find(r => r.roundNumber === 2);
    const edited = editedRound.matches.find(m => m.id === matchId);
    expect(edited.team1Score).toBe(5);
    expect(edited.team2Score).toBe(20);

    expect(t.rounds).toHaveLength(3);
    expect(t.currentRoundNumber).toBe(3);
    const r3 = t.rounds.find(r => r.roundNumber === 3);
    expect(r3.matches).toHaveLength(2);
    expect(isRoundComplete(r3)).toBe(false);
    expect(r3.matches.every(m => m.roundNumber === 3)).toBe(true);
  });

  it('overrides round 6 and regenerates round 7 when on round 7', () => {
    const t = tournamentAtRound(7);
    const r6 = t.rounds.find(r => r.roundNumber === 6);
    const matchId = r6.matches[1].id;

    setMatchScore(t, 6, matchId, 25, 0);

    const edited = t.rounds.find(r => r.roundNumber === 6).matches.find(m => m.id === matchId);
    expect(edited.team1Score).toBe(25);
    expect(edited.team2Score).toBe(0);

    expect(t.rounds).toHaveLength(7);
    expect(t.currentRoundNumber).toBe(7);
    expect(t.rounds.map(r => r.roundNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(isRoundComplete(t.rounds[6])).toBe(false);
  });

  it('recalculates player stats from the edited result', () => {
    const t = tournamentAtRound(3);
    const r2 = t.rounds.find(r => r.roundNumber === 2);
    const m = r2.matches[0];
    const loserName = m.player3.name;

    setMatchScore(t, 2, m.id, 0, 25);

    const loser = t.players.find(p => p.name === loserName);
    // 2 rounds played: round 1 (15 or 10) + round 2 (25 as winner now)
    expect(loser.wins).toBeGreaterThanOrEqual(1);
    expect(loser.totalPoints).toBeGreaterThanOrEqual(25);
    for (const p of t.players) expect(p.gamesPlayed).toBe(2);
  });

  it('purges stale match entities of the regenerated round from the Store', () => {
    const t = tournamentAtRound(3);
    const r2 = t.rounds.find(r => r.roundNumber === 2);

    setMatchScore(t, 2, r2.matches[0].id, 5, 20);

    const stored = Store.getMatches().filter(m => m.date === DATE);
    expect(stored.every(m => m.roundNumber <= 2)).toBe(true);
    const r2Stored = stored.filter(m => m.roundNumber === 2);
    expect(r2Stored.some(m => m.scoreTeam1 === 5 && m.scoreTeam2 === 20)).toBe(true);
  });

  it('persists the cascade to the Store active tournament', () => {
    const t = tournamentAtRound(3);
    const r2 = t.rounds.find(r => r.roundNumber === 2);

    setMatchScore(t, 2, r2.matches[0].id, 5, 20);

    const stored = Store.getActiveTournament();
    expect(stored.rounds).toHaveLength(3);
    expect(stored.currentRoundNumber).toBe(3);
    expect(stored.rounds[1].matches[0].team1Score).toBe(5);
  });

  it('pushes the cascade to GitHub so a reload cannot restore the stale rounds', async () => {
    const t = tournamentAtRound(3);
    const r2 = t.rounds.find(r => r.roundNumber === 2);
    github.pushTournamentDayFile.mockClear();

    setMatchScore(t, 2, r2.matches[0].id, 5, 20);

    expect(github.pushTournamentDayFile).toHaveBeenCalledTimes(1);
    const pushed = github.pushTournamentDayFile.mock.calls[0][0];
    expect(pushed.tournamentDate).toBe(DATE);
    expect(pushed.rounds).toHaveLength(3);
    expect(pushed.rounds[1].matches[0].team1Score).toBe(5);
    await new Promise(r => setTimeout(r, 0));
  });

  it('does not push on a normal current-round score entry', () => {
    const t = tournamentAtRound(3);
    github.pushTournamentDayFile.mockClear();

    setMatchScore(t, 3, t.rounds[2].matches[0].id, 15, 10);

    expect(github.pushTournamentDayFile).not.toHaveBeenCalled();
  });
});
