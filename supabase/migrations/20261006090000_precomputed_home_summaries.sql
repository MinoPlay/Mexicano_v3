-- Precomputed summaries for the home page / month / player ELO views.
-- Statement-level triggers rebuild them whenever match data changes, so the
-- browser reads a few compact rows instead of replaying ELO on every load.
--
-- Idempotent: safe to paste into the Supabase SQL Editor and re-run.
-- Requires 20260930150000_route_scoped_reads.sql (public.elo_timeline()).

begin;

-- Clean up earlier drafts of this script.
drop trigger if exists matches_refresh_home_derived on public.matches;
drop trigger if exists tournament_players_refresh_home_derived on public.tournament_players;
drop trigger if exists tournaments_refresh_home_derived on public.tournaments;
drop trigger if exists match_players_refresh_home_derived on public.match_players;
drop function if exists public.refresh_home_derived_tables();
drop function if exists public.refresh_player_tournament_elo(date[]);
drop function if exists public.refresh_player_monthly_summary(text[]);
drop function if exists public.refresh_player_tournament_elo();
drop function if exists public.refresh_player_monthly_summary();
drop function if exists public.refresh_home_route_summary();
drop function if exists public.rebuild_home_summaries();

create table if not exists public.player_tournament_elo (
  player_id uuid not null,
  tournament_date date not null,
  elo double precision not null,
  previous_elo double precision not null,
  elo_delta double precision not null,
  updated_at timestamptz not null default now(),
  primary key (player_id, tournament_date)
);

create table if not exists public.player_monthly_summary (
  year_month text not null,
  player_id uuid not null,
  wins integer not null default 0,
  losses integer not null default 0,
  points integer not null default 0,
  games integer not null default 0,
  average double precision not null default 0,
  elo double precision,
  previous_elo double precision,
  elo_delta double precision,
  updated_at timestamptz not null default now(),
  primary key (year_month, player_id)
);

create table if not exists public.home_route_summary (
  id smallint primary key default 1,
  snapshot_at timestamptz not null default now(),
  latest_tournament_date date,
  current_year_month text,
  previous_year_month text,
  latest_tournament jsonb not null default '[]'::jsonb,
  current_month jsonb not null default '[]'::jsonb,
  previous_month jsonb not null default '[]'::jsonb
);

-- Full rebuild (not upsert) so deleted matches/tournaments never leave stale rows.
create or replace function public.rebuild_home_summaries()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest_date date;
  v_current_month text := to_char(current_date, 'YYYY-MM');
  v_previous_month text := to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM');
begin
  delete from public.player_tournament_elo where true;
  insert into public.player_tournament_elo (player_id, tournament_date, elo, previous_elo, elo_delta)
  select
    e.player_id,
    e.tournament_date,
    e.elo,
    e.previous_elo,
    round((e.elo - e.previous_elo)::numeric, 2)::double precision
  from public.elo_timeline() e;

  delete from public.player_monthly_summary where true;
  insert into public.player_monthly_summary (
    year_month, player_id, wins, losses, points, games, average, elo, previous_elo, elo_delta
  )
  with month_stats as (
    select
      to_char(t.tournament_date, 'YYYY-MM') as year_month,
      mp.player_id,
      (count(*) filter (where s.own > s.opp))::integer as wins,
      (count(*) filter (where s.own <= s.opp))::integer as losses,
      coalesce(sum(s.own), 0)::integer as points,
      count(*)::integer as games
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    join public.tournaments t on t.id = m.tournament_id
    cross join lateral (
      select
        case when mp.team = 1 then m.score_team_1 else m.score_team_2 end as own,
        case when mp.team = 1 then m.score_team_2 else m.score_team_1 end as opp
    ) s
    where not (m.score_team_1 = 0 and m.score_team_2 = 0)
    group by 1, 2
  ),
  month_elo as (
    select distinct on (to_char(pte.tournament_date, 'YYYY-MM'), pte.player_id)
      to_char(pte.tournament_date, 'YYYY-MM') as year_month,
      pte.player_id,
      pte.elo
    from public.player_tournament_elo pte
    order by to_char(pte.tournament_date, 'YYYY-MM'), pte.player_id, pte.tournament_date desc
  ),
  month_start_elo as (
    -- ELO at the end of the player's last tournament before this month (1000 if none).
    select distinct on (to_char(pte.tournament_date, 'YYYY-MM'), pte.player_id)
      to_char(pte.tournament_date, 'YYYY-MM') as year_month,
      pte.player_id,
      pte.previous_elo
    from public.player_tournament_elo pte
    order by to_char(pte.tournament_date, 'YYYY-MM'), pte.player_id, pte.tournament_date asc
  )
  select
    s.year_month,
    s.player_id,
    s.wins,
    s.losses,
    s.points,
    s.games,
    round((s.points::numeric / nullif(s.games, 0)), 2)::double precision,
    e.elo,
    st.previous_elo,
    round((e.elo - st.previous_elo)::numeric, 2)::double precision
  from month_stats s
  left join month_elo e on e.year_month = s.year_month and e.player_id = s.player_id
  left join month_start_elo st on st.year_month = s.year_month and st.player_id = s.player_id;

  select max(tournament_date) into v_latest_date
  from public.tournaments
  where status = 'completed';

  insert into public.home_route_summary (
    id, snapshot_at, latest_tournament_date, current_year_month, previous_year_month,
    latest_tournament, current_month, previous_month
  )
  values (
    1,
    now(),
    v_latest_date,
    v_current_month,
    v_previous_month,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', p.player_id, 'elo', p.elo,
        'previous_elo', p.previous_elo, 'elo_delta', p.elo_delta
      ) order by p.elo desc)
      from public.player_tournament_elo p
      where p.tournament_date = v_latest_date
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(to_jsonb(ms) - 'updated_at' - 'year_month' order by ms.points desc)
      from public.player_monthly_summary ms
      where ms.year_month = v_current_month
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(to_jsonb(ms) - 'updated_at' - 'year_month' order by ms.points desc)
      from public.player_monthly_summary ms
      where ms.year_month = v_previous_month
    ), '[]'::jsonb)
  )
  on conflict (id) do update set
    snapshot_at = excluded.snapshot_at,
    latest_tournament_date = excluded.latest_tournament_date,
    current_year_month = excluded.current_year_month,
    previous_year_month = excluded.previous_year_month,
    latest_tournament = excluded.latest_tournament,
    current_month = excluded.current_month,
    previous_month = excluded.previous_month;
end;
$$;

create or replace function public.refresh_home_derived_tables()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rebuild_home_summaries();
  return null;
end;
$$;

create trigger matches_refresh_home_derived
after insert or update or delete on public.matches
for each statement execute function public.refresh_home_derived_tables();

create trigger match_players_refresh_home_derived
after insert or update or delete on public.match_players
for each statement execute function public.refresh_home_derived_tables();

create trigger tournaments_refresh_home_derived
after insert or update or delete on public.tournaments
for each statement execute function public.refresh_home_derived_tables();

-- Read access mirrors the source tables: signed-in users with active access only.
alter table public.player_tournament_elo enable row level security;
alter table public.player_monthly_summary enable row level security;
alter table public.home_route_summary enable row level security;

drop policy if exists player_tournament_elo_read on public.player_tournament_elo;
create policy player_tournament_elo_read on public.player_tournament_elo
  for select using (public.has_active_access());
drop policy if exists player_monthly_summary_read on public.player_monthly_summary;
create policy player_monthly_summary_read on public.player_monthly_summary
  for select using (public.has_active_access());
drop policy if exists home_route_summary_read on public.home_route_summary;
create policy home_route_summary_read on public.home_route_summary
  for select using (public.has_active_access());

revoke all on public.player_tournament_elo, public.player_monthly_summary, public.home_route_summary from public, anon, authenticated;
grant select on public.player_tournament_elo, public.player_monthly_summary, public.home_route_summary to authenticated, service_role;

-- Rebuild is only invoked by triggers (or manually by an admin in the SQL Editor).
revoke all on function public.rebuild_home_summaries() from public, anon, authenticated;
revoke all on function public.refresh_home_derived_tables() from public, anon, authenticated;
grant execute on function public.rebuild_home_summaries() to service_role;

-- Initial backfill.
select public.rebuild_home_summaries();

commit;
