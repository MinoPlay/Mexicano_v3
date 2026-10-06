import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { calculateAllEloRankings, getEloSnapshots } from '../js/services/elo.js';
import { loadAllMatches } from './helpers/load-matches.js';

const MIGRATION = path.resolve('supabase/migrations/20260930150000_route_scoped_reads.sql');

const BASE_SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create table public.players (id uuid primary key, name text not null unique, active boolean not null default true);
  create table public.tournaments (
    id uuid primary key default gen_random_uuid(),
    tournament_date date not null unique,
    status text not null default 'planned',
    current_round_number integer
  );
  create table public.tournament_players (
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    player_id uuid not null references public.players(id),
    seed_position integer, confirmed boolean not null default false,
    primary key (tournament_id, player_id)
  );
  create table public.matches (
    id uuid primary key default gen_random_uuid(),
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    round_number integer not null, match_order integer not null,
    score_team_1 integer not null, score_team_2 integer not null,
    unique (tournament_id, round_number, match_order)
  );
  create table public.match_players (
    match_id uuid not null references public.matches(id) on delete cascade,
    player_id uuid not null references public.players(id),
    team smallint not null, position smallint not null,
    primary key (match_id, team, position)
  );
`;

function uuidFor(prefix, n) {
  return `${prefix}0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

async function seed(db, matches, { roster = {} } = {}) {
  const names = [...new Set(matches.flatMap((m) => [
    m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name,
  ]))].sort();
  const playerId = new Map(names.map((name, i) => [name, uuidFor('a', i + 1)]));
  const dates = [...new Set(matches.map((m) => m.date))].sort();
  const tournamentId = new Map(dates.map((date, i) => [date, uuidFor('b', i + 1)]));
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

  await db.exec(`insert into public.players (id, name) values ${
    names.map((n) => `(${q(playerId.get(n))}, ${q(n)})`).join(',')};`);
  await db.exec(`insert into public.tournaments (id, tournament_date, status) values ${
    dates.map((d) => `(${q(tournamentId.get(d))}, ${q(d)}, 'completed')`).join(',')};`);
  for (const [date, players] of Object.entries(roster)) {
    await db.exec(`insert into public.tournament_players (tournament_id, player_id) values ${
      players.map((p) => `(${q(tournamentId.get(date))}, ${q(playerId.get(p))})`).join(',')};`);
  }

  const order = new Map();
  const matchRows = [];
  const slotRows = [];
  matches.forEach((m, i) => {
    const key = `${m.date}|${m.roundNumber}`;
    const matchOrder = (order.get(key) || 0) + 1;
    order.set(key, matchOrder);
    const id = uuidFor('c', i + 1);
    matchRows.push(`(${q(id)}, ${q(tournamentId.get(m.date))}, ${m.roundNumber}, ${matchOrder}, ${m.scoreTeam1}, ${m.scoreTeam2})`);
    [[1, 1, m.team1Player1Name], [1, 2, m.team1Player2Name], [2, 1, m.team2Player1Name], [2, 2, m.team2Player2Name]]
      .forEach(([team, position, name]) => slotRows.push(`(${q(id)}, ${q(playerId.get(name))}, ${team}, ${position})`));
  });
  for (let i = 0; i < matchRows.length; i += 2000) {
    await db.exec(`insert into public.matches (id, tournament_id, round_number, match_order, score_team_1, score_team_2) values ${matchRows.slice(i, i + 2000).join(',')};`);
  }
  for (let i = 0; i < slotRows.length; i += 4000) {
    await db.exec(`insert into public.match_players (match_id, player_id, team, position) values ${slotRows.slice(i, i + 4000).join(',')};`);
  }
  const nameById = new Map([...playerId].map(([name, id]) => [id, name]));
  return { playerId, nameById, tournamentId };
}

async function freshDb() {
  const db = new PGlite();
  await db.exec(BASE_SCHEMA);
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  return db;
}

const iso = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value));

describe('route-scoped read migration (Postgres via PGlite)', () => {
  it('ships the migration file with invoker security and authenticated grants', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    for (const fn of ['elo_timeline', 'get_player_elo', 'get_current_elo']) {
      expect(sql).toMatch(new RegExp(`function public\\.${fn}\\(`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`));
    }
    expect(sql).toMatch(/view public\.tournament_index\s+with \(security_invoker = true\)/);
    expect(sql).toMatch(/view public\.player_attendance\s+with \(security_invoker = true\)/);
    expect(sql).toMatch(/view public\.player_totals\s+with \(security_invoker = true\)/);
    expect(sql).not.toMatch(/security definer/);
  });

  describe('small fixture', () => {
    let db;
    let ids;
    beforeAll(async () => {
      db = await freshDb();
      ids = await seed(db, [
        { date: '2026-01-01', roundNumber: 1, scoreTeam1: 13, scoreTeam2: 10, team1Player1Name: 'A', team1Player2Name: 'B', team2Player1Name: 'C', team2Player2Name: 'D' },
        { date: '2026-01-01', roundNumber: 2, scoreTeam1: 0, scoreTeam2: 0, team1Player1Name: 'A', team1Player2Name: 'C', team2Player1Name: 'B', team2Player2Name: 'D' },
        { date: '2026-02-01', roundNumber: 1, scoreTeam1: 8, scoreTeam2: 8, team1Player1Name: 'A', team1Player2Name: 'C', team2Player1Name: 'B', team2Player2Name: 'E' },
      ], { roster: { '2026-01-01': ['A', 'B', 'C', 'D', 'E'] } });
    });
    afterAll(() => db?.close());

    it('applies sequential in-match updates (team 2 sees team 1 updated ELO)', async () => {
      const { rows } = await db.query(
        `select player_id, elo, previous_elo from public.get_player_elo(array['2026-01-01']::date[])`,
      );
      const byName = Object.fromEntries(rows.map((r) => [ids.nameById.get(r.player_id), r]));
      expect(byName.A).toMatchObject({ elo: 1016, previous_elo: 1000 });
      expect(byName.C).toMatchObject({ elo: 984.74, previous_elo: 1000 });
      expect(byName.E).toBeUndefined();
    });

    it('filters by player ids and reports previous_elo from the prior tournament date', async () => {
      const { rows } = await db.query(
        'select tournament_date, elo, previous_elo from public.get_player_elo(null, $1::uuid[])',
        [[ids.playerId.get('A')]],
      );
      expect(rows.map((r) => iso(r.tournament_date))).toEqual(['2026-01-01', '2026-02-01']);
      expect(rows[1].previous_elo).toBe(1016);
    });

    it('returns latest ELO strictly before a date for seeding', async () => {
      const { rows } = await db.query(
        `select player_id, tournament_date, elo from public.get_current_elo('2026-02-01')`,
      );
      const byName = Object.fromEntries(rows.map((r) => [ids.nameById.get(r.player_id), r]));
      expect(byName.A.elo).toBe(1016);
      expect(iso(byName.A.tournament_date)).toBe('2026-01-01');
      expect(byName.E).toBeUndefined();
    });

    it('aggregates the tournament index server-side', async () => {
      const { rows } = await db.query(
        'select tournament_date, status, player_count, round_count, match_count, completed_count from public.tournament_index order by tournament_date',
      );
      expect(rows.map((r) => ({ ...r, tournament_date: iso(r.tournament_date) }))).toEqual([
        { tournament_date: '2026-01-01', status: 'completed', player_count: 5, round_count: 2, match_count: 2, completed_count: 1 },
        { tournament_date: '2026-02-01', status: 'completed', player_count: 4, round_count: 1, match_count: 1, completed_count: 1 },
      ]);
    });

    it('aggregates all-time player totals, skipping 0-0 and counting ties as losses', async () => {
      const { rows } = await db.query('select player_id, wins, losses, points, games, tournaments from public.player_totals');
      const byName = Object.fromEntries(rows.map((r) => [ids.nameById.get(r.player_id), r]));
      expect(byName.A).toMatchObject({ wins: 1, losses: 1, points: 21, games: 2, tournaments: 2 });
      expect(byName.D).toMatchObject({ wins: 0, losses: 1, points: 10, games: 1, tournaments: 1 });
      expect(byName.E).toMatchObject({ wins: 0, losses: 1, points: 8, games: 1, tournaments: 1 });
    });

    it('lists distinct (date, player) attendance pairs including 0-0 matches', async () => {
      const { rows } = await db.query('select count(*)::int as n from public.player_attendance');
      expect(rows[0].n).toBe(8);
    });
  });

  describe('full production history parity with js/services/elo.js', () => {
    const matches = loadAllMatches();
    let db;
    let ids;
    beforeAll(async () => {
      db = await freshDb();
      ids = await seed(db, matches);
    }, 120_000);
    afterAll(() => db?.close());

    it('matches every per-date snapshot and previous ELO', async () => {
      const { snapshots } = getEloSnapshots(matches);
      const { rows } = await db.query('select player_id, tournament_date, elo, previous_elo from public.get_player_elo()');
      const expectedCount = Object.values(snapshots).reduce((n, byDate) => n + Object.keys(byDate).length, 0);
      expect(rows.length).toBe(expectedCount);

      let mismatches = 0;
      for (const row of rows) {
        const name = ids.nameById.get(row.player_id);
        const date = iso(row.tournament_date);
        const byDate = snapshots[name];
        const dates = Object.keys(byDate).sort();
        const prev = dates.indexOf(date) > 0 ? byDate[dates[dates.indexOf(date) - 1]] : 1000;
        if (Math.abs(row.elo - byDate[date]) > 0.011 || Math.abs(row.previous_elo - prev) > 0.011) mismatches += 1;
      }
      expect(mismatches).toBe(0);
    });

    it('computes the full timeline quickly', async () => {
      const start = performance.now();
      await db.query("select * from public.get_player_elo(array['2026-05-12']::date[])");
      expect(performance.now() - start).toBeLessThan(3000);
    });

    it('matches all-time totals computed from matches in JS', async () => {
      const totals = {};
      for (const m of matches) {
        if (m.scoreTeam1 === 0 && m.scoreTeam2 === 0) continue;
        for (const [names, own, opp] of [
          [[m.team1Player1Name, m.team1Player2Name], m.scoreTeam1, m.scoreTeam2],
          [[m.team2Player1Name, m.team2Player2Name], m.scoreTeam2, m.scoreTeam1],
        ]) {
          for (const n of names) {
            const t = totals[n] ||= { wins: 0, losses: 0, points: 0, games: 0, dates: new Set() };
            t.points += own; t.games += 1; t.dates.add(m.date);
            if (own > opp) t.wins += 1; else t.losses += 1;
          }
        }
      }
      const { rows } = await db.query('select player_id, wins, losses, points, games, tournaments from public.player_totals');
      expect(rows.length).toBe(Object.keys(totals).length);
      for (const r of rows) {
        const t = totals[ids.nameById.get(r.player_id)];
        expect(r).toMatchObject({ wins: t.wins, losses: t.losses, points: t.points, games: t.games, tournaments: t.dates.size });
      }
    });

    it('matches current ELO rankings', async () => {
      const { rankings } = calculateAllEloRankings(matches);
      const { rows } = await db.query('select player_id, elo from public.get_current_elo()');
      const sqlByName = Object.fromEntries(rows.map((r) => [ids.nameById.get(r.player_id), r.elo]));
      expect(rows.length).toBe(rankings.length);
      for (const r of rankings) expect(sqlByName[r.name]).toBeCloseTo(r.elo, 1);
    });
  });
});
