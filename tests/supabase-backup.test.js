import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeBackupSnapshot } from '../scripts/supabase/export-to-github.mjs';
import { verifyBackup } from '../scripts/supabase/verify-backup.mjs';

const roots = [];

function fixture() {
  return {
    players: [{ id: 'p1', legacy_id: 'legacy-1', name: 'Alex', match_padel_id: 0, active: true }],
    player_aliases: [],
    player_roles: [],
    tournaments: [{ id: 't1', tournament_date: '2026-01-06', status: 'completed', is_complete: true }],
    tournament_players: [{ tournament_id: 't1', player_id: 'p1', seed_position: 1, confirmed: true }],
    matches: [{ id: 'm1', legacy_key: '2026-01-06:1:1', tournament_id: 't1', round_number: 1, match_order: 1, score_team_1: 15, score_team_2: 10 }],
    match_players: [
      { match_id: 'm1', player_id: 'p1', team: 1, position: 1 },
      { match_id: 'm1', player_id: 'p1', team: 1, position: 2 },
      { match_id: 'm1', player_id: 'p1', team: 2, position: 1 },
      { match_id: 'm1', player_id: 'p1', team: 2, position: 2 },
    ],
    doodle_availability: [{ availability_date: '2026-01-06', player_id: 'p1' }],
    attendance_records: [{ id: 'a1', attendance_date: '2026-01-08', kind: 'manual' }],
    attendance_players: [{ attendance_id: 'a1', player_id: 'p1' }],
    app_settings: [],
    elo_calculation_versions: [{ id: 'mexicano-v1', active: true }],
    elo_snapshots: [{ calculation_version: 'mexicano-v1', tournament_id: 't1', player_id: 'p1', elo: 1012.5, previous_elo: 1000, source_match_count: 1 }],
    projection_runs: [],
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Supabase DataHub backup', () => {
  it('writes legacy files, sanitized canonical tables, and a hashed manifest', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mexicano-backup-'));
    roots.push(root);
    const stale = path.join(root, 'backup-data', '2025', '2025-12', '2025-12-30.json');
    fs.mkdirSync(path.dirname(stale), { recursive: true });
    fs.writeFileSync(stale, '{}');

    const result = writeBackupSnapshot(fixture(), root, {
      generatedAt: '2026-01-06T08:15:00.000Z',
      schemaVersion: '20260924120000',
    });

    expect(fs.existsSync(stale)).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'backup-data', 'players.json')))[0].Name).toBe('Alex');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'backup-data', 'tournaments.json')))[0].date).toBe('2026-01-06');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'backup-data', '2026', '2026-01', '2026-01-06.json'))).match_count).toBe(1);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'backup-data', '2026', '2026-01', 'doodle_2026-01.json')))[0].name).toBe('Alex');
    expect(JSON.parse(fs.readFileSync(path.join(root, 'backup-data', 'data', 'attendance_manual.json')))[0].players).toEqual(['Alex']);

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'supabase-backup', 'manifest.json')));
    expect(manifest.schema_version).toBe('20260924120000');
    expect(manifest.projection_version).toBe('mexicano-v1');
    expect(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    expect(manifest.record_counts.matches).toBe(1);
    expect(result.filesWritten).toBe(manifest.files.length + 1);
    expect(fs.existsSync(path.join(root, 'supabase-backup', 'tables', 'push_subscriptions.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'supabase-backup', 'tables', 'app_access_grants.json'))).toBe(false);
    expect(verifyBackup(root)).toEqual({
      filesVerified: manifest.files.length,
      recordCounts: manifest.record_counts,
    });
  });
});
