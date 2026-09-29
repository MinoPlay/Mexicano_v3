import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  'supabase/migrations/20260929133000_approved_email_auth.sql',
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

  it('provides a local service-role provisioning script', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const source = fs.readFileSync(scriptPath, 'utf8');

    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(source).toContain('/auth/v1/admin/users');
    expect(source).toContain('/rest/v1/rpc/');
    expect(source).toContain("'approve_email_user'");
    expect(source).toContain("'revoke_email_user'");
    expect(source).not.toContain('SUPABASE_SERVICE_ROLE_KEY=');
  });
});
