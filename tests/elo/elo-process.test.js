import { describe, it, expect } from 'vitest';
import { processMatchElo, calculateAllEloRankings } from '../../js/services/elo.js';

describe('processMatchElo', () => {
  it('sequential mutation: team2 sees team1 updated ELOs', () => {
    const players = {};
    const match = {
      team1Player1Name: 'A',
      team1Player2Name: 'B',
      team2Player1Name: 'C',
      team2Player2Name: 'D',
      scoreTeam1: 10,
      scoreTeam2: 5,
      date: '2024-01-01',
      roundNumber: 1,
    };

    processMatchElo(match, players);

    expect(players['A'].elo).toBeGreaterThan(1000);
    expect(players['B'].elo).toBeGreaterThan(1000);
    expect(players['C'].elo).toBeLessThan(1000);
    expect(players['D'].elo).toBeLessThan(1000);

    // A and B have same ELO (same opponents, same pre-update opponent ELOs)
    expect(players['A'].elo).toBeCloseTo(players['B'].elo, 10);
    // C and D also have same ELO (same opponents at same state)
    expect(players['C'].elo).toBeCloseTo(players['D'].elo, 10);
  });

  it('0-0 matches filtered in calculateAllEloRankings', () => {
    const matches = [
      {
        team1Player1Name: 'A', team1Player2Name: 'B',
        team2Player1Name: 'C', team2Player2Name: 'D',
        scoreTeam1: 0, scoreTeam2: 0,
        date: '2024-01-01', roundNumber: 1,
      },
    ];
    const { rankings } = calculateAllEloRankings(matches);
    expect(rankings).toHaveLength(0);
  });

  it('sort order: date.roundNumber:00', () => {
    const matches = [
      {
        team1Player1Name: 'A', team1Player2Name: 'B',
        team2Player1Name: 'C', team2Player2Name: 'D',
        scoreTeam1: 10, scoreTeam2: 5,
        date: '2024-01-01', roundNumber: 10,
      },
      {
        team1Player1Name: 'A', team1Player2Name: 'B',
        team2Player1Name: 'C', team2Player2Name: 'D',
        scoreTeam1: 5, scoreTeam2: 10,
        date: '2024-01-01', roundNumber: 2,
      },
    ];

    const { players } = calculateAllEloRankings(matches);

    // Round 2 processed first, then round 10
    expect(players['A'].history[0].roundNumber).toBe(2);
    expect(players['A'].history[1].roundNumber).toBe(10);
  });

  it('new players start at 1000', () => {
    const players = {};
    const match = {
      team1Player1Name: 'P1', team1Player2Name: 'P2',
      team2Player1Name: 'P3', team2Player2Name: 'P4',
      scoreTeam1: 10, scoreTeam2: 5,
      date: '2024-01-01', roundNumber: 1,
    };
    processMatchElo(match, players);

    const avgElo = Object.values(players).reduce((sum, p) => sum + p.elo, 0) / 4;
    expect(avgElo).toBeCloseTo(1000, 0);
  });

  it('history entries track date and roundNumber', () => {
    const players = {};
    const match = {
      team1Player1Name: 'A', team1Player2Name: 'B',
      team2Player1Name: 'C', team2Player2Name: 'D',
      scoreTeam1: 10, scoreTeam2: 5,
      date: '2024-03-15', roundNumber: 3,
    };
    processMatchElo(match, players);

    expect(players['A'].history).toHaveLength(1);
    expect(players['A'].history[0]).toEqual({
      date: '2024-03-15',
      roundNumber: 3,
      elo: players['A'].elo,
    });
  });
});
