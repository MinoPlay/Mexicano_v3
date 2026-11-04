-- tournament_index hit statement_timeout (57014).
-- 1. RLS: `using (public.has_active_access())` runs the security-definer lookup
--    once per row scanned. Wrapping it in a scalar subquery turns it into an
--    InitPlan evaluated once per statement (Supabase RLS performance guidance).
-- 2. tournament_index: replace per-tournament lateral subqueries with
--    set-based aggregates.
begin;

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname, qual
    from pg_policies
    where schemaname = 'public'
      and qual in ('has_active_access()', 'has_admin_access()')
  loop
    execute format(
      'alter policy %I on %I.%I using ((select public.%s))',
      p.policyname, p.schemaname, p.tablename, p.qual
    );
  end loop;
end
$$;

create or replace view public.tournament_index
with (security_invoker = true) as
with roster as (
  select tournament_id, count(*) as n
  from public.tournament_players
  group by tournament_id
),
match_agg as (
  select
    tournament_id,
    count(distinct round_number) as round_count,
    count(*) as match_count,
    count(*) filter (where score_team_1 <> 0 or score_team_2 <> 0) as completed_count
  from public.matches
  group by tournament_id
),
player_agg as (
  select m.tournament_id, count(distinct mp.player_id) as player_count
  from public.matches m
  join public.match_players mp on mp.match_id = m.id
  group by m.tournament_id
)
select
  t.id,
  t.tournament_date,
  t.status,
  t.current_round_number,
  coalesce(nullif(roster.n, 0), player_agg.player_count, 0)::integer as player_count,
  coalesce(match_agg.round_count, 0)::integer as round_count,
  coalesce(match_agg.match_count, 0)::integer as match_count,
  coalesce(match_agg.completed_count, 0)::integer as completed_count
from public.tournaments t
left join roster on roster.tournament_id = t.id
left join match_agg on match_agg.tournament_id = t.id
left join player_agg on player_agg.tournament_id = t.id;

commit;
