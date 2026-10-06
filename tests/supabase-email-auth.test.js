import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  'supabase/migrations/20260929133000_approved_email_auth.sql',
);
const allowlistPath = path.resolve(
  'supabase/migrations/20260929143000_players_email_allowlist.sql',
);
const scriptPath = path.resolve('scripts/supabase/manage-auth-user.mjs');

describe('Approved Supabase email authentication', () => {
  it('defines an allowlist backed by the existing app access grants', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('create table if not exists public.approved_auth_users');
    expect(sql).toContain('references auth.users(id) on delete cascade');
    expect(sql).toContain('function public.approve_email_user');
    expect(sql).toContain('function public.revoke_email_user');
    expect(sql).toContain('public.grant_app_access');
    expect(sql).toContain('to service_role');
    expect(sql).toContain('enable row level security');
  });

  it('treats players.email as the authoritative allowlist', () => {
    expect(fs.existsSync(allowlistPath)).toBe(true);
    const sql = fs.readFileSync(allowlistPath, 'utf8');

    expect(sql).toContain('add column if not exists player_id uuid');
    expect(sql).toContain('references public.players(id)');
    expect(sql).toContain('from public.players');
    expect(sql).toContain('lower(email) = normalized_email');
    expect(sql).toContain('and active');
    expect(sql).toContain('is not an approved Mexicano email');
    expect(sql).toContain('selected_player_id = resolved_player_id');
    expect(sql).toContain('function public.list_allowed_emails');
  });

  it('provides a local service-role provisioning script', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(source).toContain('/auth/v1/admin/users');
    expect(source).toContain('/rest/v1/rpc/');
    expect(source).toContain("'approve_email_user'");
    expect(source).toContain("'revoke_email_user'");
    expect(source).toContain("'list_allowed_emails'");
    expect(source).not.toContain('AUTH_USER_PASSWORD');
    expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY=');
  });
});
