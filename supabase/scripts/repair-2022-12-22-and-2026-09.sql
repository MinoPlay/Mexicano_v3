-- One-off repair for three tournaments. Run in the Supabase SQL Editor.
--
-- 2022-12-22  Replace all matches with the 16 matches from DataHub backup
--             backup-data/2022/2022-12/2022-12-22.json. The backup lists Mino
--             twice in round 2 and Kikke not at all; round 2 match 1 is
--             Kikke & Mattijs vs Peter & Ulrik, the only lineup that follows
--             the Mexicano standings (after round 1 the bottom four are Kikke,
--             Peter, Mattijs, Ulrik) and gives every player 8 matches.
--             Player names are matched case-insensitively, like the app does.
--             An unknown name aborts the script and is listed in the error.
-- 2026-09-22  Keep round 1 with its scores cleared (0-0); remove later rounds.
-- 2026-09-15  Keep its matches but clear their scores (0-0).
--
-- Runs as one block: a missing tournament or unknown player name aborts
-- without changes. Home/statistics summaries rebuild via existing triggers.
do $$
declare
  restore_id uuid;
  remove_id uuid;
  unscore_id uuid;
  missing text;
  slot_count integer;
begin
  select id into restore_id from public.tournaments where tournament_date = '2022-12-22';
  select id into remove_id from public.tournaments where tournament_date = '2026-09-22';
  select id into unscore_id from public.tournaments where tournament_date = '2026-09-15';
  if restore_id is null or remove_id is null or unscore_id is null then
    raise exception 'Missing tournament: 2022-12-22=%, 2026-09-22=%, 2026-09-15=%',
      restore_id, remove_id, unscore_id;
  end if;

  create temp table restore_matches (
    round_number integer, match_order integer, score_team_1 integer, score_team_2 integer,
    t1p1 text, t1p2 text, t2p1 text, t2p2 text
  ) on commit drop;
  insert into restore_matches values
    (1, 1, 8, 17, 'Mattijs', 'Ulrik', 'Jan Sørensen', 'Peter Soderlund'),
    (1, 2, 13, 12, 'Mino', 'Jeremy', 'Kikke', 'Peter'),
    (2, 1, 12, 13, 'Kikke', 'Mattijs', 'Peter', 'Ulrik'),
    (2, 2, 6, 19, 'Jan Sørensen', 'Mino', 'Peter Soderlund', 'Jeremy'),
    (3, 1, 13, 12, 'Peter Soderlund', 'Peter', 'Jeremy', 'Kikke'),
    (3, 2, 16, 9, 'Jan Sørensen', 'Mattijs', 'Ulrik', 'Mino'),
    (4, 1, 12, 13, 'Peter Soderlund', 'Jan Sørensen', 'Jeremy', 'Peter'),
    (4, 2, 13, 12, 'Kikke', 'Ulrik', 'Mattijs', 'Mino'),
    (5, 1, 11, 14, 'Kikke', 'Ulrik', 'Mattijs', 'Mino'),
    (5, 2, 11, 14, 'Peter Soderlund', 'Peter', 'Jeremy', 'Jan Sørensen'),
    (6, 1, 20, 5, 'Peter Soderlund', 'Jan Sørensen', 'Jeremy', 'Peter'),
    (6, 2, 10, 15, 'Mattijs', 'Mino', 'Kikke', 'Ulrik'),
    (7, 1, 22, 3, 'Peter Soderlund', 'Jeremy', 'Jan Sørensen', 'Kikke'),
    (7, 2, 13, 12, 'Mattijs', 'Peter', 'Ulrik', 'Mino'),
    (8, 1, 12, 13, 'Ulrik', 'Kikke', 'Peter', 'Mino'),
    (8, 2, 13, 12, 'Peter Soderlund', 'Jan Sørensen', 'Jeremy', 'Mattijs');

  create temp table restore_slots on commit drop as
  select r.round_number, r.match_order, s.team, s.position, s.player_name, p.id as player_id
  from restore_matches r
  cross join lateral (values (1, 1, r.t1p1), (1, 2, r.t1p2), (2, 1, r.t2p1), (2, 2, r.t2p2))
    as s(team, position, player_name)
  left join public.players p
    on lower(p.name) = lower(trim(s.player_name));

  select string_agg(distinct player_name, ', ') into missing
  from restore_slots where player_id is null;
  if missing is not null then
    raise exception 'Unknown players for 2022-12-22: %', missing;
  end if;

  delete from public.matches where tournament_id = restore_id;
  insert into public.matches (tournament_id, round_number, match_order, score_team_1, score_team_2)
  select restore_id, round_number, match_order, score_team_1, score_team_2 from restore_matches;
  insert into public.match_players (match_id, player_id, team, position)
  select m.id, s.player_id, s.team, s.position
  from restore_slots s
  join public.matches m
    on m.tournament_id = restore_id
   and m.round_number = s.round_number
   and m.match_order = s.match_order;
  get diagnostics slot_count = row_count;
  if slot_count <> 64 then
    raise exception 'Expected 64 match players for 2022-12-22, inserted %', slot_count;
  end if;
  update public.tournaments set status = 'completed', current_round_number = 8 where id = restore_id;

  delete from public.matches where tournament_id = remove_id and round_number > 1;
  update public.matches set score_team_1 = 0, score_team_2 = 0 where tournament_id = remove_id;
  update public.tournaments
  set status = 'planned', current_round_number = 1, completed_at = null
  where id = remove_id;

  update public.matches set score_team_1 = 0, score_team_2 = 0 where tournament_id = unscore_id;
  update public.tournaments set status = 'planned', completed_at = null where id = unscore_id;

  raise notice 'Repaired 2022-12-22 (16 matches), 2026-09-22 (round 1 unscored), 2026-09-15 (unscored).';
end;
$$;

-- Verification: every match of the three repaired tournaments.
select t.tournament_date, t.status, m.round_number, m.match_order,
  m.score_team_1, m.score_team_2,
  string_agg(p.name, ' & ' order by mp.position) filter (where mp.team = 1) as team_1,
  string_agg(p.name, ' & ' order by mp.position) filter (where mp.team = 2) as team_2
from public.tournaments t
left join public.matches m on m.tournament_id = t.id
left join public.match_players mp on mp.match_id = m.id
left join public.players p on p.id = mp.player_id
where t.tournament_date in ('2022-12-22', '2026-09-15', '2026-09-22')
group by t.tournament_date, t.status, m.round_number, m.match_order, m.score_team_1, m.score_team_2
order by t.tournament_date, m.round_number, m.match_order;
