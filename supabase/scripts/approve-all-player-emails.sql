-- Approve every players.email that already has a Supabase Auth identity.
--
-- Run in the Supabase SQL Editor (service-role context).
-- Idempotent: re-running refreshes approval and extends the access grant.
--
-- SCOPE: every non-blank players.email is scanned and reported. Approval is
-- only attempted for emails belonging to an active player, because
-- public.approve_email_user() resolves the player with "and active" and raises
-- '<email> is not an approved Mexicano email' otherwise. Inactive players are
-- reported as 'inactive_player'; reactivate the player row to enable them.
--
-- LIMITATION: SQL cannot create Supabase Auth users. Emails without an
-- auth.users row are reported as 'missing_auth_user' and must be provisioned
-- first with:  npm run auth:user:supabase -- approve <email>

-- public.approve_email_user() resolves the player with "lower(email) = ..."
-- and no trim, so a padded players.email can never be approved. Normalize the
-- stored value first; this is idempotent and only strips surrounding whitespace.
update public.players
set email = trim(email)
where email is not null
  and email <> trim(email);

do $$
declare
  access_days constant integer := 3650;
  expires_at constant timestamptz := now() + make_interval(days => access_days);
  allowed record;
  approved_count integer := 0;
  missing_count integer := 0;
  inactive_count integer := 0;
  failed_count integer := 0;
begin
  for allowed in
    select distinct on (lower(trim(p.email)))
      lower(trim(p.email)) as email,
      bool_or(p.active) over (partition by lower(trim(p.email))) as has_active_player,
      u.id as user_id
    from public.players p
    left join auth.users u on lower(u.email) = lower(trim(p.email))
    where coalesce(trim(p.email), '') <> ''
    order by lower(trim(p.email)), p.active desc, u.created_at nulls last
  loop
    if allowed.user_id is null then
      missing_count := missing_count + 1;
      raise notice 'missing_auth_user: % (run: npm run auth:user:supabase -- approve %)',
        allowed.email, allowed.email;
      continue;
    end if;

    if not allowed.has_active_player then
      inactive_count := inactive_count + 1;
      raise notice 'inactive_player: % (reactivate the players row to enable it)', allowed.email;
      continue;
    end if;

    -- Keep one failure from rolling back every prior approval.
    begin
      perform public.approve_email_user(
        allowed.user_id,
        allowed.email,
        expires_at,
        'bulk-sql-script',
        'Approved by approve-all-player-emails.sql'
      );
      approved_count := approved_count + 1;
      raise notice 'approved: %', allowed.email;
    exception when others then
      failed_count := failed_count + 1;
      raise notice 'failed: % (%)', allowed.email, sqlerrm;
    end;
  end loop;

  raise notice 'Done. approved=%, missing_auth_user=%, inactive_player=%, failed=%',
    approved_count, missing_count, inactive_count, failed_count;
end;
$$;

-- Verification report: one row per email present in players.email.
select distinct on (lower(trim(p.email)))
  lower(trim(p.email)) as email,
  p.name as player_name,
  p.active as player_active,
  u.id is not null as auth_user_exists,
  (a.user_id is not null and a.revoked_at is null) as approved,
  g.expires_at,
  case
    when u.id is null then 'missing_auth_user'
    when not bool_or(p.active) over (partition by lower(trim(p.email))) then 'inactive_player'
    when a.user_id is null then 'not_approved'
    when a.revoked_at is not null then 'revoked'
    when g.revoked_at is not null or g.expires_at <= now() then 'no_active_grant'
    else 'active'
  end as status
from public.players p
left join auth.users u on lower(u.email) = lower(trim(p.email))
left join public.approved_auth_users a on a.user_id = u.id
left join public.app_access_grants g on g.user_id = u.id
where coalesce(trim(p.email), '') <> ''
order by lower(trim(p.email)), p.active desc, u.created_at nulls last;
