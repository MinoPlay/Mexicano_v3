-- Remove all matches from the listed past tournaments.
--
-- Run supabase/scripts/inspect-corrupt-tournaments.sql first and review its
-- output. Then put the dates to clean in target_dates below and run this in
-- the Supabase SQL Editor. With an empty list nothing changes.
--
-- For each date: deletes its matches (match_players are removed by cascade),
-- keeps the tournament and its roster, and resets round progress
-- (status 'planned', current_round_number and completed_at cleared).
-- Home/statistics summary tables rebuild automatically via triggers.
--
-- Runs as one block: an unknown, today or future date aborts without changes.
do $$
declare
  target_dates constant date[] := array[]::date[];  -- e.g. array['2026-09-22']::date[]
  target_date date;
  target_id uuid;
  removed_matches integer;
  removed_slots integer;
begin
  if cardinality(target_dates) = 0 then
    raise notice 'No target_dates listed. Nothing changed.';
    return;
  end if;

  foreach target_date in array target_dates
  loop
    if target_date >= current_date then
      raise exception 'Refusing % : only past tournaments can be cleaned', target_date;
    end if;

    select id into target_id
    from public.tournaments
    where tournament_date = target_date;
    if target_id is null then
      raise exception 'No tournament on %', target_date;
    end if;

    select count(*) into removed_slots
    from public.match_players mp
    join public.matches m on m.id = mp.match_id
    where m.tournament_id = target_id;

    delete from public.matches where tournament_id = target_id;
    get diagnostics removed_matches = row_count;

    update public.tournaments
    set status = 'planned',
        current_round_number = null,
        completed_at = null
    where id = target_id;

    raise notice '%: removed % matches, % match players', target_date, removed_matches, removed_slots;
  end loop;
end;
$$;
