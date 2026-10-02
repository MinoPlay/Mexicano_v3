-- players.email is the authoritative allowlist for email authentication.
-- Requires 20260929133000_approved_email_auth.sql to have been applied first.

alter table public.approved_auth_users
  add column if not exists player_id uuid references public.players(id) on delete restrict;

create index if not exists approved_auth_users_player_idx
  on public.approved_auth_users (player_id);

create or replace function public.approve_email_user(
  p_user_id uuid,
  p_email text,
  p_expires_at timestamptz,
  p_approved_by text default 'local-script',
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_email text := lower(trim(p_email));
  auth_email text;
  resolved_player_id uuid;
  resolved_player_name text;
begin
  if normalized_email = '' then
    raise exception 'Email is required';
  end if;
  if p_expires_at <= now() then
    raise exception 'Access expiry must be in the future';
  end if;

  select lower(email)
  into auth_email
  from auth.users
  where id = p_user_id;

  if auth_email is null then
    raise exception 'Supabase Auth user does not exist';
  end if;
  if auth_email <> normalized_email then
    raise exception 'Auth user email does not match the approved email';
  end if;

  select id, name
  into resolved_player_id, resolved_player_name
  from public.players
  where lower(email) = normalized_email
    and active;

  if resolved_player_id is null then
    raise exception '% is not an approved Mexicano email; add it to players.email first', normalized_email;
  end if;

  insert into public.approved_auth_users (
    user_id,
    email,
    player_id,
    approved_at,
    approved_by,
    revoked_at,
    notes
  )
  values (
    p_user_id,
    normalized_email,
    resolved_player_id,
    now(),
    coalesce(nullif(trim(p_approved_by), ''), 'local-script'),
    null,
    p_notes
  )
  on conflict (user_id) do update
    set email = excluded.email,
        player_id = excluded.player_id,
        approved_at = now(),
        approved_by = excluded.approved_by,
        revoked_at = null,
        notes = excluded.notes;

  perform public.grant_app_access(p_user_id, p_expires_at, 'member');

  update public.app_access_grants
  set selected_player_id = resolved_player_id,
      last_used_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'user_id', p_user_id,
    'email', normalized_email,
    'player_id', resolved_player_id,
    'player_name', resolved_player_name,
    'expires_at', p_expires_at,
    'status', 'approved'
  );
end;
$$;

create or replace function public.list_allowed_emails()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(entry order by entry->>'email'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'email', lower(trim(p.email)),
      'player_id', p.id,
      'player_name', p.name,
      'has_active_access', exists (
        select 1
        from public.approved_auth_users a
        join public.app_access_grants g on g.user_id = a.user_id
        where a.player_id = p.id
          and a.revoked_at is null
          and g.revoked_at is null
          and g.expires_at > now()
      )
    ) as entry
    from public.players p
    where p.active
      and coalesce(trim(p.email), '') <> ''
  ) allowed;
$$;

revoke all on function public.approve_email_user(uuid, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.approve_email_user(uuid, text, timestamptz, text, text)
  to service_role;

revoke all on function public.list_allowed_emails()
  from public, anon, authenticated;
grant execute on function public.list_allowed_emails()
  to service_role;
