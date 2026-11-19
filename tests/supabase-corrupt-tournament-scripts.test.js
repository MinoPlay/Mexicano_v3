import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const INSPECT = fs.readFileSync(path.resolve('supabase/scripts/inspect-corrupt-tournaments.sql'), 'utf8');
const FIX = fs.readFileSync(path.resolve('supabase/scripts/fix-corrupt-tournaments.sql'), 'utf8');

const SCHEMA = `
  create table public.players (id serial primary key, name text not null unique);
  create table public.tournaments (
    id uuid primary key default gen_random_uuid(),
    tournament_date date not null unique,
    status text not null default 'planned',
    current_round_number integer,
    completed_at timestamptz
  );
  create table public.tournament_players (
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    player_id integer not null references public.players(id),
    primary key (tournament_id, player_id)
  );
  create table public.matches (
    id uuid primary key default gen_random_uuid(),
    tournament_id uuid not null references public.tournaments(id) on delete cascade,
    round_number integer not null, match_order integer not null,
    score_team_1 integer not null, score_team_2 integer not null
  );
  create table public.match_players (
    match_id uuid not null references public.matches(id) on delete cascade,
    player_id integer not null references public.players(id),
    team smallint not null, position smallint not null,
    primary key (match_id, team, position)
  );
  insert into public.players (name) values ('A'), ('B'), ('C'), ('D'), ('E');
`;

async function addTournament(db, date, status, rounds, roster = []) {
  const { rows: [t] } = await db.query(
    `insert into public.tournaments (tournament_date, status, current_round_number) values ($1, $2, $3) returning id`,
    [date, status, rounds.length],
  );
  for (const name of roster) {
    await db.query(`insert into public.tournament_players select $1, id from public.players where name = $2`, [t.id, name]);
  }
  for (const [r, matches] of rounds.entries()) {
    for (const [o, { score, players = ['A', 'B', 'C', 'D'] }] of matches.entries()) {
      const { rows: [m] } = await db.query(
        `insert into public.matches (tournament_id, round_number, match_order, score_team_1, score_team_2)
         values ($1, $2, $3, $4, $5) returning id`,
        [t.id, r + 1, o + 1, score[0], score[1]],
      );
      for (const [i, name] of players.entries()) {
        await db.query(
          `insert into public.match_players select $1, id, $2, $3 from public.players where name = $4`,
          [m.id, i < 2 ? 1 : 2, (i % 2) + 1, name],
        );
      }
    }
  }
}

async function inspect(db) {
  const { rows } = await db.query(INSPECT);
  return rows.map((r) => `${r.tournament_date.toISOString().slice(0, 10)} ${r.issue}: ${r.detail}`);
}

function fixFor(dates) {
  const list = `array[${dates.map((d) => `'${d}'`).join(',')}]::date[]`;
  return FIX.replace('array[]::date[];', `${list};`);
}

async function matchCount(db, date) {
  const { rows: [r] } = await db.query(
    `select count(m.id)::int as n from public.tournaments t left join public.matches m on m.tournament_id = t.id where t.tournament_date = $1`,
    [date],
  );
  return r.n;
}

describe('corrupt tournament scripts', () => {
  let db;

  beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
  }, 60000);

  beforeEach(async () => {
    await db.exec(`drop schema public cascade; create schema public; ${SCHEMA}`);
    // Matches 2026-09-22: rounds 2-3 scored, rounds 1 and 4 unscored.
    await addTournament(db, '2020-01-01', 'completed', [
      [{ score: [0, 0] }], [{ score: [21, 10] }], [{ score: [15, 16] }], [{ score: [0, 0] }],
    ]);
    await addTournament(db, '2020-01-02', 'completed', [[{ score: [20, 12] }], [{ score: [11, 21] }]]);
    await addTournament(db, '2020-01-03', 'planned', [
      [{ score: [20, 12] }, { score: [0, 0], players: ['A', 'E', 'C'] }],
    ], ['A', 'B', 'C', 'D']);
    await addTournament(db, '2999-01-01', 'planned', [[{ score: [0, 0] }], [{ score: [0, 0] }]]);
  });

  it('reports only past tournaments with inconsistent matches', async () => {
    expect(await inspect(db)).toEqual([
      '2020-01-01 round_gap: round 1 unscored',
      '2020-01-01 status_mismatch: status completed with 2 of 4 matches scored',
      '2020-01-01 trailing_unscored_round: round 4 unscored',
      '2020-01-03 bad_player_count: round 1 match 2 has 3 players',
      '2020-01-03 duplicate_player_in_round: round 1: A in 2 matches',
      '2020-01-03 duplicate_player_in_round: round 1: C in 2 matches',
      '2020-01-03 partial_round: round 1: 1 scored, 1 unscored',
      '2020-01-03 player_not_in_roster: round 1 match 2: E',
      '2020-01-03 status_mismatch: status planned with 1 of 2 matches scored',
    ]);
  });

  it('changes nothing while target_dates is empty', async () => {
    await db.exec(FIX);
    expect(await matchCount(db, '2020-01-01')).toBe(4);
  });

  it('removes matches only for listed dates and resets progress', async () => {
    await db.exec(fixFor(['2020-01-01']));

    expect(await matchCount(db, '2020-01-01')).toBe(0);
    expect(await matchCount(db, '2020-01-02')).toBe(2);
    const { rows: [t] } = await db.query(
      `select status, current_round_number from public.tournaments where tournament_date = '2020-01-01'`,
    );
    expect(t).toEqual({ status: 'planned', current_round_number: null });
    expect((await db.query('select count(*)::int as n from public.match_players')).rows[0].n).toBe(23);
  });

  it('repairs 2022-12-22, 2026-09-22 and 2026-09-15', async () => {
    const names = ['Mattijs', 'Ulrik', 'Jan Sørensen', 'Peter Soderlund', 'Mino', 'Jeremy', 'Kikke', 'Peter'];
    await db.query(`insert into public.players (name) select unnest($1::text[])`, [names]);
    const mixed = (n) => ({ score: [n, 25 - n], players: ['Mino', 'Jeremy', 'Kikke', 'Peter'] });
    await addTournament(db, '2022-12-22', 'completed', [[mixed(13)], [mixed(0)]]);
    await addTournament(db, '2026-09-22', 'completed', [[{ score: [16, 9] }], [{ score: [20, 5] }], [{ score: [0, 0] }]]);
    await addTournament(db, '2026-09-15', 'completed', [[{ score: [14, 11] }, { score: [0, 0], players: ['Mattijs', 'Ulrik', 'Mino', 'Jeremy'] }]]);

    await db.exec(fs.readFileSync(path.resolve('supabase/scripts/repair-2022-12-22-and-2026-09.sql'), 'utf8'));

    const { rows } = await db.query(`
      select m.round_number as r, m.match_order as o, m.score_team_1 || '-' || m.score_team_2 as s,
        string_agg(p.name, ',' order by mp.team, mp.position) as players
      from public.matches m
      join public.tournaments t on t.id = m.tournament_id
      join public.match_players mp on mp.match_id = m.id
      join public.players p on p.id = mp.player_id
      where t.tournament_date = '2022-12-22'
      group by m.id order by 1, 2`);
    expect(rows).toHaveLength(16);
    expect(rows[2]).toEqual({ r: 2, o: 1, s: '12-13', players: 'Kikke,Mattijs,Peter,Ulrik' });
    expect(rows[3]).toEqual({ r: 2, o: 2, s: '6-19', players: 'Jan Sørensen,Mino,Peter Soderlund,Jeremy' });
    const unscored = async (date) => (await db.query(`
      select m.round_number as r, m.score_team_1 + m.score_team_2 as total from public.matches m
      join public.tournaments t on t.id = m.tournament_id where t.tournament_date = $1 order by 1`, [date])).rows;
    expect(await unscored('2026-09-22')).toEqual([{ r: 1, total: 0 }]);
    expect(await unscored('2026-09-15')).toEqual([{ r: 1, total: 0 }, { r: 1, total: 0 }]);
    expect((await inspect(db)).filter((line) => /^20(22-12-22|26-09)/.test(line))).toEqual([]);
  });

  it('aborts without changes on an unknown or future date', async () => {
    await expect(db.exec(fixFor(['2020-01-01', '2020-05-05']))).rejects.toThrow('No tournament on 2020-05-05');
    await expect(db.exec(fixFor(['2999-01-01']))).rejects.toThrow('only past tournaments');
    expect(await matchCount(db, '2020-01-01')).toBe(4);
  });
});
