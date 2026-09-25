import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve(
  'supabase/migrations/20260924120000_supabase_source_of_truth.sql',
);

describe('Supabase source-of-truth schema', () => {
  it('defines the canonical relational, projection, audit, and outbox tables', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf8');

    for (const table of [
      'players',
      'player_aliases',
      'player_roles',
      'app_access_grants',
      'tournaments',
      'tournament_players',
      'matches',
      'match_players',
      'doodle_availability',
      'attendance_records',
      'attendance_players',
      'push_subscriptions',
      'audit_events',
      'notification_outbox',
      'elo_calculation_versions',
      'elo_snapshots',
      'projection_runs',
      'backup_runs',
    ]) {
      expect(sql).toContain(`create table public.${table}`);
    }
  });

  it('enables RLS and prevents selected-player identity from granting admin access', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('alter table public.app_access_grants enable row level security');
    expect(sql).toContain('public.has_active_access()');
    expect(sql).toContain('public.has_admin_access()');
    expect(sql).toContain("role = 'admin'");
    expect(sql).toContain('selected_player_id');
  });

  it('provides idempotent legacy import and transactional outbox functions', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('function public.import_legacy_dataset');
    expect(sql).toContain('on conflict');
    expect(sql).toContain('function public.enqueue_notification');
    expect(sql).toContain('idempotency_key');
  });
});
