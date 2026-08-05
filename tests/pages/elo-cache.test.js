import { describe, it, expect } from 'vitest';
import { updateEloCache, removeFromEloCache } from '../../js/pages/elo-charts.js';

describe('elo cache updater (unlimited, append at end)', () => {
  it('adds name to empty cache as first entry', () => {
    expect(updateEloCache([], 'Alice')).toEqual(['Alice']);
  });

  it('appends new entries at the end', () => {
    expect(updateEloCache(['Alice'], 'Bob')).toEqual(['Alice', 'Bob']);
    expect(updateEloCache(['Alice', 'Bob'], 'Caro')).toEqual(['Alice', 'Bob', 'Caro']);
  });

  it('does not duplicate an existing name (keeps order)', () => {
    expect(updateEloCache(['Alice', 'Bob'], 'Alice')).toEqual(['Alice', 'Bob']);
    expect(updateEloCache(['Alice', 'Bob'], 'Bob')).toEqual(['Alice', 'Bob']);
  });

  it('keeps growing past 5 (no eviction)', () => {
    expect(updateEloCache(['P', 'A', 'B', 'C', 'D'], 'E')).toEqual(['P', 'A', 'B', 'C', 'D', 'E']);
  });

  it('ignores empty/null names', () => {
    expect(updateEloCache(['A'], '')).toEqual(['A']);
    expect(updateEloCache(['A'], null)).toEqual(['A']);
  });

  it('does not mutate input array', () => {
    const input = ['A', 'B'];
    updateEloCache(input, 'C');
    expect(input).toEqual(['A', 'B']);
  });
});

describe('elo cache remover', () => {
  it('removes a name from the cache', () => {
    expect(removeFromEloCache(['A', 'B', 'C'], 'B')).toEqual(['A', 'C']);
  });

  it('returns an unchanged copy when name absent', () => {
    expect(removeFromEloCache(['A', 'B'], 'Z')).toEqual(['A', 'B']);
  });

  it('handles empty / non-array input', () => {
    expect(removeFromEloCache([], 'A')).toEqual([]);
    expect(removeFromEloCache(null, 'A')).toEqual([]);
  });

  it('does not mutate input array', () => {
    const input = ['A', 'B'];
    removeFromEloCache(input, 'A');
    expect(input).toEqual(['A', 'B']);
  });
});
