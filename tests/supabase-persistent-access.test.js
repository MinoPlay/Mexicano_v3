import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { approveUser } from '../scripts/supabase/manage-auth-user.mjs';

const USER = 'c0000000-0000-4000-8000-000000000001';
const PLAYER = 'a0000000-0000-4000-8000-000000000001';
const migrationPath = path.resolve('supabase/migrations/20261109120000_persistent_member_access.sql');
const sourceSql = fs.readFileSync(
  path.resolve('supabase/migrations/20260924120000_supabase_source_of_truth.sql'), 'utf8',
);
const emailSql = fs.readFileSync(
  path.resolve('supabase/migrations/20260929143000_players_email_allowlist.sql'), 'utf8',
);
function sqlFunction(source, name) {
  return source.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`))[0];
}

describe('Persistent membership (Postgres via PGlite)', () => {
  let db;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select '${USER}'::uuid $$;
      create table public.players (id uuid primary key, name text, email text, active boolean);
      create table public.approved_auth_users (user_id uuid primary key, player_id uuid, revoked_at timestamptz);
      create table public.app_access_grants (
        user_id uuid primary key, role text not null default 'member',
        selected_player_id uuid, expires_at timestamptz not null,
        revoked_at timestamptz, last_used_at timestamptz
      );
      insert into public.players values ('${PLAYER}', 'Alice', 'alice@example.com', true);
      insert into public.approved_auth_users values ('${USER}', '${PLAYER}', null);
      insert into public.app_access_grants (user_id, selected_player_id, expires_at)
        values ('${USER}', '${PLAYER}', '2020-01-01');
    `);
    for (const name of ['has_active_access', 'has_admin_access', 'grant_app_access']) {
      await db.exec(sqlFunction(sourceSql, name));
    }
    await db.exec(sqlFunction(emailSql, 'list_allowed_emails'));
    // Exercise the existing behavior in RED, then the additive migration in GREEN.
    if (fs.existsSync(migrationPath)) await db.exec(fs.readFileSync(migrationPath, 'utf8'));
  });
  afterEach(async () => { await db?.close(); });

  const access = async (db) => (await db.query(`
    select public.has_active_access() as member, public.has_admin_access() as admin
  `)).rows[0];

  it('retains existing membership and player binding beyond the old deadline', async () => {
    expect(await access(db)).toEqual({ member: true, admin: false });
    const { rows } = await db.query('select expires_at::text as expiry, selected_player_id from app_access_grants');
    expect(rows).toEqual([{ expiry: 'infinity', selected_player_id: PLAYER }]);
  });

  it('grants permanent membership even to older callers supplying a finite expiry', async () => {
    await db.query("select public.grant_app_access($1, '2030-01-01', 'member')", [USER]);
    const { rows } = await db.query('select expires_at::text as expiry from app_access_grants');
    expect(rows).toEqual([{ expiry: 'infinity' }]);
  });

  it('expires only admin privileges and reports the email as still active', async () => {
    await db.query("select public.grant_app_access($1, '2099-01-01', 'admin')", [USER]);
    expect(await access(db)).toEqual({ member: true, admin: true });
    await db.exec("update app_access_grants set expires_at = '2020-01-01'");
    expect(await access(db)).toEqual({ member: true, admin: false });
    const { rows } = await db.query('select public.list_allowed_emails() as emails');
    expect(rows[0].emails).toEqual([{
      email: 'alice@example.com', player_id: PLAYER, player_name: 'Alice', has_active_access: true,
    }]);
  });

  it('does not revive explicitly revoked access when the migration runs again', async () => {
    await db.exec("update app_access_grants set revoked_at = now()");
    if (fs.existsSync(migrationPath)) await db.exec(fs.readFileSync(migrationPath, 'utf8'));
    expect(await access(db)).toEqual({ member: false, admin: false });
  });
});

describe('Email provisioning persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('approves email membership without a time limit', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        users: [{ id: USER, email: 'alice@example.com' }],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'approved' }))));

    await approveUser('alice@example.com', {
      supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'test-only-key',
    });
    expect(JSON.parse(fetch.mock.calls[1][1].body).p_expires_at).toBe('infinity');
  });
});
