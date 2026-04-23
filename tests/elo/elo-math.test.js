import { describe, it, expect } from 'vitest';
import {
  calculateCombinedOpponentElo,
  calculateExpectedScore,
  calculateClassicElo
} from '../../js/services/elo.js';

describe('calculateCombinedOpponentElo (RMS)', () => {
  it('equal ELOs → same value', () => {
    expect(calculateCombinedOpponentElo(1000, 1000)).toBeCloseTo(1000, 4);
  });

  it('different ELOs → RMS formula', () => {
    const result = calculateCombinedOpponentElo(1200, 800);
    expect(result).toBeCloseTo(Math.sqrt((1200 ** 2 + 800 ** 2) / 2), 4);
  });

  it('symmetric — order does not matter', () => {
    expect(calculateCombinedOpponentElo(1100, 900)).toBeCloseTo(
      calculateCombinedOpponentElo(900, 1100), 10
    );
  });

  it('matches C# formula: sqrt(sum(elo^2) / 2)', () => {
    const elo1 = 1050, elo2 = 980;
    const csharpResult = Math.pow((elo1 ** 2 + elo2 ** 2) / 2, 0.5);
    expect(calculateCombinedOpponentElo(elo1, elo2)).toBeCloseTo(csharpResult, 10);
  });
});

describe('calculateExpectedScore', () => {
  it('equal ELOs → 0.5', () => {
    expect(calculateExpectedScore(1000, 1000)).toBeCloseTo(0.5, 6);
  });

  it('higher player ELO → expected > 0.5', () => {
    expect(calculateExpectedScore(1200, 1000)).toBeGreaterThan(0.5);
  });

  it('lower player ELO → expected < 0.5', () => {
    expect(calculateExpectedScore(800, 1000)).toBeLessThan(0.5);
  });

  it('400 point diff → expected ≈ 0.909', () => {
    expect(calculateExpectedScore(1400, 1000)).toBeCloseTo(1 / 1.1, 4);
  });

  it('matches C# formula: 1/(1+10^((opp-player)/400))', () => {
    const player = 1050, opp = 980;
    const expected = 1 / (1 + Math.pow(10, (opp - player) / 400));
    expect(calculateExpectedScore(player, opp)).toBeCloseTo(expected, 10);
  });
});

describe('calculateClassicElo', () => {
  it('win against equal opponents → ELO increases', () => {
    const newElo = calculateClassicElo(1000, 1000, 1000, true);
    expect(newElo).toBeGreaterThan(1000);
  });

  it('loss against equal opponents → ELO decreases', () => {
    const newElo = calculateClassicElo(1000, 1000, 1000, false);
    expect(newElo).toBeLessThan(1000);
  });

  it('K=32: win vs equal → +16', () => {
    const newElo = calculateClassicElo(1000, 1000, 1000, true);
    expect(newElo).toBeCloseTo(1016, 0);
  });

  it('K=32: loss vs equal → -16', () => {
    const newElo = calculateClassicElo(1000, 1000, 1000, false);
    expect(newElo).toBeCloseTo(984, 0);
  });

  it('win against weaker opponents → small gain', () => {
    const gain = calculateClassicElo(1200, 800, 800, true) - 1200;
    const gainEqual = calculateClassicElo(1000, 1000, 1000, true) - 1000;
    expect(gain).toBeLessThan(gainEqual);
  });

  it('rounds to 2 decimal places', () => {
    const result = calculateClassicElo(1000, 1050, 980, true);
    const decimals = result.toString().split('.')[1]?.length || 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });

  it('matches C# formula exactly', () => {
    const playerElo = 1050;
    const opp1 = 980, opp2 = 1020;
    const combinedOpp = Math.sqrt((opp1 ** 2 + opp2 ** 2) / 2);
    const expected = 1 / (1 + Math.pow(10, (combinedOpp - playerElo) / 400));
    const csharpResult = Math.round((playerElo + 32 * (1 - expected)) * 100) / 100;

    expect(calculateClassicElo(playerElo, opp1, opp2, true)).toBeCloseTo(csharpResult, 2);
  });
});
