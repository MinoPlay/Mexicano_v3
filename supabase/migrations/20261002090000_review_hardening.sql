-- Review hardening for the Supabase source-of-truth migration (PR #14 review).
--
-- 1. bind_current_player: email-approved users are locked to the player their
--    approved email resolves to, so they cannot impersonate another player.
--    Shared-code (anonymous) sessions keep free selection while that
--    transitional path exists (see .github/features/email-authentication.md).
-- 2. replace_manual_attendance: validates, replaces and audits the manual
--    attendance list in one transaction, so a failure can never leave it
--    empty or partially written.
-- 3. claim_notification_outbox: atomically claims ready rows with
--    FOR UPDATE SKIP LOCKED, so concurrent dispatchers never send one row
--    twice. Rows stuck in 'processing' (crashed worker) become claimable again
--    after 10 minutes.

begin;

create or replace function public.bind_current_player(p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  approved_player_id uuid;
begin
  if not public.has_active_access() then
    raise exception 'Active app access is required';
  end if;
  if not exists (select 1 from public.players where id = p_player_id and active) then
    raise exception 'Player does not exist or is inactive';
  end if;

  select player_id into approved_player_id
  from public.approved_auth_users
  where user_id = auth.uid()
    and revoked_at is null;

  if approved_player_id is not null and approved_player_id <> p_player_id then
    raise exception 'Signed-in email is bound to a different player';
  end if;

  update public.app_access_grants
  set selected_player_id = p_player_id, last_used_at = now()
  where user_id = auth.uid();
end;
$$;

grant execute on function public.bind_current_player(uuid) to authenticated;

create or replace function public.replace_manual_attendance(
  p_entries jsonb,
  p_actor_user_id uuid,
  p_actor_player_id uuid
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  entry jsonb;
  player_name text;
  record_id uuid;
  entry_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_entries, '[]'::jsonb)) <> 'array' then
    raise exception 'Attendance entries must be an array';
  end if;

  -- attendance_players rows cascade with their record.
  delete from public.attendance_records where id is not null;

  for entry in select value from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb))
  loop
    insert into public.attendance_records (attendance_date, note)
    values ((entry->>'date')::date, nullif(entry->>'note', ''))
    returning id into record_id;

    for player_name in
      select value from jsonb_array_elements_text(coalesce(entry->'players', '[]'::jsonb))
    loop
      insert into public.attendance_players (attendance_id, player_id)
      values (record_id, public.resolve_legacy_player_id(player_name))
      on conflict do nothing;
    end loop;
    entry_count := entry_count + 1;
  end loop;

  insert into public.audit_events (
    actor_user_id, actor_player_id, action, entity_type, entity_id, after_data
  ) values (
    p_actor_user_id, p_actor_player_id, 'save', 'manual_attendance', null,
    jsonb_build_object('count', entry_count)
  );

  return entry_count;
end;
$$;

revoke all on function public.replace_manual_attendance(jsonb, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.replace_manual_attendance(jsonb, uuid, uuid)
  to service_role;

create or replace function public.claim_notification_outbox(p_limit integer default 25)
returns setof public.notification_outbox
language sql
set search_path = public
as $$
  update public.notification_outbox o
  set status = 'processing',
      attempt_count = o.attempt_count + 1,
      last_error = null,
      updated_at = now()
  where o.id in (
    select id
    from public.notification_outbox
    where (status in ('pending', 'failed') and available_at <= now())
       or (status = 'processing' and updated_at < now() - interval '10 minutes')
    order by created_at
    limit greatest(coalesce(p_limit, 25), 0)
    for update skip locked
  )
  returning o.*;
$$;

revoke all on function public.claim_notification_outbox(integer)
  from public, anon, authenticated;
grant execute on function public.claim_notification_outbox(integer)
  to service_role;

commit;
