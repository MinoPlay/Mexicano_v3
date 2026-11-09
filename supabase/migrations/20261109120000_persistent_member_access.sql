-- Membership is revocable, not time-limited. expires_at only limits admin elevation.
update public.app_access_grants
set expires_at = 'infinity'::timestamptz
where role = 'member' and revoked_at is null;

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
  );
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
  values (
    p_user_id, p_role,
    case when p_role = 'member' then 'infinity'::timestamptz else p_expires_at end,
    null, now()
  )
  on conflict (user_id) do update
    set role = excluded.role,
        expires_at = excluded.expires_at,
        revoked_at = null,
        last_used_at = now();
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
      )
    ) as entry
    from public.players p
    where p.active
      and coalesce(trim(p.email), '') <> ''
  ) allowed;
$$;

revoke all on function public.grant_app_access(uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.grant_app_access(uuid, timestamptz, text) to service_role;
revoke all on function public.list_allowed_emails() from public, anon, authenticated;
grant execute on function public.list_allowed_emails() to service_role;
