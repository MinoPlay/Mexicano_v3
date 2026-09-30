import { describe, it, expect } from 'vitest';
import { buildTournamentRows } from '../../js/services/player-insights.js';

const m = (date, a, b, c, d, s1, s2) => ({ date, roundNumber: 1, team1Player1Name: a, team1Player2Name: b, team2Player1Name: c, team2Player2Name: d, scoreTeam1: s1, scoreTeam2: s2 });

describe('buildTournamentRows', () => {
  it('enriches index entries with winner, runner-up, points and year; newest first', () => {
    const index = [
      { date: '2024-01-05', playerCount: 4, roundCount: 1, isComplete: true },
      { date: '2025-02-01', playerCount: 4, roundCount: 2, isComplete: false, completedCount: 1, matchCount: 2 },
    ];
    const matches = [
      m('2024-01-05', 'A', 'B', 'C', 'D', 15, 10),
      m('2025-02-01', 'A', 'C', 'B', 'D', 5, 20),
      m('2025-02-01', 'B', 'C', 'A', 'D', 0, 0),
    ];
    const rows = buildTournamentRows(index, matches);
    expect(rows.map(r => r.date)).toEqual(['2025-02-01', '2024-01-05']);
    expect(rows[1]).toMatchObject({ year: '2024', winner: 'A', runnerUp: 'B', winnerPoints: 15, totalPoints: 25, matches: 1, players: 4, rounds: 1, status: 'Complete' });
    expect(rows[0]).toMatchObject({ year: '2025', winner: 'B', winnerPoints: 20, matches: 1, status: '1/2' });
  });

  it('handles tournaments without match history', () => {
    const rows = buildTournamentRows([{ date: '2025-03-01', playerCount: 8, roundCount: 0 }], []);
    expect(rows[0]).toMatchObject({ winner: null, runnerUp: null, matches: 0, totalPoints: 0, players: 8, status: 'Pending' });
  });
});
