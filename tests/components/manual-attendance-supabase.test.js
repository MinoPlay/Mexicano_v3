import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('manual attendance persistence', () => {
  it('awaits the Supabase backend before showing success', () => {
    const source = fs.readFileSync(
      path.resolve('js/components/manual-attendance-dialog.js'),
      'utf8',
    );

    expect(source).toContain("import { saveManualAttendance } from '../services/backend.js'");
    expect(source).toContain('await saveManualAttendance(next)');
    expect(source).not.toContain('Store.setManualAttendance(next)');
  });
});
