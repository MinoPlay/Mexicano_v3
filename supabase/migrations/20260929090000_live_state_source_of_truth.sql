-- Makes Supabase the only source of truth for app state that used to survive
-- only in browser localStorage:
--   * tournaments.access_code / tournaments.courts — previously held solely in
--     the local `mexicano_active_tournament` object, so they were lost on any
--     refresh or when opening the tournament on a second device.
--   * doodle_changelog — previously appended to a per-device localStorage list
--     (and only mirrored into admin-only audit_events), so every device showed
--     a different "Recent Changes" list.

alter table public.tournaments
  add column if not exists access_code text,
  add column if not exists courts jsonb;

create table if not exists public.doodle_changelog (
  id uuid primary key default gen_random_uuid(),
  year_month text not null check (year_month ~ '^[0-9]{4}-[0-9]{2}$'),
  player_id uuid not null references public.players(id) on delete cascade,
  selected_added date[] not null default '{}',
  selected_removed date[] not null default '{}',
  source_path text,
  created_at timestamptz not null default now()
);

create index if not exists doodle_changelog_month_idx
  on public.doodle_changelog (year_month, created_at desc);

alter table public.doodle_changelog enable row level security;

-- Readable by every member: the Doodle page shows Recent Changes to all users,
-- unlike audit_events which is intentionally admin-only.
drop policy if exists doodle_changelog_read on public.doodle_changelog;
create policy doodle_changelog_read on public.doodle_changelog
  for select using (public.has_active_access());

-- Rewritten to carry access_code + courts through the idempotent import path.
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
    insert into public.players (legacy_id, name, email, match_padel_id)
    values (
      nullif(item->>'legacy_id', ''),
      trim(item->>'name'),
      nullif(item->>'email', ''),
      nullif(item->>'match_padel_id', '')::bigint
    )
    on conflict ((lower(name))) do update
      set legacy_id = coalesce(excluded.legacy_id, public.players.legacy_id),
          email = coalesce(excluded.email, public.players.email),
          match_padel_id = coalesce(excluded.match_padel_id, public.players.match_padel_id);
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'player_aliases', '[]'::jsonb))
  loop
    insert into public.player_aliases (alias, player_id)
    values (
      item->>'alias',
      public.resolve_legacy_player_id(item->>'player_name')
    )
    on conflict (alias) do update
      set player_id = excluded.player_id;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'tournaments', '[]'::jsonb))
  loop
    insert into public.tournaments (
      legacy_id, tournament_date, status, current_round_number,
      is_complete, completed_at, access_code, courts, source_path
    ) values (
      nullif(item->>'legacy_id', ''),
      (item->>'tournament_date')::date,
      case
        when coalesce((item->>'is_complete')::boolean, false) then 'completed'
        when item->>'status' in ('planned', 'active', 'completed', 'cancelled') then item->>'status'
        else 'planned'
      end,
      nullif(item->>'current_round_number', '')::integer,
      coalesce((item->>'is_complete')::boolean, false),
      nullif(item->>'completed_at', '')::timestamptz,
      nullif(item->>'access_code', ''),
      case
        when jsonb_typeof(item->'courts') = 'array' then item->'courts'
        else null
      end,
      item->>'source_path'
    )
    on conflict (tournament_date) do update
      set legacy_id = coalesce(excluded.legacy_id, public.tournaments.legacy_id),
          status = excluded.status,
          current_round_number = coalesce(excluded.current_round_number, public.tournaments.current_round_number),
          is_complete = excluded.is_complete,
          completed_at = coalesce(excluded.completed_at, public.tournaments.completed_at),
          -- access_code is nullable-by-intent: an explicit clear must win, so it
          -- is only preserved when the payload omits the field entirely.
          access_code = case
            when jsonb_exists(item, 'access_code') then excluded.access_code
            else public.tournaments.access_code
          end,
          courts = coalesce(excluded.courts, public.tournaments.courts),
          source_path = coalesce(excluded.source_path, public.tournaments.source_path);
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'tournament_players', '[]'::jsonb))
  loop
    select id into tournament_id_value
    from public.tournaments
    where tournament_date = (item->>'tournament_date')::date;

    insert into public.tournament_players (
      tournament_id, player_id, seed_position, confirmed, source_path
    ) values (
      tournament_id_value,
      public.resolve_legacy_player_id(item->>'player_name'),
      nullif(item->>'seed_position', '')::integer,
      coalesce((item->>'confirmed')::boolean, false),
      item->>'source_path'
    )
    on conflict (tournament_id, player_id) do update
      set seed_position = excluded.seed_position,
          confirmed = excluded.confirmed,
          source_path = excluded.source_path;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'matches', '[]'::jsonb))
  loop
    select id into tournament_id_value
    from public.tournaments
    where tournament_date = (item->>'match_date')::date;

    insert into public.matches (
      legacy_key, tournament_id, round_number, match_order,
      score_team_1, score_team_2, source_path
    ) values (
      item->>'match_key',
      tournament_id_value,
      (item->>'round_number')::integer,
      (item->>'match_order')::integer,
      (item->>'score_team_1')::integer,
      (item->>'score_team_2')::integer,
      item->>'source_path'
    )
    on conflict (legacy_key) do update
      set score_team_1 = excluded.score_team_1,
          score_team_2 = excluded.score_team_2,
          source_path = excluded.source_path;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'match_players', '[]'::jsonb))
  loop
    select id into match_id_value
    from public.matches
    where legacy_key = item->>'match_key';

    insert into public.match_players (
      match_id, player_id, team, position, source_path
    ) values (
      match_id_value,
      public.resolve_legacy_player_id(item->>'player_name'),
      (item->>'team')::smallint,
      (item->>'position')::smallint,
      item->>'source_path'
    )
    on conflict (match_id, team, position) do update
      set player_id = excluded.player_id,
          source_path = excluded.source_path;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'doodle_availability', '[]'::jsonb))
  loop
    insert into public.doodle_availability (
      availability_date, player_id, source_path
    ) values (
      (item->>'availability_date')::date,
      public.resolve_legacy_player_id(item->>'player_name'),
      item->>'source_path'
    )
    on conflict (availability_date, player_id) do update
      set source_path = excluded.source_path;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'attendance_records', '[]'::jsonb))
  loop
    insert into public.attendance_records (
      attendance_date, kind, note, source_path
    ) values (
      (item->>'attendance_date')::date,
      item->>'kind',
      item->>'note',
      item->>'source_path'
    )
    on conflict (attendance_date, kind) do update
      set note = excluded.note,
          source_path = excluded.source_path;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(payload->'attendance_players', '[]'::jsonb))
  loop
    select id into attendance_id_value
    from public.attendance_records
    where attendance_date = (item->>'attendance_date')::date
      and kind = 'manual';

    insert into public.attendance_players (
      attendance_id, player_id, source_path
    ) values (
      attendance_id_value,
      public.resolve_legacy_player_id(item->>'player_name'),
      item->>'source_path'
    )
    on conflict (attendance_id, player_id) do update
      set source_path = excluded.source_path;
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
