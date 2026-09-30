import { describe, it, expect, vi } from 'vitest';
vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 });
import { parseCompareNames, alignEloSeries } from '../../js/pages/player-compare.js';

describe('parseCompareNames', () => {
  it('splits, trims, dedupes, drops empties', () => {
    expect(parseCompareNames(' A, B ,,A,C')).toEqual(['A', 'B', 'C']);
    expect(parseCompareNames(undefined)).toEqual([]);
  });
});

describe('alignEloSeries', () => {
  it('shared sorted date axis, null before first game, carried forward after', () => {
    const out = alignEloSeries([
      { name: 'A', points: [{ date: '2026-01-01', elo: 1010 }, { date: '2026-01-15', elo: 1020 }] },
      { name: 'B', points: [{ date: '2026-01-08', elo: 990 }] },
    ]);
    expect(out.dates).toEqual(['2026-01-01', '2026-01-08', '2026-01-15']);
    expect(out.series[0]).toEqual({ label: 'A', values: [1010, 1010, 1020] });
    expect(out.series[1]).toEqual({ label: 'B', values: [null, 990, 990] });
  });
});
