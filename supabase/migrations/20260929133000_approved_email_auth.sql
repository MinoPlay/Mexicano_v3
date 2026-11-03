create table if not exists public.approved_auth_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  approved_at timestamptz not null default now(),
  approved_by text not null default 'local-script',
  revoked_at timestamptz,
  notes text
);

create unique index if not exists approved_auth_users_email_unique
  on public.approved_auth_users (lower(email));

alter table public.approved_auth_users enable row level security;
revoke all on table public.approved_auth_users from public, anon, authenticated;
grant select, insert, update, delete on table public.approved_auth_users to service_role;

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

  insert into public.approved_auth_users (
    user_id,
    email,
    approved_at,
    approved_by,
    revoked_at,
    notes
  )
  values (
    p_user_id,
    normalized_email,
    now(),
    coalesce(nullif(trim(p_approved_by), ''), 'local-script'),
    null,
    p_notes
  )
  on conflict (user_id) do update
    set email = excluded.email,
        approved_at = now(),
        approved_by = excluded.approved_by,
        revoked_at = null,
        notes = excluded.notes;

  perform public.grant_app_access(p_user_id, p_expires_at, 'member');

  return jsonb_build_object(
    'user_id', p_user_id,
    'email', normalized_email,
    'expires_at', p_expires_at,
    'status', 'approved'
  );
end;
$$;

create or replace function public.revoke_email_user(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text := lower(trim(p_email));
  target_user_id uuid;
begin
  update public.approved_auth_users
  set revoked_at = now()
  where lower(email) = normalized_email
    and revoked_at is null
  returning user_id into target_user_id;

  if target_user_id is null then
    raise exception 'Approved email user was not found or is already revoked';
  end if;

  update public.app_access_grants
  set revoked_at = now(),
      last_used_at = now()
  where user_id = target_user_id;

  return jsonb_build_object(
    'user_id', target_user_id,
    'email', normalized_email,
    'status', 'revoked'
  );
end;
$$;

revoke all on function public.approve_email_user(uuid, text, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.approve_email_user(uuid, text, timestamptz, text, text)
  to service_role;

revoke all on function public.revoke_email_user(text)
  from public, anon, authenticated;
grant execute on function public.revoke_email_user(text)
  to service_role;
