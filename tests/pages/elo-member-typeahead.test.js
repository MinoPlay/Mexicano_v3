import { describe, it, expect } from 'vitest';
import { filterMemberSuggestions } from '../../js/pages/elo-charts.js';

describe('elo member typeahead filter', () => {
  const all = ['Alice', 'Bob', 'Boris', 'Caro', 'dino'];

  it('returns available members not already selected, sorted, when query empty', () => {
    const selected = new Set(['Bob']);
    expect(filterMemberSuggestions(all, selected, '')).toEqual(['Alice', 'Boris', 'Caro', 'dino']);
  });

  it('filters case-insensitively by substring', () => {
    const selected = new Set();
    expect(filterMemberSuggestions(all, selected, 'bo')).toEqual(['Bob', 'Boris']);
  });

  it('matches regardless of query case and excludes selected', () => {
    const selected = new Set(['Boris']);
    expect(filterMemberSuggestions(all, selected, 'BO')).toEqual(['Bob']);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterMemberSuggestions(all, new Set(), 'zzz')).toEqual([]);
  });

  it('trims whitespace from query', () => {
    expect(filterMemberSuggestions(all, new Set(), '  car ')).toEqual(['Caro']);
  });
});
