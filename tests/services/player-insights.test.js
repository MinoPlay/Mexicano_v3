import { describe, it, expect } from 'vitest';
import {
  buildPlayerRows,
  buildPlayerDetail,
  buildPairMatrix,
  buildHeadToHead,
  eloMovers,
} from '../../js/services/player-insights.js';
import { loadAllMatches } from '../helpers/load-matches.js';

const m = (date, roundNumber, s1, s2, a, b, c, d) => ({
  date, roundNumber, scoreTeam1: s1, scoreTeam2: s2,
  team1Player1Name: a, team1Player2Name: b, team2Player1Name: c, team2Player2Name: d,
});

const SMALL = [
  m('2026-01-01', 1, 25, 10, 'A', 'B', 'C', 'D'),
  m('2026-01-01', 2, 12, 13, 'A', 'C', 'B', 'D'),
  m('2026-01-01', 3, 0, 0, 'A', 'D', 'B', 'C'), // ignored
  m('2026-01-08', 1, 20, 15, 'A', 'B', 'C', 'D'),
  m('2026-01-08', 2, 18, 17, 'B', 'E', 'C', 'D'),
];

describe('buildPairMatrix', () => {
  const one = [m('2026-01-01', 1, 25, 10, 'A', 'B', 'C', 'D')];

  it('partner mode', () => {
    const { cells } = buildPairMatrix(one, ['A', 'B', 'C', 'D'], 'partner');
    expect(cells.A.B).toEqual({ games: 1, wins: 1, winRate: 100 });
    expect(cells.C.D).toEqual({ games: 1, wins: 0, winRate: 0 });
    expect(cells.A.C).toBeNull();
    expect(cells.A.A).toBeNull();
  });

  it('opponent mode', () => {
    const { cells } = buildPairMatrix(one, ['A', 'B', 'C', 'D'], 'opponent');
    expect(cells.A.C).toEqual({ games: 1, wins: 1, winRate: 100 });
    expect(cells.C.A.winRate).toBe(0);
    expect(cells.A.B).toBeNull();
  });
});

describe('buildHeadToHead', () => {
  it('counts against and together', () => {
    const h = buildHeadToHead('A', 'C', SMALL);
    expect(h.against).toEqual({ games: 2, aWins: 2, bWins: 0 });
    expect(h.together).toEqual({ games: 1, wins: 0, winRate: 0 });
  });
});

describe('buildPlayerRows (small)', () => {
  const rows = buildPlayerRows(SMALL, { recentTournaments: 1, formGames: 3 });
  const byName = Object.fromEntries(rows.map(r => [r.name, r]));

  it('one row per player, sorted by elo desc', () => {
    expect(rows.map(r => r.name).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].elo).toBeGreaterThanOrEqual(rows[i].elo);
  });

  it('computes games/wins/avg/form/attendance', () => {
    expect(byName.A).toMatchObject({ games: 3, wins: 2, losses: 1, tournaments: 2, lastPlayed: '2026-01-08' });
    expect(byName.A.avgPoints).toBe(19);
    expect(byName.A.winRate).toBe(66.67);
    expect(byName.A.form).toEqual(['W', 'L', 'W']);
    expect(byName.A.attendance).toBe(100);
    expect(byName.E.tournaments).toBe(1);
  });

  it('eloDelta only covers the recent window', () => {
    expect(byName.E.eloDelta).toBeGreaterThan(0);
    expect(byName.A.eloDelta).not.toBe(0);
  });

  it('firsts and podiums from tournament placements', () => {
    // 2026-01-01: B 38, A 37, D 23, C 22. 2026-01-08: B 38, C 32, D 32, A 20, E 18
    expect(byName.B.firsts).toBe(2);
    expect(byName.A.podiums).toBe(1);
    expect(byName.D.podiums).toBe(2);
  });
});

describe('buildPlayerDetail (small)', () => {
  const d = buildPlayerDetail('A', SMALL, { minGames: 1 });

  it('recent matches newest first with partner/opponents', () => {
    expect(d.recentMatches[0]).toEqual({
      date: '2026-01-08', round: 1, partner: 'B', opponents: ['C', 'D'], score: 20, oppScore: 15, won: true,
    });
    expect(d.recentMatches).toHaveLength(3);
  });

  it('tournaments newest first with place', () => {
    expect(d.tournaments[0]).toMatchObject({ date: '2026-01-08', place: 4, of: 5, points: 20, wins: 1, games: 1 });
    expect(d.tournaments[1]).toMatchObject({ date: '2026-01-01', place: 2 });
  });

  it('best/worst partner, nemesis', () => {
    expect(d.bestPartner.partnerName).toBe('B');
    expect(d.worstPartner.partnerName).toBe('C');
    expect(d.nemesis.opponentName).toBe('B');
    expect(d.eloHistory.map(p => p.date)).toEqual(['2026-01-01', '2026-01-08']);
  });

  it('returns null picks when below minGames', () => {
    const d2 = buildPlayerDetail('A', SMALL, { minGames: 5 });
    expect(d2.bestPartner).toBeNull();
    expect(d2.nemesis).toBeNull();
  });
});

describe('eloMovers', () => {
  it('defaults to latest tournament, sorted delta desc', () => {
    const r = eloMovers(SMALL);
    expect(r.date).toBe('2026-01-08');
    expect(r.rows.map(x => x.name).sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    for (let i = 1; i < r.rows.length; i++) expect(r.rows[i - 1].delta).toBeGreaterThanOrEqual(r.rows[i].delta);
    const e = r.rows.find(x => x.name === 'E');
    expect(e.before).toBe(1000);
  });
});

describe('buildPlayerRows (fixture)', () => {
  const all = loadAllMatches();
  const rows = buildPlayerRows(all);

  it('row per distinct player, games = wins + losses', () => {
    const names = new Set();
    for (const x of all) {
      if (x.scoreTeam1 === 0 && x.scoreTeam2 === 0) continue;
      [x.team1Player1Name, x.team1Player2Name, x.team2Player1Name, x.team2Player2Name].forEach(n => names.add(n));
    }
    expect(rows).toHaveLength(names.size);
    for (const r of rows) expect(r.games).toBe(r.wins + r.losses);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].elo).toBeGreaterThanOrEqual(rows[i].elo);
  });
});
