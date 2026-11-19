-- Report past tournaments with inconsistent match data. READ-ONLY: changes nothing.
--
-- Run in the Supabase SQL Editor. One row per issue found. Review the output,
-- then list the dates to clean in supabase/scripts/fix-corrupt-tournaments.sql.
--
-- Only tournaments dated before today are checked, so new or active
-- tournaments with not-yet-scored matches are not reported.
-- A match counts as unscored when its score is 0-0 (same rule as ELO/stats).
--
-- Issues:
--   round_gap                  unscored round before a scored round
--   trailing_unscored_round    unscored round after the last scored round
--   partial_round              round with both scored and unscored matches
--   bad_player_count           match without exactly 4 players
--   duplicate_player_in_round  player in more than one match of a round
--   player_not_in_roster       match player missing from tournament_players
--                              (only checked when the tournament has a roster)
--   status_mismatch            completed with unscored matches, or planned with scored matches
with past as (
  select id, tournament_date, status
  from public.tournaments
  where tournament_date < current_date
),
match_state as (
  select m.id, m.tournament_id, m.round_number, m.match_order,
    (m.score_team_1 <> 0 or m.score_team_2 <> 0) as scored
  from public.matches m
  join past p on p.id = m.tournament_id
),
round_state as (
  select tournament_id, round_number,
    count(*) filter (where scored) as scored_count,
    count(*) filter (where not scored) as unscored_count
  from match_state
  group by tournament_id, round_number
),
tournament_state as (
  select tournament_id,
    count(*) as match_count,
    count(*) filter (where scored) as scored_count,
    max(round_number) filter (where scored) as last_scored_round
  from match_state
  group by tournament_id
),
issues as (
  select r.tournament_id, 'round_gap' as issue,
    format('round %s unscored', r.round_number) as detail
  from round_state r
  join tournament_state t on t.tournament_id = r.tournament_id
  where r.scored_count = 0 and r.round_number < t.last_scored_round

  union all
  select r.tournament_id, 'trailing_unscored_round',
    format('round %s unscored', r.round_number)
  from round_state r
  join tournament_state t on t.tournament_id = r.tournament_id
  where r.scored_count = 0 and r.round_number > t.last_scored_round

  union all
  select tournament_id, 'partial_round',
    format('round %s: %s scored, %s unscored', round_number, scored_count, unscored_count)
  from round_state
  where scored_count > 0 and unscored_count > 0

  union all
  select m.tournament_id, 'bad_player_count',
    format('round %s match %s has %s players', m.round_number, m.match_order, count(mp.player_id))
  from match_state m
  left join public.match_players mp on mp.match_id = m.id
  group by m.tournament_id, m.id, m.round_number, m.match_order
  having count(mp.player_id) <> 4

  union all
  select m.tournament_id, 'duplicate_player_in_round',
    format('round %s: %s in %s matches', m.round_number, pl.name, count(*))
  from match_state m
  join public.match_players mp on mp.match_id = m.id
  join public.players pl on pl.id = mp.player_id
  group by m.tournament_id, m.round_number, pl.name
  having count(*) > 1

  union all
  select m.tournament_id, 'player_not_in_roster',
    format('round %s match %s: %s', m.round_number, m.match_order, pl.name)
  from match_state m
  join public.match_players mp on mp.match_id = m.id
  join public.players pl on pl.id = mp.player_id
  where exists (select 1 from public.tournament_players tp where tp.tournament_id = m.tournament_id)
    and not exists (
      select 1 from public.tournament_players tp
      where tp.tournament_id = m.tournament_id and tp.player_id = mp.player_id
    )

  union all
  select p.id, 'status_mismatch',
    format('status %s with %s of %s matches scored', p.status, t.scored_count, t.match_count)
  from past p
  join tournament_state t on t.tournament_id = p.id
  where (p.status = 'completed' and t.scored_count < t.match_count)
     or (p.status = 'planned' and t.scored_count > 0)
)
select
  p.tournament_date,
  p.status,
  coalesce(t.match_count, 0) as match_count,
  coalesce(t.scored_count, 0) as scored_count,
  i.issue,
  i.detail
from issues i
join past p on p.id = i.tournament_id
left join tournament_state t on t.tournament_id = i.tournament_id
order by p.tournament_date, i.issue, i.detail;
