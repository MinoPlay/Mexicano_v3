import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cache } from '../js/cache.js';
import { Store } from '../js/store.js';
import { buildTournamentFromRows } from '../js/services/tournament-shape.js';
import { buildEloProjection } from '../scripts/supabase/build-elo-projection.mjs';

const migrationPath = path.resolve('supabase/migrations/20260930100000_schema_cleanup.sql');
const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

const REMOVED_TABLES = [
  'app_settings',
  'player_aliases',
  'backup_runs',
  'projection_runs',
  'elo_calculation_versions',
];
const REMOVED_COLUMNS = [
  'source_path',
  'legacy_id',
  'legacy_key',
  'is_complete',
  'source_match_count',
  'calculation_version',
];

describe('Schema cleanup migration', () => {
  it('drops unused tables and redundant columns', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = read(migrationPath);

    for (const table of REMOVED_TABLES) {
      expect(sql).toContain(`drop table if exists public.${table}`);
    }
    for (const column of [...REMOVED_COLUMNS, 'version', 'completed_at', 'kind', 'tournament_id', 'confirmed']) {
      expect(sql).toMatch(new RegExp(`drop column if exists ${column}\\b`));
    }
    expect(sql).toContain('primary key (tournament_id, player_id)');
    expect(sql).toContain('unique (attendance_date)');
  });

  it('rewrites the save/import RPC to use natural keys only', () => {
    const sql = read(migrationPath);
    const body = sql.slice(sql.indexOf('function public.import_legacy_dataset'));
    const fnBody = body.slice(0, body.indexOf('$$;'));

    expect(fnBody).toContain('on conflict (tournament_id, round_number, match_order)');
    expect(fnBody).toContain('on conflict (attendance_date)');
    for (const column of ['source_path', 'legacy_id', 'legacy_key', 'player_aliases', 'is_complete)']) {
      expect(fnBody).not.toContain(column);
    }
  });

  it('keeps ELO projection replace without version/run bookkeeping', () => {
    const sql = read(migrationPath);
    const body = sql.slice(sql.indexOf('function public.replace_elo_projection'));
    const fnBody = body.slice(0, body.indexOf('$$;'));
    expect(fnBody).toContain('delete from public.elo_snapshots');
    expect(fnBody).not.toContain('projection_runs');
    expect(fnBody).not.toContain('calculation_version');
  });

  it('resolves players without the alias table', () => {
    const sql = read(migrationPath);
    const body = sql.slice(sql.indexOf('function public.resolve_legacy_player_id'));
    expect(body.slice(0, body.indexOf('$$;'))).not.toContain('player_aliases');
  });
});

describe('Browser Supabase reads', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const key of Cache.keys()) Cache.del(key);
    vi.restoreAllMocks();
  });

  it('never selects removed columns', () => {
    const source = read('js/services/supabase.js');
    for (const token of ['is_complete', 'legacy_id', 'calculation_version', 'completed_at,match_players', 'kind', 'attendance_players(player_id,confirmed)']) {
      expect(source).not.toContain(token);
    }
  });

  it('treats status=completed as the only completion flag and manual attendance without kind', async () => {
    const supabase = await import('../js/services/supabase.js');
    supabase.hydrateSupabaseDataset({
      players: [{ id: 'p1', name: 'A' }],
      tournaments: [
        { id: 't1', tournament_date: '2026-01-01', status: 'completed' },
        { id: 't2', tournament_date: '2026-01-08', status: 'active' },
      ],
      matches: [],
      match_players: [],
      attendance_records: [{ id: 'a1', attendance_date: '2026-01-09', note: '' }],
      attendance_players: [{ attendance_id: 'a1', player_id: 'p1' }],
    });

    expect(Store.getTournamentsIndex().map((row) => row.isComplete)).toEqual([true, false]);
    expect(Store.getActiveTournament()?.tournamentDate).toBe('2026-01-08');
    expect(Store.getManualAttendance()).toEqual([
      { date: '2026-01-09', players: ['A'], note: '' },
    ]);
  });
});

describe('Tournament shaping', () => {
  it('uses the Supabase id and status for completion', () => {
    const built = buildTournamentFromRows({
      tournament: { id: 'uuid-1', legacy_id: 'old-id', tournament_date: '2026-01-01', status: 'completed' },
      playersById: new Map(),
    });
    expect(built.id).toBe('uuid-1');
    expect(built.isCompleted).toBe(true);
  });
});

describe('save_tournament payload', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const key of Cache.keys()) Cache.del(key);
    vi.restoreAllMocks();
  });

  it('sends natural keys and no removed columns', async () => {
    const supabase = await import('../js/services/supabase.js');
    const backend = await import('../js/services/backend.js');
    const invoke = vi.spyOn(supabase, 'invokeFunction').mockResolvedValue({});
    Store.setMatches([{
      date: '2026-01-01',
      roundNumber: 1,
      scoreTeam1: 13,
      scoreTeam2: 12,
      team1Player1Name: 'A',
      team1Player2Name: 'B',
      team2Player1Name: 'C',
      team2Player2Name: 'D',
    }]);

    await backend.pushTournamentDayFile({
      id: 'local-id',
      tournamentDate: '2026-01-01',
      isCompleted: true,
      players: [{ id: 1, name: 'A' }],
    });

    const { payload } = invoke.mock.calls[0][1];
    const json = JSON.stringify(payload);
    for (const token of ['source_path', 'legacy_id', 'is_complete', 'match_key']) {
      expect(json).not.toContain(token);
    }
    expect(payload.tournaments[0].status).toBe('completed');
    expect(payload.match_players[0]).toMatchObject({
      match_date: '2026-01-01',
      round_number: 1,
      match_order: 1,
      team: 1,
      position: 1,
      player_name: 'A',
    });
  });
});

describe('Edge function and scripts', () => {
  it('domain-mutation writes no removed columns', () => {
    const source = read('supabase/functions/domain-mutation/index.ts');
    expect(source).not.toContain('source_path');
    expect(source).not.toContain('is_complete');
    expect(source).not.toContain("eq('kind'");
    expect(source).not.toMatch(/kind: 'manual'/);
  });

  it('backup export no longer references dropped tables', () => {
    const source = read('scripts/supabase/export-to-github.mjs');
    for (const token of [...REMOVED_TABLES, 'legacy_id', 'is_complete', '.kind']) {
      expect(source).not.toContain(token);
    }
  });

  it('ELO projection payload has no version bookkeeping', () => {
    const projection = buildEloProjection({ matches: [], match_players: [] });
    expect(projection).toEqual({ snapshots: [] });
  });
});
