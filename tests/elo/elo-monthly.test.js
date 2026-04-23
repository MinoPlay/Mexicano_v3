import { describe, it, expect } from 'vitest';
import { calculateAllEloRankings } from '../../js/services/elo.js';
import { loadAllMatches } from '../helpers/load-matches.js';
import monthlyExpected from '../fixtures/monthly-elo-expected.json';

const allMatches = loadAllMatches();
const months = Object.keys(monthlyExpected).sort();

describe('Monthly ELO parity with C# (hardcoded expected values)', () => {
  it(`covers all ${months.length} months`, () => {
    expect(months.length).toBe(42);
  });

  for (const month of months) {
    describe(`${month}`, () => {
      const cutoff = month + '-99';
      const matchesUpTo = allMatches.filter(m => m.date <= cutoff);
      const { rankings } = calculateAllEloRankings(matchesUpTo);
      const jsMap = Object.fromEntries(rankings.map(r => [r.name, r.elo]));
      const expectedPlayers = monthlyExpected[month];

      it('same player count', () => {
        expect(Object.keys(jsMap).length).toBe(Object.keys(expectedPlayers).length);
      });

      for (const [name, expectedElo] of Object.entries(expectedPlayers)) {
        it(`${name} = ${expectedElo}`, () => {
          expect(jsMap[name], `${name} missing in JS`).toBeDefined();
          expect(jsMap[name]).toBeCloseTo(expectedElo, 1);
        });
      }
    });
  }
});
