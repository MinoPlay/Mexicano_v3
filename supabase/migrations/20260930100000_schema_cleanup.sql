-- Schema cleanup: remove import provenance, duplicated flags, unused
-- bookkeeping tables and ELO versioning. The app, edge functions and scripts
-- are updated in the same change; see .github/features/supabase-migration.md.
--
-- Removed:
--   tables   app_settings, player_aliases, backup_runs, projection_runs,
--            elo_calculation_versions
--   columns  *.source_path, players/tournaments.legacy_id, matches.legacy_key,
--            tournaments/matches.version, tournaments.is_complete (status is
--            the single completion flag), matches.completed_at (never set),
--            attendance_records.kind/tournament_id (manual-only table),
--            attendance_players.confirmed (always true),
--            elo_snapshots.calculation_version/source_match_count

begin;

-- Player lookup no longer consults the alias table (import script resolves
-- aliases client-side before calling the RPC).
create or replace function public.resolve_legacy_player_id(p_name text)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  resolved_id uuid;
begin
  select id into resolved_id
  from public.players
  where lower(name) = lower(trim(p_name));

  if resolved_id is null then
    raise exception 'Unmapped legacy player: %', p_name;
  end if;
  return resolved_id;
end;
$$;

-- ELO snapshots: single calculation, keyed by tournament + player.
alter table public.elo_snapshots drop constraint if exists elo_snapshots_pkey;
alter table public.elo_snapshots drop column if exists calculation_version;
alter table public.elo_snapshots drop column if exists source_match_count;
alter table public.elo_snapshots add primary key (tournament_id, player_id);

drop function if exists public.replace_elo_projection(jsonb);
create function public.replace_elo_projection(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  inserted_count integer := 0;
begin
  delete from public.elo_snapshots where true;

  for item in select value from jsonb_array_elements(coalesce(payload->'snapshots', '[]'::jsonb))
  loop
    insert into public.elo_snapshots (tournament_id, player_id, elo, previous_elo)
    values (
      (select id from public.tournaments where tournament_date = (item->>'tournament_date')::date),
      public.resolve_legacy_player_id(item->>'player_name'),
      (item->>'elo')::numeric,
      (item->>'previous_elo')::numeric
    );
    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('snapshot_count', inserted_count);
end;
$$;

revoke all on function public.replace_elo_projection(jsonb) from public, anon, authenticated;
grant execute on function public.replace_elo_projection(jsonb) to service_role;

-- Attendance records are manual-only; tournament attendance is derived from
-- tournament_players.
delete from public.attendance_records where kind <> 'manual';
alter table public.attendance_records drop column if exists kind;
alter table public.attendance_records drop column if exists tournament_id;
alter table public.attendance_records add constraint attendance_records_attendance_date_key unique (attendance_date);
alter table public.attendance_players drop column if exists confirmed;

-- Redundant / never-read columns.
alter table public.players drop column if exists legacy_id;
alter table public.tournaments drop column if exists legacy_id;
alter table public.tournaments drop column if exists is_complete;
alter table public.tournaments drop column if exists version;
alter table public.matches drop column if exists legacy_key;
alter table public.matches drop column if exists version;
alter table public.matches drop column if exists completed_at;

alter table public.players drop column if exists source_path;
alter table public.tournaments drop column if exists source_path;
alter table public.tournament_players drop column if exists source_path;
alter table public.matches drop column if exists source_path;
alter table public.match_players drop column if exists source_path;
alter table public.doodle_availability drop column if exists source_path;
alter table public.doodle_changelog drop column if exists source_path;
alter table public.attendance_records drop column if exists source_path;
alter table public.attendance_players drop column if exists source_path;

-- Unused tables.
drop table if exists public.projection_runs;
drop table if exists public.elo_calculation_versions;
drop table if exists public.backup_runs;
drop table if exists public.app_settings;
drop table if exists public.player_aliases;

-- Save/import path keyed by natural keys:
--   tournaments        tournament_date
--   matches            (tournament_id, round_number, match_order)
--   attendance_records attendance_date
-- Extra payload fields (e.g. source_path from the DataHub importer) are ignored.
create or replace function public.import_legacy_dataset(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  tournament_id_value uuid;
  match_id_value uuid;
  attendance_id_value uuid;
begin
  for item in select value from jsonb_array_elements(coalesce(payload->'players', '[]'::jsonb))
  loop
    insert into public.players (name, email, match_padel_id)
    values (
      trim(item->>'name'),
      nullif(item->>'email', ''),
      nullif(item->>'match_padel_id', '')::bigint
    )
    on conflict ((lower(name))) do update
      set email = coalesce(excluded.email, public.players.email),
          match_padel_id = coalesce(excluded.match_padel_id, public.players.match_padel_id);
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'tournaments', '[]'::jsonb))
  loop
    insert into public.tournaments (
      tournament_date, status, current_round_number,
      completed_at, access_code, courts
    ) values (
      (item->>'tournament_date')::date,
      case
        when item->>'status' in ('planned', 'active', 'completed', 'cancelled') then item->>'status'
        else 'planned'
      end,
      nullif(item->>'current_round_number', '')::integer,
      nullif(item->>'completed_at', '')::timestamptz,
      nullif(item->>'access_code', ''),
      case
        when jsonb_typeof(item->'courts') = 'array' then item->'courts'
        else null
      end
    )
    on conflict (tournament_date) do update
      set status = excluded.status,
          current_round_number = coalesce(excluded.current_round_number, public.tournaments.current_round_number),
          completed_at = coalesce(excluded.completed_at, public.tournaments.completed_at),
          -- access_code is nullable-by-intent: an explicit clear must win, so it
          -- is only preserved when the payload omits the field entirely.
          access_code = case
            when jsonb_exists(item, 'access_code') then excluded.access_code
            else public.tournaments.access_code
          end,
          courts = coalesce(excluded.courts, public.tournaments.courts);
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'tournament_players', '[]'::jsonb))
  loop
    select id into tournament_id_value
    from public.tournaments
    where tournament_date = (item->>'tournament_date')::date;

    insert into public.tournament_players (
      tournament_id, player_id, seed_position, confirmed
    ) values (
      tournament_id_value,
      public.resolve_legacy_player_id(item->>'player_name'),
      nullif(item->>'seed_position', '')::integer,
      coalesce((item->>'confirmed')::boolean, false)
    )
    on conflict (tournament_id, player_id) do update
      set seed_position = excluded.seed_position,
          confirmed = excluded.confirmed;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'matches', '[]'::jsonb))
  loop
    select id into tournament_id_value
    from public.tournaments
    where tournament_date = (item->>'match_date')::date;

    insert into public.matches (
      tournament_id, round_number, match_order, score_team_1, score_team_2
    ) values (
      tournament_id_value,
      (item->>'round_number')::integer,
      (item->>'match_order')::integer,
      (item->>'score_team_1')::integer,
      (item->>'score_team_2')::integer
    )
    on conflict (tournament_id, round_number, match_order) do update
      set score_team_1 = excluded.score_team_1,
          score_team_2 = excluded.score_team_2;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'match_players', '[]'::jsonb))
  loop
    select m.id into match_id_value
    from public.matches m
    join public.tournaments t on t.id = m.tournament_id
    where t.tournament_date = (item->>'match_date')::date
      and m.round_number = (item->>'round_number')::integer
      and m.match_order = (item->>'match_order')::integer;

    insert into public.match_players (match_id, player_id, team, position)
    values (
      match_id_value,
      public.resolve_legacy_player_id(item->>'player_name'),
      (item->>'team')::smallint,
      (item->>'position')::smallint
    )
    on conflict (match_id, team, position) do update
      set player_id = excluded.player_id;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'doodle_availability', '[]'::jsonb))
  loop
    insert into public.doodle_availability (availability_date, player_id)
    values (
      (item->>'availability_date')::date,
      public.resolve_legacy_player_id(item->>'player_name')
    )
    on conflict (availability_date, player_id) do nothing;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'attendance_records', '[]'::jsonb))
  loop
    insert into public.attendance_records (attendance_date, note)
    values ((item->>'attendance_date')::date, item->>'note')
    on conflict (attendance_date) do update
      set note = excluded.note;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'attendance_players', '[]'::jsonb))
  loop
    select id into attendance_id_value
    from public.attendance_records
    where attendance_date = (item->>'attendance_date')::date;

    insert into public.attendance_players (attendance_id, player_id)
    values (
      attendance_id_value,
      public.resolve_legacy_player_id(item->>'player_name')
    )
    on conflict (attendance_id, player_id) do nothing;
  end loop;

  return jsonb_build_object(
    'player_count', (select count(*) from public.players),
    'tournament_count', (select count(*) from public.tournaments),
    'match_count', (select count(*) from public.matches),
    'match_player_count', (select count(*) from public.match_players),
    'doodle_availability_count', (select count(*) from public.doodle_availability),
    'attendance_record_count', (select count(*) from public.attendance_records),
    'attendance_player_count', (select count(*) from public.attendance_players),
    'dry_run', false
  );
end;
$$;

revoke all on function public.import_legacy_dataset(jsonb) from public, anon, authenticated;
grant execute on function public.import_legacy_dataset(jsonb) to service_role;

commit;
