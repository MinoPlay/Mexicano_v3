import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../../js/store.js';

async function loadSupabaseModule() {
  const specifier = '../../js/services/' + 'supabase.js';
  return import(specifier).catch(() => null);
}

describe('Supabase browser access', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('stores only public project config and session data, never the access code', async () => {
    expect(typeof Store.setSupabaseConfig).toBe('function');
    Store.setSupabaseConfig({
      url: 'https://example.supabase.co',
      anonKey: 'public-anon-key',
    });
    Store.setSupabaseSession({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: 9999999999,
      user: { id: 'user-1' },
    });

    const supabase = await loadSupabaseModule();
    expect(supabase).not.toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ role: 'member', expires_at: '2099-01-01T00:00:00Z' }),
    }));

    await supabase.claimAccess('shared-secret');

    expect(Store.getSupabaseConfig()).toEqual({
      url: 'https://example.supabase.co',
      anonKey: 'public-anon-key',
    });
    expect(Store.getAccessRole()).toBe('member');
    expect(JSON.stringify(Store.exportAll())).not.toContain('shared-secret');
    expect(fetch).toHaveBeenCalledWith(
      'https://example.supabase.co/functions/v1/claim-access',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ code: 'shared-secret' }),
      }),
    );
  });

  it('binds the selected player through an authenticated RPC', async () => {
    Store.setSupabaseConfig({
      url: 'https://example.supabase.co',
      anonKey: 'public-anon-key',
    });
    Store.setSupabaseSession({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: 9999999999,
      user: { id: 'user-1' },
    });
    const supabase = await loadSupabaseModule();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '' }));

    await supabase.bindCurrentPlayer('player-1', 'Mattijs');

    expect(Store.getCurrentUser()).toBe('Mattijs');
    expect(Store.getCurrentPlayerId()).toBe('player-1');
    expect(fetch).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/bind_current_player',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ p_player_id: 'player-1' }),
      }),
    );
  });
});
