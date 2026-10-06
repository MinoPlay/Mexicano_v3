import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = path.resolve('supabase/migrations/20260930120000_replace_stale_matches.sql');
const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

describe('save_tournament removes stale matches', () => {
  it('migration makes import_legacy_dataset delete matches missing from a replace_matches payload', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = read(migrationPath);

    expect(sql).toContain('create or replace function public.import_legacy_dataset(payload jsonb)');
    expect(sql).toMatch(/if coalesce\(\(payload->>'replace_matches'\)::boolean, false\) then/);
    expect(sql).toMatch(/delete from public\.matches m/);
    // Only tournaments that still send at least one match are pruned, so an
    // empty/unhydrated client payload can never wipe a whole tournament.
    expect(sql).toMatch(/where \(pm->>'match_date'\)::date = t\.tournament_date/);
    expect(sql).toMatch(/and \(pm->>'round_number'\)::integer = m\.round_number/);
    expect(sql).toMatch(/and \(pm->>'match_order'\)::integer = m\.match_order/);
    expect(sql).toContain('grant execute on function public.import_legacy_dataset(jsonb) to service_role');
  });

  it('domain-mutation saveTournament asks the RPC to replace matches', () => {
    const source = read('supabase/functions/domain-mutation/index.ts');
    const body = source.slice(
      source.indexOf('async function saveTournament'),
      source.indexOf('async function confirmAttendance'),
    );
    expect(body).toContain('replace_matches: true');
  });
});
