-- Route-scoped reads: compute ELO in Postgres and expose small aggregates so
-- the browser downloads only what the current page renders instead of the
-- full match history. See .github/features/route-data-loading.md.
--
-- ELO mirrors js/services/elo.js exactly: K=32, initial 1000, RMS combined
-- opponent ELO, 0-0 matches skipped, order = tournament_date, round_number,
-- match_order, ratings rounded to 2 dp after every update, and team 2 is
-- updated against team 1's already-updated ratings (sequential in-match).
--
-- All functions/views are SECURITY INVOKER, so the existing has_active_access()
-- RLS policies on the underlying tables still apply.

begin;

create index if not exists match_players_player_idx on public.match_players (player_id);

create or replace function public.elo_step(
  p_elo double precision,
  p_opp1 double precision,
  p_opp2 double precision,
  p_won boolean
)
returns double precision
language sql
immutable
set search_path = public
as $$
  select floor((
    p_elo + 32 * (
      (case when p_won then 1 else 0 end)
      - 1 / (1 + power(10::double precision,
          (sqrt((p_opp1 * p_opp1 + p_opp2 * p_opp2) / 2) - p_elo) / 400))
    )
  ) * 100 + 0.5) / 100
$$;

-- One row per (player, tournament date played): end-of-day ELO and the ELO
-- at the end of that player's previous tournament (1000 for the first).
create or replace function public.elo_timeline()
returns table (
  player_id uuid,
  tournament_date date,
  elo double precision,
  previous_elo double precision
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  ids uuid[];
  ratings double precision[];
  snapshot double precision[];
  played integer[] := '{}';
  day date := null;
  rec record;
  team1_won boolean;
  i integer;
begin
  select array_agg(s.pid order by s.pid) into ids
  from (select distinct mp.player_id as pid from public.match_players mp) s;
  if ids is null then
    return;
  end if;
  ratings := array_fill(1000::double precision, array[cardinality(ids)]);
  snapshot := ratings;

  for rec in
    with idx as (
      select u.pid, u.n::integer as n
      from unnest(ids) with ordinality as u(pid, n)
    )
    select
      t.tournament_date as d,
      m.score_team_1 as s1,
      m.score_team_2 as s2,
      max(idx.n) filter (where mp.team = 1 and mp.position = 1) as a1,
      max(idx.n) filter (where mp.team = 1 and mp.position = 2) as a2,
      max(idx.n) filter (where mp.team = 2 and mp.position = 1) as b1,
      max(idx.n) filter (where mp.team = 2 and mp.position = 2) as b2
    from public.matches m
    join public.tournaments t on t.id = m.tournament_id
    join public.match_players mp on mp.match_id = m.id
    join idx on idx.pid = mp.player_id
    where not (m.score_team_1 = 0 and m.score_team_2 = 0)
    group by m.id, t.tournament_date, m.round_number, m.match_order, m.score_team_1, m.score_team_2
    having count(*) = 4
    order by t.tournament_date, m.round_number, m.match_order, m.id
  loop
    if day is distinct from rec.d then
      foreach i in array played loop
        player_id := ids[i];
        tournament_date := day;
        elo := ratings[i];
        previous_elo := snapshot[i];
        return next;
        snapshot[i] := ratings[i];
      end loop;
      played := '{}';
      day := rec.d;
    end if;

    team1_won := rec.s1 > rec.s2;
    ratings[rec.a1] := public.elo_step(ratings[rec.a1], ratings[rec.b1], ratings[rec.b2], team1_won);
    ratings[rec.a2] := public.elo_step(ratings[rec.a2], ratings[rec.b1], ratings[rec.b2], team1_won);
    ratings[rec.b1] := public.elo_step(ratings[rec.b1], ratings[rec.a1], ratings[rec.a2], not team1_won);
    ratings[rec.b2] := public.elo_step(ratings[rec.b2], ratings[rec.a1], ratings[rec.a2], not team1_won);

    if not (rec.a1 = any(played)) then played := played || rec.a1; end if;
    if not (rec.a2 = any(played)) then played := played || rec.a2; end if;
    if not (rec.b1 = any(played)) then played := played || rec.b1; end if;
    if not (rec.b2 = any(played)) then played := played || rec.b2; end if;
  end loop;

  foreach i in array played loop
    player_id := ids[i];
    tournament_date := day;
    elo := ratings[i];
    previous_elo := snapshot[i];
    return next;
  end loop;
end;
$$;

-- ELO rows for the given tournament dates and/or players only (null = no filter).
create or replace function public.get_player_elo(
  p_dates date[] default null,
  p_player_ids uuid[] default null
)
returns table (
  player_id uuid,
  tournament_date date,
  elo double precision,
  previous_elo double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select e.player_id, e.tournament_date, e.elo, e.previous_elo
  from public.elo_timeline() e
  where (p_dates is null or e.tournament_date = any(p_dates))
    and (p_player_ids is null or e.player_id = any(p_player_ids))
  order by e.tournament_date, e.player_id
$$;

-- Latest ELO per player, optionally as of strictly before p_before (seeding).
create or replace function public.get_current_elo(p_before date default null)
returns table (
  player_id uuid,
  tournament_date date,
  elo double precision,
  previous_elo double precision
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (e.player_id) e.player_id, e.tournament_date, e.elo, e.previous_elo
  from public.elo_timeline() e
  where p_before is null or e.tournament_date < p_before
  order by e.player_id, e.tournament_date desc
$$;

create or replace view public.tournament_index
with (security_invoker = true) as
select
  t.id,
  t.tournament_date,
  t.status,
  t.current_round_number,
  coalesce(nullif(roster.n, 0), agg.player_count, 0)::integer as player_count,
  coalesce(agg.round_count, 0)::integer as round_count,
  coalesce(agg.match_count, 0)::integer as match_count,
  coalesce(agg.completed_count, 0)::integer as completed_count
from public.tournaments t
left join lateral (
  select count(*) as n from public.tournament_players tp where tp.tournament_id = t.id
) roster on true
left join lateral (
  select
    count(distinct m.round_number) as round_count,
    count(distinct m.id) as match_count,
    count(distinct m.id) filter (where m.score_team_1 <> 0 or m.score_team_2 <> 0) as completed_count,
    count(distinct mp.player_id) as player_count
  from public.matches m
  left join public.match_players mp on mp.match_id = m.id
  where m.tournament_id = t.id
) agg on true;

-- Who played on which tournament date (any match, including 0-0).
create or replace view public.player_attendance
with (security_invoker = true) as
select distinct t.tournament_date, mp.player_id
from public.match_players mp
join public.matches m on m.id = mp.match_id
join public.tournaments t on t.id = m.tournament_id;

-- All-time per-player totals (0-0 skipped; a tie counts as a loss, like
-- calculatePlayerStatistics / buildPlayerSummary in the client).
create or replace view public.player_totals
with (security_invoker = true) as
select
  mp.player_id,
  (count(*) filter (where s.own > s.opp))::integer as wins,
  (count(*) filter (where s.own <= s.opp))::integer as losses,
  sum(s.own)::integer as points,
  count(*)::integer as games,
  count(distinct t.tournament_date)::integer as tournaments
from public.match_players mp
join public.matches m on m.id = mp.match_id
join public.tournaments t on t.id = m.tournament_id
cross join lateral (
  select
    case when mp.team = 1 then m.score_team_1 else m.score_team_2 end as own,
    case when mp.team = 1 then m.score_team_2 else m.score_team_1 end as opp
) s
where not (m.score_team_1 = 0 and m.score_team_2 = 0)
group by mp.player_id;

revoke all on function public.elo_step(double precision, double precision, double precision, boolean) from public, anon;
revoke all on function public.elo_timeline() from public, anon;
revoke all on function public.get_player_elo(date[], uuid[]) from public, anon;
revoke all on function public.get_current_elo(date) from public, anon;
grant execute on function public.elo_step(double precision, double precision, double precision, boolean) to authenticated, service_role;
grant execute on function public.elo_timeline() to authenticated, service_role;
grant execute on function public.get_player_elo(date[], uuid[]) to authenticated, service_role;
grant execute on function public.get_current_elo(date) to authenticated, service_role;

revoke all on public.tournament_index, public.player_attendance, public.player_totals from public, anon;
grant select on public.tournament_index, public.player_attendance, public.player_totals to authenticated, service_role;

commit;
