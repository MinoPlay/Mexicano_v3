import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mutationPath = path.resolve('supabase/functions/domain-mutation/index.ts');

describe('Supabase domain mutation function', () => {
  it('implements explicit persisted operations and notification enqueueing', () => {
    expect(fs.existsSync(mutationPath)).toBe(true);
    const source = fs.readFileSync(mutationPath, 'utf8');

    for (const operation of [
      'save_tournament',
      'confirm_attendance',
      'save_doodle',
      'save_manual_attendance',
      'add_player',
      'delete_tournament',
      'enqueue_notification',
    ]) {
      expect(source).toContain(`'${operation}'`);
    }
    expect(source).toContain("rpc('import_legacy_dataset'");
    expect(source).toContain("from('audit_events').insert");
    expect(source).toContain("rpc('enqueue_notification'");
  });
});
