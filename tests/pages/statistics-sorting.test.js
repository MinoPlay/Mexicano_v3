import { describe, it, expect } from 'vitest';
import { sortStatisticsRows, getNextStatisticsSortState } from '../../js/pages/statistics.js';

function row(name, average, wins, extras = {}) {
  return {
    name,
    average,
    wins,
    losses: 0,
    points: 0,
    wl: wins,
    winRate: 0,
    elo: 1000,
    eloChange: 0,
    ...extras,
  };
}

describe('statistics sorting', () => {
  it('default sort applies AVG desc, then wins desc, then name asc', () => {
    const stats = [
      row('Boris', 10, 8),
      row('Aron', 10, 8),
      row('Dino', 10, 9),
      row('Caro', 11, 4),
    ];

    const sorted = sortStatisticsRows(stats);
    expect(sorted.map(s => s.name)).toEqual(['Caro', 'Dino', 'Aron', 'Boris']);
    expect(sorted.map(s => s.rank)).toEqual([1, 2, 3, 4]);
  });

  it('keeps null AVG values last', () => {
    const stats = [
      row('Ada', null, 10),
      row('Ben', 7.2, 1),
      row('Cole', undefined, 12),
      row('Dom', 4.8, 9),
    ];

    const sorted = sortStatisticsRows(stats);
    expect(sorted.map(s => s.name)).toEqual(['Ben', 'Dom', 'Cole', 'Ada']);
  });

  it('same default sort rule works for all filter contexts', () => {
    const contexts = ['all', 'latest', 'monthly', 'date'];
    const sourceRows = [row('Ken', 9.1, 5), row('Ian', 9.1, 6), row('Lia', 8.9, 9)];

    contexts.forEach(() => {
      const sorted = sortStatisticsRows(sourceRows);
      expect(sorted.map(s => s.name)).toEqual(['Ian', 'Ken', 'Lia']);
    });
  });
});

describe('statistics sort click state', () => {
  it('toggles direction when same column clicked again', () => {
    const first = getNextStatisticsSortState('average', 'desc', 'average');
    expect(first).toEqual({ sortCol: 'average', sortDir: 'asc' });

    const second = getNextStatisticsSortState(first.sortCol, first.sortDir, 'average');
    expect(second).toEqual({ sortCol: 'average', sortDir: 'desc' });
  });

  it('sets new column to default direction', () => {
    const winsState = getNextStatisticsSortState('average', 'desc', 'wins');
    expect(winsState).toEqual({ sortCol: 'wins', sortDir: 'desc' });

    const nameState = getNextStatisticsSortState(winsState.sortCol, winsState.sortDir, 'name');
    expect(nameState).toEqual({ sortCol: 'name', sortDir: 'asc' });
  });
});
