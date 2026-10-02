create extension if not exists pgcrypto;

create table public.players (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,
  name text not null,
  email text,
  match_padel_id bigint,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index players_name_unique on public.players (lower(name));
create unique index players_legacy_id_unique on public.players (legacy_id) where legacy_id is not null;

create table public.player_aliases (
  alias text primary key,
  player_id uuid not null references public.players(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.player_roles (
  player_id uuid not null references public.players(id) on delete cascade,
  role text not null check (role in ('admin')),
  created_at timestamptz not null default now(),
  primary key (player_id, role)
);

create table public.app_access_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  selected_player_id uuid references public.players(id) on delete set null,
  role text not null default 'member' check (role in ('member', 'admin')),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz not null default now()
);

create table public.access_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('member', 'admin')),
  succeeded boolean not null,
  attempted_at timestamptz not null default now()
);
create index access_attempts_rate_limit_idx on public.access_attempts (user_id, kind, attempted_at desc);

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  legacy_id text,
  tournament_date date not null unique,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'cancelled')),
  current_round_number integer,
  is_complete boolean not null default false,
  completed_at timestamptz,
  version bigint not null default 1,
  source_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index tournaments_legacy_id_unique on public.tournaments (legacy_id) where legacy_id is not null;

create table public.tournament_players (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  seed_position integer,
  confirmed boolean not null default false,
  source_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tournament_id, player_id)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  legacy_key text not null unique,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  match_order integer not null check (match_order > 0),
  score_team_1 integer not null check (score_team_1 >= 0),
  score_team_2 integer not null check (score_team_2 >= 0),
  completed_at timestamptz,
  version bigint not null default 1,
  source_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, round_number, match_order)
);
create index matches_tournament_round_idx on public.matches (tournament_id, round_number, match_order);

create table public.match_players (
  match_id uuid not null references public.matches(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  team smallint not null check (team in (1, 2)),
  position smallint not null check (position in (1, 2)),
  source_path text,
  created_at timestamptz not null default now(),
  primary key (match_id, team, position),
  unique (match_id, player_id)
);

create table public.doodle_availability (
  availability_date date not null,
  player_id uuid not null references public.players(id) on delete cascade,
  source_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (availability_date, player_id)
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  attendance_date date not null,
  kind text not null check (kind in ('manual', 'tournament')),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  note text,
  source_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attendance_date, kind)
);

create table public.attendance_players (
  attendance_id uuid not null references public.attendance_records(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  confirmed boolean not null default true,
  source_path text,
  created_at timestamptz not null default now(),
  primary key (attendance_id, player_id)
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.players(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  player_id uuid references public.players(id) on delete set null,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  active boolean not null default true,
  last_failure text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_player_id uuid references public.players(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  correlation_id uuid not null default gen_random_uuid(),
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_created_idx on public.audit_events (created_at desc);
create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  channel text not null check (channel in ('telegram', 'push')),
  event_type text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'delivered', 'failed')),
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  correlation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notification_outbox_ready_idx
  on public.notification_outbox (status, available_at)
  where status in ('pending', 'failed');

create table public.elo_calculation_versions (
  id text primary key,
  initial_elo numeric(10, 2) not null,
  k_factor numeric(10, 2) not null,
  opponent_method text not null,
  update_order text not null,
  rounding_digits integer not null,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index elo_one_active_version on public.elo_calculation_versions (active) where active;

create table public.elo_snapshots (
  calculation_version text not null references public.elo_calculation_versions(id) on delete restrict,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  elo numeric(10, 2) not null,
  previous_elo numeric(10, 2) not null,
  source_match_count integer not null,
  created_at timestamptz not null default now(),
  primary key (calculation_version, tournament_id, player_id)
);
create index elo_snapshots_player_idx on public.elo_snapshots (player_id, tournament_id);

create table public.projection_runs (
  id uuid primary key default gen_random_uuid(),
  projection_name text not null,
  calculation_version text references public.elo_calculation_versions(id) on delete restrict,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  source_watermark text,
  record_count integer not null default 0,
  checksum text,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running', 'succeeded', 'failed')),
  source_watermark text,
  record_counts jsonb not null default '{}'::jsonb,
  manifest_sha256 text,
  github_commit_sha text,
  restore_verified boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

insert into public.elo_calculation_versions (
  id, initial_elo, k_factor, opponent_method, update_order, rounding_digits, active
) values (
  'mexicano-v1', 1000, 32, 'rms', 'team1-then-team2-sequential', 2, true
) on conflict (id) do nothing;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'players', 'tournaments', 'tournament_players', 'matches',
    'doodle_availability', 'attendance_records', 'push_subscriptions',
    'notification_outbox'
  ]
  loop
    execute format(
      'create trigger %I_touch_updated_at before update on public.%I
       for each row execute function public.touch_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

create or replace function public.has_active_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_access_grants
    where user_id = auth.uid()
      and revoked_at is null
      and expires_at > now()
  );
$$;

create or replace function public.has_admin_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_access_grants
    where user_id = auth.uid()
      and role = 'admin'
      and revoked_at is null
      and expires_at > now()
  );
$$;

create or replace function public.bind_current_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_active_access() then
    raise exception 'Active app access is required';
  end if;
  if not exists (select 1 from public.players where id = p_player_id and active) then
    raise exception 'Player does not exist or is inactive';
  end if;
  update public.app_access_grants
  set selected_player_id = p_player_id, last_used_at = now()
  where user_id = auth.uid();
end;
$$;

create or replace function public.grant_app_access(
  p_user_id uuid,
  p_expires_at timestamptz,
  p_role text default 'member'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_role not in ('member', 'admin') then
    raise exception 'Invalid access role';
  end if;
  insert into public.app_access_grants (user_id, role, expires_at, revoked_at, last_used_at)
  values (p_user_id, p_role, p_expires_at, null, now())
  on conflict (user_id) do update
    set role = excluded.role,
        expires_at = excluded.expires_at,
        revoked_at = null,
        last_used_at = now();
end;
$$;

create or replace function public.enqueue_notification(
  p_idempotency_key text,
  p_channel text,
  p_event_type text,
  p_payload jsonb,
  p_correlation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  outbox_id uuid;
begin
  insert into public.notification_outbox (
    idempotency_key, channel, event_type, payload, correlation_id
  ) values (
    p_idempotency_key, p_channel, p_event_type, p_payload, p_correlation_id
  )
  on conflict (idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning id into outbox_id;
  return outbox_id;
end;
$$;

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
    select player_id into resolved_id
    from public.player_aliases
    where lower(alias) = lower(trim(p_name));
  end if;

  if resolved_id is null then
    raise exception 'Unmapped legacy player: %', p_name;
  end if;
  return resolved_id;
end;
$$;

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
      is_complete, completed_at, source_path
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
      item->>'source_path'
    )
    on conflict (tournament_date) do update
      set legacy_id = coalesce(excluded.legacy_id, public.tournaments.legacy_id),
          status = excluded.status,
          current_round_number = coalesce(excluded.current_round_number, public.tournaments.current_round_number),
          is_complete = excluded.is_complete,
          completed_at = coalesce(excluded.completed_at, public.tournaments.completed_at),
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

create or replace function public.replace_elo_projection(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  run_id uuid;
  version_id text := payload->>'calculation_version';
  inserted_count integer := 0;
begin
  if not exists (select 1 from public.elo_calculation_versions where id = version_id) then
    raise exception 'Unknown ELO calculation version: %', version_id;
  end if;

  insert into public.projection_runs (
    projection_name, calculation_version, status, source_watermark
  ) values (
    'elo', version_id, 'running', payload->>'source_match_count'
  ) returning id into run_id;

  delete from public.elo_snapshots where calculation_version = version_id;

  for item in select value from jsonb_array_elements(coalesce(payload->'snapshots', '[]'::jsonb))
  loop
    insert into public.elo_snapshots (
      calculation_version, tournament_id, player_id,
      elo, previous_elo, source_match_count
    ) values (
      version_id,
      (select id from public.tournaments where tournament_date = (item->>'tournament_date')::date),
      public.resolve_legacy_player_id(item->>'player_name'),
      (item->>'elo')::numeric,
      (item->>'previous_elo')::numeric,
      (item->>'source_match_count')::integer
    );
    inserted_count := inserted_count + 1;
  end loop;

  update public.projection_runs
  set status = 'succeeded',
      record_count = inserted_count,
      completed_at = now()
  where id = run_id;

  return jsonb_build_object(
    'calculation_version', version_id,
    'snapshot_count', inserted_count
  );
exception when others then
  if run_id is not null then
    update public.projection_runs
    set status = 'failed', error = sqlerrm, completed_at = now()
    where id = run_id;
  end if;
  raise;
end;
$$;

revoke all on function public.grant_app_access(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.grant_app_access(uuid, timestamptz, text) to service_role;
revoke all on function public.import_legacy_dataset(jsonb) from public, anon, authenticated;
grant execute on function public.import_legacy_dataset(jsonb) to service_role;
revoke all on function public.replace_elo_projection(jsonb) from public, anon, authenticated;
grant execute on function public.replace_elo_projection(jsonb) to service_role;
revoke all on function public.enqueue_notification(text, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_notification(text, text, text, jsonb, uuid) to service_role;
grant execute on function public.bind_current_player(uuid) to authenticated;

alter table public.players enable row level security;
alter table public.player_aliases enable row level security;
alter table public.player_roles enable row level security;
alter table public.app_access_grants enable row level security;
alter table public.access_attempts enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_players enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.doodle_availability enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_players enable row level security;
alter table public.app_settings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.audit_events enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.elo_calculation_versions enable row level security;
alter table public.elo_snapshots enable row level security;
alter table public.projection_runs enable row level security;
alter table public.backup_runs enable row level security;

create policy players_read on public.players for select using (public.has_active_access());
create policy aliases_read on public.player_aliases for select using (public.has_active_access());
create policy roles_read_admin on public.player_roles for select using (public.has_admin_access());
create policy own_access_grant_read on public.app_access_grants
  for select using (user_id = auth.uid());
create policy tournaments_read on public.tournaments for select using (public.has_active_access());
create policy tournament_players_read on public.tournament_players for select using (public.has_active_access());
create policy matches_read on public.matches for select using (public.has_active_access());
create policy match_players_read on public.match_players for select using (public.has_active_access());
create policy doodle_read on public.doodle_availability for select using (public.has_active_access());
create policy attendance_records_read on public.attendance_records for select using (public.has_active_access());
create policy attendance_players_read on public.attendance_players for select using (public.has_active_access());
create policy settings_read on public.app_settings for select using (public.has_active_access());
create policy own_push_read on public.push_subscriptions
  for select using (owner_user_id = auth.uid() or public.has_admin_access());
create policy own_push_insert on public.push_subscriptions
  for insert with check (owner_user_id = auth.uid() and public.has_active_access());
create policy own_push_update on public.push_subscriptions
  for update using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy audit_read_admin on public.audit_events for select using (public.has_admin_access());
create policy outbox_read_admin on public.notification_outbox for select using (public.has_admin_access());
create policy elo_versions_read on public.elo_calculation_versions for select using (public.has_active_access());
create policy elo_snapshots_read on public.elo_snapshots for select using (public.has_active_access());
create policy projection_runs_read_admin on public.projection_runs for select using (public.has_admin_access());
create policy backup_runs_read_admin on public.backup_runs for select using (public.has_admin_access());
