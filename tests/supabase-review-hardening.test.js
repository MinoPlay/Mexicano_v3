import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = path.resolve('supabase/migrations/20261002090000_review_hardening.sql');

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'a0000000-0000-4000-8000-000000000002';
const EMAIL_USER = 'c0000000-0000-4000-8000-000000000001';
const CODE_USER = 'c0000000-0000-4000-8000-000000000002';

const BASE_SCHEMA = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

  create table public.players (id uuid primary key, name text not null unique, active boolean not null default true);
  create table public.app_access_grants (
    user_id uuid primary key, role text not null default 'member',
    selected_player_id uuid references public.players(id),
    expires_at timestamptz not null, revoked_at timestamptz, last_used_at timestamptz
  );
  create table public.approved_auth_users (
    user_id uuid primary key, email text not null,
    player_id uuid references public.players(id), revoked_at timestamptz
  );
  create function public.has_active_access() returns boolean language sql stable as $$
    select exists (select 1 from public.app_access_grants
      where user_id = auth.uid() and revoked_at is null and expires_at > now())
  $$;
  create function public.resolve_legacy_player_id(p_name text) returns uuid language plpgsql stable as $$
  declare resolved_id uuid;
  begin
    select id into resolved_id from public.players where lower(name) = lower(trim(p_name));
    if resolved_id is null then raise exception 'Unmapped legacy player: %', p_name; end if;
    return resolved_id;
  end $$;

  create table public.attendance_records (
    id uuid primary key default gen_random_uuid(),
    attendance_date date not null unique, note text
  );
  create table public.attendance_players (
    attendance_id uuid not null references public.attendance_records(id) on delete cascade,
    player_id uuid not null references public.players(id),
    primary key (attendance_id, player_id)
  );
  create table public.audit_events (
    id uuid primary key default gen_random_uuid(),
    actor_user_id uuid, actor_player_id uuid, action text not null,
    entity_type text not null, entity_id text, after_data jsonb
  );
  create table public.notification_outbox (
    id uuid primary key default gen_random_uuid(),
    idempotency_key text not null unique, channel text not null, event_type text not null,
    payload jsonb not null, status text not null default 'pending',
    attempt_count integer not null default 0,
    available_at timestamptz not null default now(), delivered_at timestamptz,
    last_error text, correlation_id uuid not null default gen_random_uuid(),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );

  insert into public.players (id, name) values
    ('${ALICE}', 'Alice'), ('${BOB}', 'Bob');
  insert into public.app_access_grants (user_id, expires_at) values
    ('${EMAIL_USER}', now() + interval '1 day'), ('${CODE_USER}', now() + interval '1 day');
  insert into public.approved_auth_users (user_id, email, player_id) values
    ('${EMAIL_USER}', 'alice@example.com', '${ALICE}');
`;

async function asUser(db, uid, sql, params) {
  await db.exec(`select set_config('test.uid', '${uid}', false)`);
  return db.query(sql, params);
}

let db;

describe('review hardening migration (Postgres via PGlite)', () => {
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(BASE_SCHEMA);
    await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  });

  describe('bind_current_player', () => {
    it('refuses to bind an email-approved user to a different player', async () => {
      await expect(asUser(db, EMAIL_USER, 'select public.bind_current_player($1)', [BOB]))
        .rejects.toThrow(/bound to a different player/);
      const { rows } = await db.query('select selected_player_id from public.app_access_grants where user_id = $1', [EMAIL_USER]);
      expect(rows[0].selected_player_id).toBeNull();
    });

    it('lets an email-approved user bind their own player', async () => {
      await asUser(db, EMAIL_USER, 'select public.bind_current_player($1)', [ALICE]);
      const { rows } = await db.query('select selected_player_id from public.app_access_grants where user_id = $1', [EMAIL_USER]);
      expect(rows[0].selected_player_id).toBe(ALICE);
    });

    it('keeps free selection for transitional shared-code sessions', async () => {
      await asUser(db, CODE_USER, 'select public.bind_current_player($1)', [BOB]);
      const { rows } = await db.query('select selected_player_id from public.app_access_grants where user_id = $1', [CODE_USER]);
      expect(rows[0].selected_player_id).toBe(BOB);
    });
  });

  describe('replace_manual_attendance', () => {
    const call = (entries) => db.query(
      'select public.replace_manual_attendance($1::jsonb, $2, $3) as n',
      [JSON.stringify(entries), EMAIL_USER, ALICE],
    );

    it('replaces the list and writes one audit event', async () => {
      await call([{ date: '2026-09-01', players: ['Alice'] }]);
      const { rows: [{ n }] } = await call([
        { date: '2026-10-01', note: 'Cup', players: ['Alice', 'Bob'] },
        { date: '2026-10-08', players: [] },
      ]);
      expect(n).toBe(2);

      const { rows } = await db.query(`
        select r.attendance_date::text as d, r.note, count(p.player_id)::int as players
        from public.attendance_records r left join public.attendance_players p on p.attendance_id = r.id
        group by r.id order by r.attendance_date`);
      expect(rows).toEqual([
        { d: '2026-10-01', note: 'Cup', players: 2 },
        { d: '2026-10-08', note: null, players: 0 },
      ]);
      const audit = await db.query(`select actor_player_id, after_data from public.audit_events order by after_data->>'count'`);
      expect(audit.rows.at(-1)).toEqual({ actor_player_id: ALICE, after_data: { count: 2 } });
    });

    it('rolls back entirely when a player cannot be resolved', async () => {
      await call([{ date: '2026-09-01', players: ['Alice'] }]);

      await expect(db.transaction((tx) => tx.query(
        'select public.replace_manual_attendance($1::jsonb, $2, $3)',
        [JSON.stringify([{ date: '2026-10-01', players: ['Alice', 'Ghost'] }]), EMAIL_USER, ALICE],
      ))).rejects.toThrow(/Unmapped legacy player: Ghost/);

      const { rows } = await db.query('select attendance_date::text as d from public.attendance_records');
      expect(rows).toEqual([{ d: '2026-09-01' }]);
      const audit = await db.query('select count(*)::int as n from public.audit_events');
      expect(audit.rows[0].n).toBe(1);
    });
  });

  describe('claim_notification_outbox', () => {
    beforeEach(async () => {
      await db.exec(`
        insert into public.notification_outbox (idempotency_key, channel, event_type, payload, status, available_at, created_at, updated_at) values
          ('ready-1', 'telegram', 'telegram_alert', '{}', 'pending', now() - interval '1 minute', now() - interval '3 minutes', now()),
          ('ready-2', 'telegram', 'telegram_alert', '{}', 'failed',  now() - interval '1 minute', now() - interval '2 minutes', now()),
          ('later',   'telegram', 'telegram_alert', '{}', 'pending', now() + interval '1 hour',   now(), now()),
          ('busy',    'telegram', 'telegram_alert', '{}', 'processing', now(), now(), now()),
          ('stuck',   'telegram', 'telegram_alert', '{}', 'processing', now(), now() - interval '1 minute', now() - interval '11 minutes'),
          ('done',    'telegram', 'telegram_alert', '{}', 'delivered', now(), now(), now());
      `);
    });

    it('claims ready and stuck rows once, marking them processing', async () => {
      const first = await db.query('select idempotency_key, status, attempt_count from public.claim_notification_outbox(10)');
      expect(first.rows.map((r) => r.idempotency_key).sort()).toEqual(['ready-1', 'ready-2', 'stuck']);
      expect(first.rows.every((r) => r.status === 'processing' && r.attempt_count === 1)).toBe(true);

      const second = await db.query('select idempotency_key from public.claim_notification_outbox(10)');
      expect(second.rows).toEqual([]);
    });

    it('respects the limit, oldest first', async () => {
      const { rows } = await db.query('select idempotency_key from public.claim_notification_outbox(1)');
      expect(rows).toEqual([{ idempotency_key: 'ready-1' }]);
    });

    it('locks candidate rows with SKIP LOCKED', () => {
      expect(fs.readFileSync(MIGRATION, 'utf8')).toMatch(/for update skip locked/i);
    });
  });
});

describe('edge functions use the hardened server paths', () => {
  const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');
  const fnBody = (source, name) => {
    const start = source.indexOf(`async function ${name}`);
    const next = source.indexOf('\nasync function ', start + 1);
    return source.slice(start, next === -1 ? source.indexOf('Deno.serve') : next);
  };

  it('domain-mutation derives player identity from the approved email binding', () => {
    const access = read('supabase/functions/_shared/access.ts');
    expect(access).toContain('export async function effectivePlayerId');
    expect(access).toContain("from('approved_auth_users')");
    const source = read('supabase/functions/domain-mutation/index.ts');
    expect(fnBody(source, 'requireGrant')).toContain('effectivePlayerId(');
  });

  it('elevate-admin checks the admin role of the approved player, not a free selection', () => {
    const source = read('supabase/functions/elevate-admin/index.ts');
    expect(source).toContain('effectivePlayerId(');
    expect(source).not.toMatch(/\.eq\('player_id', grant\.selected_player_id\)/);
  });

  it('domain-mutation saves manual attendance through the transactional RPC', () => {
    const body = fnBody(read('supabase/functions/domain-mutation/index.ts'), 'saveManualAttendance');
    expect(body).toContain("rpc('replace_manual_attendance'");
    expect(body).not.toContain("from('attendance_records')");
    expect(body).not.toContain('audit(');
  });

  it('domain-mutation authorizes notifications before enqueueing', () => {
    const body = fnBody(read('supabase/functions/domain-mutation/index.ts'), 'enqueue');
    expect(body).toContain('authorizeNotification(');
    expect(body).not.toContain('payload.event_type,');
  });

  it('dispatch-outbox claims rows atomically', () => {
    const source = read('supabase/functions/dispatch-outbox/index.ts');
    expect(source).toContain("rpc('claim_notification_outbox'");
    expect(source).not.toContain(".in('status'");
    expect(source).not.toContain("status: 'processing'");
  });
});
