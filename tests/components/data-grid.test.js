import { describe, it, expect } from 'vitest';
import { sortRows, filterRows, nextSortState } from '../../js/components/data-grid.js';

describe('data-grid sortRows', () => {
  const rows = [{ a: 2 }, { a: null }, { a: 1 }];

  it('sorts numbers asc with nulls last', () => {
    expect(sortRows(rows, 'a', 'asc').map(r => r.a)).toEqual([1, 2, null]);
  });

  it('sorts numbers desc with nulls still last', () => {
    expect(sortRows(rows, 'a', 'desc').map(r => r.a)).toEqual([2, 1, null]);
  });

  it('sorts strings with localeCompare', () => {
    const r = [{ n: 'Øjvind' }, { n: 'anna' }, { n: 'Bo' }];
    expect(sortRows(r, 'n', 'asc').map(x => x.n)).toEqual(['anna', 'Bo', 'Øjvind']);
  });

  it('is stable and does not mutate input', () => {
    const r = [{ id: 1, v: 5 }, { id: 2, v: 5 }, { id: 3, v: 1 }];
    const out = sortRows(r, 'v', 'desc');
    expect(out.map(x => x.id)).toEqual([1, 2, 3]);
    expect(r.map(x => x.id)).toEqual([1, 2, 3]);
    expect(out).not.toBe(r);
  });

  it('treats NaN and undefined as missing', () => {
    const r = [{ v: NaN }, { v: 3 }, {}];
    expect(sortRows(r, 'v', 'asc')[0].v).toBe(3);
  });
});

describe('data-grid filterRows', () => {
  const rows = [{ n: 'Mino' }, { n: 'Kikke' }];

  it('matches case-insensitive substring', () => {
    expect(filterRows(rows, 'MI', ['n'])).toEqual([{ n: 'Mino' }]);
  });

  it('returns all rows for empty query', () => {
    expect(filterRows(rows, '  ', ['n'])).toHaveLength(2);
  });
});

describe('data-grid nextSortState', () => {
  it('toggles dir on same key', () => {
    expect(nextSortState({ key: 'elo', dir: 'desc' }, 'elo')).toEqual({ key: 'elo', dir: 'asc' });
  });

  it('uses defaultDir for new key', () => {
    expect(nextSortState({ key: 'elo', dir: 'asc' }, 'name', 'asc')).toEqual({ key: 'name', dir: 'asc' });
    expect(nextSortState({ key: 'elo', dir: 'asc' }, 'games')).toEqual({ key: 'games', dir: 'desc' });
  });
});
