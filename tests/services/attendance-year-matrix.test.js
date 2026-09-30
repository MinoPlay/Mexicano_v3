import { describe, it, expect } from 'vitest';
import { buildYearMatrix } from '../../js/services/attendance.js';

describe('buildYearMatrix', () => {
  it('counts sessions per player per month for one year, sorted by total desc then name', () => {
    const rows = [
      { date: '2025-01-03', players: ['A', 'B'] },
      { date: '2025-01-10', players: ['A'] },
      { date: '2025-03-01', players: ['B', 'C'] },
      { date: '2025-03-01', players: ['A'] },
      { date: '2024-12-30', players: ['A', 'Z'] },
    ];
    const m = buildYearMatrix(rows, 2025);
    expect(m.sessions).toEqual([2, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(m.players).toEqual([
      { name: 'A', months: [2, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], total: 3 },
      { name: 'B', months: [1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], total: 2 },
      { name: 'C', months: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0], total: 1 },
    ]);
    expect(m.years).toEqual([2025, 2024]);
  });
});
