import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = path.resolve('supabase/scripts/set-active-players.sql');

describe('Supabase active-player allow-list script', () => {
  it('contains the 2026 active-player allow-list and updates every player atomically', () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
    const sql = fs.readFileSync(scriptPath, 'utf8');

    expect(sql).toContain('begin;');
    expect(sql).toContain('create temporary table active_player_allowlist');
    expect(sql).toContain("('Alex')");
    expect(sql).toContain("('Vishal')");
    expect(sql.split('do $$', 1)[0]).not.toContain('REPLACE WITH ACTIVE PLAYER');
    expect(sql).toContain('raise exception');
    expect(sql).toContain('update public.players');
    expect(sql).toContain('set active = exists');
    expect(sql).toContain('commit;');
  });
});
