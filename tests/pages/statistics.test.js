import { describe, it, expect } from 'vitest';
import { 
  sortHeadToHeadTable, 
  sortPartnersTable 
} from '../../js/services/statistics.js';

// ─── Head-to-Head Test Data ───
const headToHeadData = [
  { opponentName: 'Alice', gamesPlayed: 5, wins: 3, losses: 2, winRate: 60.0 },
  { opponentName: 'Zara', gamesPlayed: 8, wins: 4, losses: 4, winRate: 50.0 },
  { opponentName: 'Bob', gamesPlayed: 3, wins: 1, losses: 2, winRate: 33.33 },
  { opponentName: 'Charlie', gamesPlayed: 12, wins: 7, losses: 5, winRate: 58.33 },
];

// ─── Partners Test Data ───
const partnersData = [
  { partnerName: 'Xavier', gamesPlayed: 4, wins: 3, losses: 1, averagePointsPerGame: 15.25 },
  { partnerName: 'Yara', gamesPlayed: 6, wins: 5, losses: 1, averagePointsPerGame: 16.5 },
  { partnerName: 'Zeke', gamesPlayed: 2, wins: 2, losses: 0, averagePointsPerGame: 14.0 },
  { partnerName: 'Alex', gamesPlayed: 7, wins: 4, losses: 3, averagePointsPerGame: 13.86 },
];

describe('Player Profile — Sortable Columns', () => {
  describe('Head-to-Head Table Sorting', () => {
    it('sorts by Opponent column ascending on first click', () => {
      const sorted = sortHeadToHeadTable(headToHeadData, 'opponentName', 'asc');
      expect(sorted.map(row => row.opponentName)).toEqual(['Alice', 'Bob', 'Charlie', 'Zara']);
    });

    it('sorts by Opponent column descending on second click', () => {
      const sorted = sortHeadToHeadTable(headToHeadData, 'opponentName', 'desc');
      expect(sorted.map(row => row.opponentName)).toEqual(['Zara', 'Charlie', 'Bob', 'Alice']);
    });

    it('sorts by Games column ascending on first click', () => {
      const sorted = sortHeadToHeadTable(headToHeadData, 'gamesPlayed', 'asc');
      expect(sorted.map(row => row.gamesPlayed)).toEqual([3, 5, 8, 12]);
    });

    it('sorts by Games column descending on second click', () => {
      const sorted = sortHeadToHeadTable(headToHeadData, 'gamesPlayed', 'desc');
      expect(sorted.map(row => row.gamesPlayed)).toEqual([12, 8, 5, 3]);
    });

    it('sorts by W (wins) column ascending on first click', () => {
      const sorted = sortHeadToHeadTable(headToHeadData, 'wins', 'asc');
      expect(sorted.map(row => row.wins)).toEqual([1, 3, 4, 7]);
    });

    it('sorts by W (wins) column descending on second click', () => {
      const sorted = sortHeadToHeadTable(headToHeadData, 'wins', 'desc');
      expect(sorted.map(row => row.wins)).toEqual([7, 4, 3, 1]);
    });

    it('sorts by L (losses) column ascending on first click', () => {
      const sorted = sortHeadToHeadTable(headToHeadData, 'losses', 'asc');
      expect(sorted.map(row => row.losses)).toEqual([2, 2, 4, 5]);
    });

    it('sorts by L (losses) column descending on second click', () => {
      const sorted = sortHeadToHeadTable(headToHeadData, 'losses', 'desc');
      expect(sorted.map(row => row.losses)).toEqual([5, 4, 2, 2]);
    });

    it('sorts by Win% column ascending on first click', () => {
      const sorted = sortHeadToHeadTable(headToHeadData, 'winRate', 'asc');
      expect(sorted.map(row => row.winRate)).toEqual([33.33, 50.0, 58.33, 60.0]);
    });

    it('sorts by Win% column descending on second click', () => {
      const sorted = sortHeadToHeadTable(headToHeadData, 'winRate', 'desc');
      expect(sorted.map(row => row.winRate)).toEqual([60.0, 58.33, 50.0, 33.33]);
    });
  });

  describe('Partners Table Sorting', () => {
    it('sorts by Partner column ascending on first click', () => {
      const sorted = sortPartnersTable(partnersData, 'partnerName', 'asc');
      expect(sorted.map(row => row.partnerName)).toEqual(['Alex', 'Xavier', 'Yara', 'Zeke']);
    });

    it('sorts by Partner column descending on second click', () => {
      const sorted = sortPartnersTable(partnersData, 'partnerName', 'desc');
      expect(sorted.map(row => row.partnerName)).toEqual(['Zeke', 'Yara', 'Xavier', 'Alex']);
    });

    it('sorts by Games column ascending on first click', () => {
      const sorted = sortPartnersTable(partnersData, 'gamesPlayed', 'asc');
      expect(sorted.map(row => row.gamesPlayed)).toEqual([2, 4, 6, 7]);
    });

    it('sorts by Games column descending on second click', () => {
      const sorted = sortPartnersTable(partnersData, 'gamesPlayed', 'desc');
      expect(sorted.map(row => row.gamesPlayed)).toEqual([7, 6, 4, 2]);
    });

    it('sorts by W (wins) column ascending on first click', () => {
      const sorted = sortPartnersTable(partnersData, 'wins', 'asc');
      expect(sorted.map(row => row.wins)).toEqual([2, 3, 4, 5]);
    });

    it('sorts by W (wins) column descending on second click', () => {
      const sorted = sortPartnersTable(partnersData, 'wins', 'desc');
      expect(sorted.map(row => row.wins)).toEqual([5, 4, 3, 2]);
    });

    it('sorts by L (losses) column ascending on first click', () => {
      const sorted = sortPartnersTable(partnersData, 'losses', 'asc');
      expect(sorted.map(row => row.losses)).toEqual([0, 1, 1, 3]);
    });

    it('sorts by L (losses) column descending on second click', () => {
      const sorted = sortPartnersTable(partnersData, 'losses', 'desc');
      expect(sorted.map(row => row.losses)).toEqual([3, 1, 1, 0]);
    });

    it('sorts by Avg Pts column ascending on first click', () => {
      const sorted = sortPartnersTable(partnersData, 'averagePointsPerGame', 'asc');
      expect(sorted.map(row => row.averagePointsPerGame)).toEqual([13.86, 14.0, 15.25, 16.5]);
    });

    it('sorts by Avg Pts column descending on second click', () => {
      const sorted = sortPartnersTable(partnersData, 'averagePointsPerGame', 'desc');
      expect(sorted.map(row => row.averagePointsPerGame)).toEqual([16.5, 15.25, 14.0, 13.86]);
    });
  });
});
