import { describe, it, expect } from 'vitest';
import { calculateAllEloRankings, getEloSnapshots } from '../../js/services/elo.js';
import { loadAllMatches, loadMatchesForDate } from '../helpers/load-matches.js';
import expected from '../fixtures/elo-expected.json';

const allMatches = loadAllMatches();

describe('ELO parity with C# (source of truth)', () => {
  it('loaded correct number of matches', () => {
    expect(allMatches.length).toBe(expected.matchCount);
  });

  describe('cumulative rankings', () => {
    const { rankings } = calculateAllEloRankings(allMatches);
    const rankingMap = Object.fromEntries(rankings.map(r => [r.name, r]));

    it('same number of players', () => {
      expect(rankings.length).toBe(expected.playerCount);
    });

    for (const exp of expected.cumulative) {
      it(`${exp.name}: ELO = ${exp.elo}`, () => {
        const actual = rankingMap[exp.name];
        expect(actual, `Player ${exp.name} not found in JS results`).toBeDefined();
        expect(actual.elo).toBeCloseTo(exp.elo, 1);
      });
    }

    it('ranking order matches C#', () => {
      const jsNames = rankings.map(r => r.name);
      const csharpNames = expected.cumulative.map(r => r.name);
      expect(jsNames).toEqual(csharpNames);
    });
  });

  describe('per-tournament snapshots', () => {
    const { snapshots } = getEloSnapshots(allMatches);

    it('same players in snapshots', () => {
      const jsPlayers = Object.keys(snapshots).sort();
      const csharpPlayers = Object.keys(expected.snapshots).sort();
      expect(jsPlayers).toEqual(csharpPlayers);
    });

    const sampleDates = [
      expected.tournamentDates[0],
      expected.tournamentDates[Math.floor(expected.tournamentDates.length / 2)],
      expected.tournamentDates[expected.tournamentDates.length - 1],
    ];

    for (const date of sampleDates) {
      describe(`snapshot @ ${date}`, () => {
        for (const [playerName, dateMap] of Object.entries(expected.snapshots)) {
          if (!(date in dateMap)) continue;
          it(`${playerName} ELO matches`, () => {
            const jsElo = snapshots[playerName]?.[date];
            expect(jsElo, `${playerName} missing snapshot for ${date}`).toBeDefined();
            expect(jsElo).toBeCloseTo(dateMap[date], 1);
          });
        }
      });
    }
  });

  describe('isolated single-tournament', () => {
    for (const [date, expectedRankings] of Object.entries(expected.isolatedTournaments)) {
      describe(`tournament ${date}`, () => {
        const matches = loadMatchesForDate(date);
        const { rankings } = calculateAllEloRankings(matches);
        const rankingMap = Object.fromEntries(rankings.map(r => [r.name, r]));

        for (const exp of expectedRankings) {
          it(`${exp.name}: ELO = ${exp.elo}`, () => {
            const actual = rankingMap[exp.name];
            expect(actual, `Player ${exp.name} not found`).toBeDefined();
            expect(actual.elo).toBeCloseTo(exp.elo, 1);
          });
        }
      });
    }
  });
});
