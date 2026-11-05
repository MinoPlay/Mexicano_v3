import { describe, it, expect } from 'vitest';
import { calculateTournamentEloProgression } from '../../js/services/elo.js';

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

const elos = (history, name) => history.players[name].map(p => p.elo);
const deltas = (history, name) => history.players[name].map(p => p.delta);
const rounds = (history, name) => history.players[name].map(p => p.round);

describe('calculateTournamentEloProgression', () => {
  it('starts every player at round 0 with the pre-tournament ELO, then one point per round (15-10)', () => {
    const history = calculateTournamentEloProgression(tournament([match(1, ABCD, 15, 10)]), SUMMARY_1000);

    expect(history.rounds).toEqual([0, 1]);
    expect(Object.keys(history.players)).toEqual(['A', 'B', 'C', 'D']);
    expect(elos(history, 'A')).toEqual([1000, 1016]);
    expect(deltas(history, 'A')).toEqual([0, 16]);
    expect(elos(history, 'C')).toEqual([1000, 984.74]);
    expect(deltas(history, 'C')).toEqual([0, -15.3]);
  });

  it('chains rounds: round 2 continues from the ELO after round 1', () => {
    const history = calculateTournamentEloProgression(
      tournament([match(1, ABCD, 15, 10)], [match(1, ABCD, 10, 15)]),
      SUMMARY_1000,
    );

    expect(history.rounds).toEqual([0, 1, 2]);
    expect(elos(history, 'A')).toEqual([1000, 1016, 998.56]);
    expect(deltas(history, 'A')).toEqual([0, 16, -17.4]);
    expect(elos(history, 'B')).toEqual([1000, 1016, 998.56]);
    expect(elos(history, 'C')).toEqual([1000, 984.74, 1001.38]);
    expect(deltas(history, 'C')).toEqual([0, -15.3, 16.6]);
    expect(elos(history, 'D')).toEqual([1000, 984.74, 1001.38]);
  });

  it('walks rounds by roundNumber, not array order', () => {
    const t = {
      tournamentDate: DATE,
      rounds: [
        { roundNumber: 2, matches: [match(1, ABCD, 10, 15)] },
        { roundNumber: 1, matches: [match(1, ABCD, 15, 10)] },
      ],
    };
    const history = calculateTournamentEloProgression(t, SUMMARY_1000);

    expect(history.rounds).toEqual([0, 1, 2]);
    expect(elos(history, 'A')).toEqual([1000, 1016, 998.56]);
  });

  it('starts from previousElo when the summary already contains this tournament', () => {
    const summary = [
      entry('A', 1016, { eloDate: DATE }),
      entry('B', 1016, { eloDate: DATE }),
      entry('C', 984.74, { eloDate: DATE }),
      entry('D', 984.74, { eloDate: DATE }),
    ];
    const history = calculateTournamentEloProgression(tournament([match(1, ABCD, 15, 10)]), summary);

    expect(elos(history, 'A')).toEqual([1000, 1016]);
    expect(elos(history, 'C')).toEqual([1000, 984.74]);
  });

  it('uses each player\'s own baseline', () => {
    const summary = [entry('A', 1100), entry('B', 1000), entry('C', 950), entry('D', 1020)];
    const history = calculateTournamentEloProgression(tournament([match(1, ABCD, 15, 10)]), summary);

    expect(['A', 'B', 'C', 'D'].map(name => elos(history, name))).toEqual([
      [1100, 1110.92],
      [1000, 1015.34],
      [950, 939.08],
      [1020, 1006.02],
    ]);
  });

  it('gives a player points only for the rounds they played (sit-out)', () => {
    const summary = [...SUMMARY_1000, entry('E', 1000)];
    const history = calculateTournamentEloProgression(
      tournament([match(1, ABCD, 15, 10)], [match(1, ['A', 'C', 'B', 'E'], 13, 12)]),
      summary,
    );

    expect(history.rounds).toEqual([0, 1, 2]);
    expect(rounds(history, 'A')).toEqual([0, 1, 2]);
    expect(rounds(history, 'D')).toEqual([0, 1]);
    expect(rounds(history, 'E')).toEqual([0, 2]);
    expect(history.players.E[0]).toEqual({ round: 0, elo: 1000, delta: 0 });
  });

  it('ignores unscored matches and rounds, and does not need their players in the summary', () => {
    const history = calculateTournamentEloProgression(
      tournament([match(1, ABCD, 15, 10)], [match(1, ['E', 'F', 'G', 'H'], null, null)]),
      SUMMARY_1000,
    );

    expect(history.rounds).toEqual([0, 1]);
    expect(Object.keys(history.players)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('has no players and no rounds while nothing is scored', () => {
    const history = calculateTournamentEloProgression(tournament([match(1, ABCD, null, null)]), SUMMARY_1000);

    expect(history).toEqual({ players: {}, rounds: [] });
  });

  it('is null when a baseline is unknown', () => {
    const t = tournament([match(1, ABCD, 15, 10)]);
    const later = SUMMARY_1000.map(p => ({ ...p, eloDate: '2026-06-01' }));

    expect(calculateTournamentEloProgression(t, later)).toBeNull();
    expect(calculateTournamentEloProgression(t, SUMMARY_1000.filter(p => p.name !== 'D'))).toBeNull();
  });
});
