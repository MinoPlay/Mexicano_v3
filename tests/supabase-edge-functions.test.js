import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireUser } from '../supabase/functions/_shared/access.ts';

vi.mock('../supabase/functions/_shared/access.ts', () => ({
  requireUser: vi.fn(),
  effectivePlayerId: vi.fn(async (_client, _userId, selectedPlayerId) => selectedPlayerId),
  assertRateLimit: vi.fn(),
  recordAttempt: vi.fn(),
  sha256Hex: vi.fn(async () => 'test-hash'),
  constantTimeEqual: vi.fn(() => true),
}));

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

  describe('Persistent access Edge Function behavior', () => {
    let handler;
    let client;
    let grant;

    beforeEach(() => {
      vi.resetModules();
      grant = {
        role: 'admin', selected_player_id: null,
        expires_at: '2020-01-01T00:00:00Z', revoked_at: null,
      };
      client = {
        rpc: vi.fn(async () => ({ data: 1, error: null })),
        from: vi.fn(() => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: grant, error: null }) }),
          }),
          insert: vi.fn(async () => ({ error: null })),
        })),
      };
      requireUser.mockResolvedValue({ client, user: { id: 'user-1' } });
      vi.stubGlobal('Deno', {
        serve: callback => { handler = callback; },
        env: { get: name => name === 'APP_ACCESS_CODE_SHA256' ? 'test-hash' : undefined },
      });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('claims shared-code membership without an expiry', async () => {
      await import('../supabase/functions/claim-access/index.ts');
      const result = await handler(new Request('https://example.test/claim-access', {
        method: 'POST', body: JSON.stringify({ code: 'test-code' }),
      }));
      expect(await result.json()).toEqual({ role: 'member', expires_at: 'infinity' });
      expect(client.rpc).toHaveBeenCalledWith('grant_app_access', {
        p_user_id: 'user-1', p_role: 'member', p_expires_at: 'infinity',
      });
    });

    it('allows member mutations after admin elevation expires', async () => {
      await import('../supabase/functions/domain-mutation/index.ts');
      const result = await handler(new Request('https://example.test/domain-mutation', {
        method: 'POST',
        body: JSON.stringify({ operation: 'save_doodle', payload: { year_month: '2026-11' } }),
      }));
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ saved: true });
      expect(client.from).toHaveBeenCalledWith('audit_events');
    });

    it('rejects admin mutations after elevation expires without rejecting membership', async () => {
      await import('../supabase/functions/domain-mutation/index.ts');
      const result = await handler(new Request('https://example.test/domain-mutation', {
        method: 'POST', body: JSON.stringify({ operation: 'save_manual_attendance' }),
      }));
      expect(await result.json()).toEqual({ message: 'Admin access is required' });
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it('still rejects revoked membership', async () => {
      grant.revoked_at = '2026-01-01T00:00:00Z';
      await import('../supabase/functions/domain-mutation/index.ts');
      const result = await handler(new Request('https://example.test/domain-mutation', {
        method: 'POST',
        body: JSON.stringify({ operation: 'save_doodle', payload: { year_month: '2026-11' } }),
      }));
      expect(await result.json()).toEqual({ message: 'Active app access is required' });
      expect(client.from).not.toHaveBeenCalledWith('audit_events');
    });
  });

  it('wakes the protected outbox dispatcher after every persisted notification', () => {
    const source = fs.readFileSync(mutationPath, 'utf8');

    expect(source).toContain("Deno.env.get('OUTBOX_DISPATCH_SECRET')");
    expect(source).toContain('/functions/v1/dispatch-outbox');
    expect(source).toContain("await triggerOutboxDispatch()");
  });
});
