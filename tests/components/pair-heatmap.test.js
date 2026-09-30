import { describe, it, expect, vi } from 'vitest';
vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 });
import { pickActivePlayers } from '../../js/components/pair-heatmap.js';

describe('pickActivePlayers', () => {
  it('orders by attendance, then games, then name; limits to n', () => {
    const rows = [
      { name: 'C', attendance: 50, games: 10 },
      { name: 'A', attendance: 90, games: 5 },
      { name: 'B', attendance: 50, games: 30 },
      { name: 'D', attendance: 50, games: 10 },
    ];
    expect(pickActivePlayers(rows, 3)).toEqual(['A', 'B', 'C']);
  });
});
