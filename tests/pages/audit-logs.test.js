import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('admin audit logs page', () => {
  it('loads append-only Supabase audit events instead of local round logs', () => {
    const source = fs.readFileSync(path.resolve('js/pages/git-logs.js'), 'utf8');
    expect(source).toContain("import { fetchAuditEvents } from '../services/backend.js'");
    expect(source).toContain('await fetchAuditEvents()');
    expect(source).not.toContain("from '../services/round-log.js'");
    expect(source).not.toContain('clearRoundLog');
  });
});
