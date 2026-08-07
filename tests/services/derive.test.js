import { describe, it, expect } from 'vitest';
import {
  computeFinalElo,
  buildPlayersSummary,
  buildMonthlyOverview,
  computeTournamentDates,
  buildTournamentsIndex,
  buildEloHistoryFile,
} from '../../js/services/derive.js';

// Two tournament days. Day 1 fully complete (scores sum to 25), day 2 partial.
const matches = [
  { date: '2024-01-06', roundNumber: 1, scoreTeam1: 13, scoreTeam2: 12,
    team1Player1Name: 'A', team1Player2Name: 'B', team2Player1Name: 'C', team2Player2Name: 'D' },
  { date: '2024-01-06', roundNumber: 2, scoreTeam1: 15, scoreTeam2: 10,
    team1Player1Name: 'A', team1Player2Name: 'C', team2Player1Name: 'B', team2Player2Name: 'D' },
  { date: '2024-02-03', roundNumber: 1, scoreTeam1: 20, scoreTeam2: 5,
    team1Player1Name: 'A', team1Player2Name: 'D', team2Player1Name: 'B', team2Player2Name: 'C' },
];

describe('derive: runtime computation from raw matches', () => {
  it('computeTournamentDates returns sorted distinct dates', () => {
    expect(computeTournamentDates(matches)).toEqual(['2024-01-06', '2024-02-03']);
  });

  it('buildTournamentsIndex flags completeness by 25-point sum', () => {
    const idx = buildTournamentsIndex(matches);
    const jan = idx.find(e => e.date === '2024-01-06');
    const feb = idx.find(e => e.date === '2024-02-03');
    expect(jan.matchCount).toBe(2);
    expect(jan.completedCount).toBe(2);
    expect(jan.isComplete).toBe(true);
    expect(feb.completedCount).toBe(1);
    expect(feb.isComplete).toBe(true);
    expect(jan.playerCount).toBe(4);
  });

  it('computeFinalElo assigns ratings and is symmetric (winners up, losers down)', () => {
    const elo = computeFinalElo(matches);
    expect(Object.keys(elo).sort()).toEqual(['A', 'B', 'C', 'D']);
    // A won all three matches -> highest ELO, above the 1000 baseline.
    expect(elo.A).toBeGreaterThan(1000);
  });

  it('buildPlayersSummary merges registry metadata and stats', () => {
    const summary = buildPlayersSummary(matches, [{ name: 'A', matchPadelId: 'mp-1' }]);
    const a = summary.find(p => p.name === 'A');
    expect(a.matchPadelId).toBe('mp-1');
    expect(a.tournaments).toBe(2); // appears on both days
    expect(a.wins + a.losses).toBeGreaterThan(0);
    expect(a.id).toBe('A');
  });

  it('buildMonthlyOverview scopes stats to the month', () => {
    const jan = buildMonthlyOverview(matches, '2024-01');
    const aJan = jan.find(p => p.name === 'A');
    // A scored 13 + 15 = 28 points in January.
    expect(aJan.totalPoints).toBe(28);
    const feb = buildMonthlyOverview(matches, '2024-02');
    const aFeb = feb.find(p => p.name === 'A');
    expect(aFeb.totalPoints).toBe(20);
  });

  it('buildPlayersSummary sets previousElo to the pre-latest-tournament rating', () => {
    const summary = buildPlayersSummary(matches);
    const a = summary.find(p => p.name === 'A');
    // A played two days; previousElo must be the ELO after day 1 (2024-01-06),
    // i.e. NOT equal to the final ELO after day 2 — otherwise ELO change is always 0.
    const day1Only = matches.filter(m => m.date === '2024-01-06');
    const day1Final = computeFinalElo(day1Only).A;
    expect(a.previousElo).toBeCloseTo(day1Final, 10);
    expect(a.previousElo).not.toBeCloseTo(a.elo, 10);
  });

  it('buildMonthlyOverview uses month-end ELO so month-over-month differs', () => {
    const jan = buildMonthlyOverview(matches, '2024-01');
    const feb = buildMonthlyOverview(matches, '2024-02');
    const aJan = jan.find(p => p.name === 'A').elo;
    const aFeb = feb.find(p => p.name === 'A').elo;
    // A kept winning, so end-of-Feb ELO must be strictly higher than end-of-Jan.
    expect(aFeb).toBeGreaterThan(aJan);
  });

  it('buildEloHistoryFile yields one dated point per day with deltas', () => {
    const file = buildEloHistoryFile(matches, 'A');
    expect(file.playerName).toBe('A');
    expect(file.points.map(p => p.date)).toEqual(['2024-01-06', '2024-02-03']);
    expect(file.points[0].delta).toBe(0);
    // second point delta equals diff from first
    const [p1, p2] = file.points;
    expect(p2.delta).toBeCloseTo(Math.round((p2.elo - p1.elo) * 100) / 100, 10);
  });
});
