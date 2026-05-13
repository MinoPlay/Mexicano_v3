import { describe, it, expect } from 'vitest';
import { processMatchElo, calculateAllEloRankings, getEloHistoryForLatestTournament } from '../../js/services/elo.js';

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

describe('getEloHistoryForLatestTournament with seedElos', () => {
  // Two-tournament scenario:
  // Tournament 1 (2024-01-01, round 1): A+B beat C+D → A,B gain ELO; C,D lose
  // Tournament 2 (2024-02-01, rounds 1-2): latest tournament
  // Without seeds, all players start at 1000 for tournament 2 → wrong values
  // With seeds from tournament 1 final ELOs → correct values

  function makeMatch(date, rn, t1p1, t1p2, t2p1, t2p2, s1, s2) {
    return { team1Player1Name: t1p1, team1Player2Name: t1p2, team2Player1Name: t2p1, team2Player2Name: t2p2, scoreTeam1: s1, scoreTeam2: s2, date, roundNumber: rn };
  }

  const t1Match = makeMatch('2024-01-01', 1, 'A', 'B', 'C', 'D', 10, 5);
  const t2Match1 = makeMatch('2024-02-01', 1, 'A', 'B', 'C', 'D', 10, 5);
  const t2Match2 = makeMatch('2024-02-01', 2, 'C', 'D', 'A', 'B', 10, 5);

  const allMatches = [t1Match, t2Match1, t2Match2];

  it('without seeds: replays from 1000, uses all matches', () => {
    const result = getEloHistoryForLatestTournament(allMatches, null, null);
    // All rounds present
    expect(result.rounds).toEqual([1, 2]);
    // A started tournament 2 above 1000 (won t1), so round 1 ELO should be > 1016
    expect(result.players['A'][0].elo).toBeGreaterThan(1016);
  });

  it('with seeds: only processes latest tournament, produces same round values as full replay', () => {
    // Compute "correct" seeds by doing a full replay up to t1
    const { players: fullPlayers } = calculateAllEloRankings([t1Match]);
    const seedElos = Object.fromEntries(Object.values(fullPlayers).map(p => [p.name, p.elo]));

    const seeded = getEloHistoryForLatestTournament([t2Match1, t2Match2], null, seedElos);
    const full = getEloHistoryForLatestTournament(allMatches, null, null);

    expect(seeded.rounds).toEqual([1, 2]);

    // Both methods should produce identical per-round ELO values
    for (const name of ['A', 'B', 'C', 'D']) {
      for (let i = 0; i < 2; i++) {
        expect(seeded.players[name][i].elo).toBeCloseTo(full.players[name][i].elo, 5);
      }
    }
  });

  it('with seeds: new player (no prior history) starts at 1000', () => {
    const newMatch = makeMatch('2024-02-01', 1, 'A', 'B', 'NEW', 'D', 10, 5);
    const seedElos = { A: 1020, B: 1020, D: 990 }; // NEW not in seeds

    const result = getEloHistoryForLatestTournament([newMatch], null, seedElos);
    // NEW should have been created at 1000 by processMatchElo
    expect(result.players['NEW']).toBeDefined();
    expect(result.players['NEW'][0].elo).toBeLessThan(1000); // lost
  });
});
