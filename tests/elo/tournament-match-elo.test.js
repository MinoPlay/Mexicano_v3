import { describe, it, expect } from 'vitest';
import { calculateTournamentMatchEloChanges, resolvePreTournamentElo } from '../../js/services/elo.js';

const DATE = '2026-05-07';
const EARLIER = '2026-04-30';

const entry = (name, elo, extra = {}) => ({ name, elo, previousElo: 1000, eloDate: EARLIER, ...extra });
const SUMMARY_1000 = ['A', 'B', 'C', 'D'].map(name => entry(name, 1000));

const match = (id, [p1, p2, p3, p4], team1Score, team2Score) => ({
  id,
  player1: { name: p1 },
  player2: { name: p2 },
  player3: { name: p3 },
  player4: { name: p4 },
  team1Score,
  team2Score,
});
const tournament = (...rounds) => ({
  tournamentDate: DATE,
  rounds: rounds.map((matches, i) => ({ roundNumber: i + 1, matches })),
});
const ABCD = ['A', 'B', 'C', 'D'];

describe('resolvePreTournamentElo', () => {
  it('uses elo when the latest ELO row is older than the tournament', () => {
    const summary = [entry('A', 1100, { previousElo: 1050 })];
    expect(resolvePreTournamentElo(summary, DATE, ['A'])).toEqual({ A: 1100 });
  });

  it('uses previousElo when the summary already includes this tournament', () => {
    const summary = [entry('A', 1116, { previousElo: 1100, eloDate: DATE })];
    expect(resolvePreTournamentElo(summary, DATE, ['A'])).toEqual({ A: 1100 });
  });

  it('uses elo for a player without ELO history (no eloDate)', () => {
    const summary = [{ name: 'N', elo: 1000, previousElo: 1000, eloDate: null }, { name: 'M', elo: 1000 }];
    expect(resolvePreTournamentElo(summary, DATE, ['N', 'M'])).toEqual({ N: 1000, M: 1000 });
  });

  it('is unknown (null) when a later tournament already rewrote the player ELO', () => {
    const summary = [entry('A', 1100, { eloDate: '2026-06-01' })];
    expect(resolvePreTournamentElo(summary, DATE, ['A'])).toBeNull();
  });

  it('is unknown (null) when a player is missing from the summary', () => {
    expect(resolvePreTournamentElo([entry('A', 1000)], DATE, ['A', 'Ghost'])).toBeNull();
  });
});

describe('calculateTournamentMatchEloChanges', () => {
  it('gives winners +16 and losers -15.26 when everyone starts at 1000 (15-10)', () => {
    const m1 = match(1, ABCD, 15, 10);
    const changes = calculateTournamentMatchEloChanges(tournament([m1]), SUMMARY_1000);
    expect(changes.get(m1)).toEqual([16, 16, -15.26, -15.26]);
  });

  it('reflects a changed result (10-15): team 1 -16, team 2 +15.26', () => {
    const m1 = match(1, ABCD, 10, 15);
    const changes = calculateTournamentMatchEloChanges(tournament([m1]), SUMMARY_1000);
    expect(changes.get(m1)).toEqual([-16, -16, 15.26, 15.26]);
  });

  it('chains rounds: round 2 starts from the ELO after round 1', () => {
    const r1 = match(1, ABCD, 15, 10);
    const r2 = match(1, ABCD, 10, 15);
    const changes = calculateTournamentMatchEloChanges(tournament([r1], [r2]), SUMMARY_1000);
    expect(changes.get(r1)).toEqual([16, 16, -15.26, -15.26]);
    expect(changes.get(r2)).toEqual([-17.44, -17.44, 16.64, 16.64]);
  });

  it('walks rounds by roundNumber, not array order', () => {
    const r1 = match(1, ABCD, 15, 10);
    const r2 = match(1, ABCD, 10, 15);
    const t = {
      tournamentDate: DATE,
      rounds: [{ roundNumber: 2, matches: [r2] }, { roundNumber: 1, matches: [r1] }],
    };
    const changes = calculateTournamentMatchEloChanges(t, SUMMARY_1000);
    expect(changes.get(r1)).toEqual([16, 16, -15.26, -15.26]);
    expect(changes.get(r2)).toEqual([-17.44, -17.44, 16.64, 16.64]);
  });

  it('uses each player\'s own baseline', () => {
    const summary = [entry('A', 1100), entry('B', 1000), entry('C', 950), entry('D', 1020)];
    const m1 = match(1, ABCD, 15, 10);
    const changes = calculateTournamentMatchEloChanges(tournament([m1]), summary);
    expect(changes.get(m1)).toEqual([10.92, 15.34, -10.92, -13.98]);
  });

  it('starts from previousElo when the summary already contains this tournament', () => {
    const summary = [
      entry('A', 1016, { eloDate: DATE }),
      entry('B', 1016, { eloDate: DATE }),
      entry('C', 984.74, { eloDate: DATE }),
      entry('D', 984.74, { eloDate: DATE }),
    ];
    const m1 = match(1, ABCD, 15, 10);
    const changes = calculateTournamentMatchEloChanges(tournament([m1]), summary);
    expect(changes.get(m1)).toEqual([16, 16, -15.26, -15.26]);
  });

  it('omits unscored matches and does not need their players in the summary', () => {
    const scored = match(1, ABCD, 15, 10);
    const unscored = match(2, ['E', 'F', 'G', 'H'], null, null);
    const changes = calculateTournamentMatchEloChanges(tournament([scored, unscored]), SUMMARY_1000);
    expect(changes.get(scored)).toEqual([16, 16, -15.26, -15.26]);
    expect(changes.has(unscored)).toBe(false);
  });

  it('returns no changes when a baseline is unknown', () => {
    const m1 = match(1, ABCD, 15, 10);
    const later = SUMMARY_1000.map(p => ({ ...p, eloDate: '2026-06-01' }));
    expect(calculateTournamentMatchEloChanges(tournament([m1]), later).size).toBe(0);
    expect(calculateTournamentMatchEloChanges(tournament([m1]), []).size).toBe(0);
  });
});
