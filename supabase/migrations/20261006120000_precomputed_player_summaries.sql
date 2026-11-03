-- Precomputed all-time player totals + current ELO for Statistics, ELO charts,
-- Tournament detail and Doodle (loadPlayerSummary), so those routes no longer
-- replay ELO (get_current_elo) or scan all matches (player_totals) per load.
--
-- Idempotent: safe to paste into the Supabase SQL Editor and re-run.
-- Requires 20261006090000_precomputed_home_summaries.sql (player_tournament_elo).

begin;

drop trigger if exists matches_refresh_player_totals on public.matches;
drop trigger if exists match_players_refresh_player_totals on public.match_players;
drop trigger if exists tournaments_refresh_player_totals on public.tournaments;
drop function if exists public.refresh_player_totals_derived();
drop function if exists public.rebuild_player_totals_summary();

create table if not exists public.player_totals_summary (
  player_id uuid primary key,
  wins integer not null default 0,
  losses integer not null default 0,
  points integer not null default 0,
  games integer not null default 0,
  tournaments integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Per-date and per-player lookups on player_tournament_elo
-- (PK is (player_id, tournament_date), so player_id filters are already indexed).
create index if not exists player_tournament_elo_date_idx
  on public.player_tournament_elo (tournament_date);

-- Latest ELO per player (same shape as get_current_elo()).
create or replace view public.player_current_elo
with (security_invoker = true) as
select distinct on (pte.player_id)
  pte.player_id,
  pte.tournament_date,
  pte.elo,
  pte.previous_elo
from public.player_tournament_elo pte
order by pte.player_id, pte.tournament_date desc;

-- Same rules as the player_totals view: 0-0 skipped, a tie counts as a loss.
create or replace function public.rebuild_player_totals_summary()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.player_totals_summary where true;
  insert into public.player_totals_summary (player_id, wins, losses, points, games, tournaments)
  select
    mp.player_id,
    (count(*) filter (where s.own > s.opp))::integer,
    (count(*) filter (where s.own <= s.opp))::integer,
    coalesce(sum(s.own), 0)::integer,
    count(*)::integer,
    count(distinct t.tournament_date)::integer
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
end;
$$;

create or replace function public.refresh_player_totals_derived()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rebuild_player_totals_summary();
  return null;
end;
$$;

create trigger matches_refresh_player_totals
after insert or update or delete on public.matches
for each statement execute function public.refresh_player_totals_derived();

create trigger match_players_refresh_player_totals
after insert or update or delete on public.match_players
for each statement execute function public.refresh_player_totals_derived();

create trigger tournaments_refresh_player_totals
after insert or update or delete on public.tournaments
for each statement execute function public.refresh_player_totals_derived();

alter table public.player_totals_summary enable row level security;
drop policy if exists player_totals_summary_read on public.player_totals_summary;
create policy player_totals_summary_read on public.player_totals_summary
  for select using (public.has_active_access());

revoke all on public.player_totals_summary, public.player_current_elo from public, anon, authenticated;
grant select on public.player_totals_summary, public.player_current_elo to authenticated, service_role;

revoke all on function public.rebuild_player_totals_summary() from public, anon, authenticated;
revoke all on function public.refresh_player_totals_derived() from public, anon, authenticated;
grant execute on function public.rebuild_player_totals_summary() to service_role;

-- Initial backfill.
select public.rebuild_player_totals_summary();

commit;
