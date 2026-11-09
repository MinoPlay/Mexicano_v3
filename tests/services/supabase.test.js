import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  describe('Supabase session persistence', () => {
    const savedSession = {
      access_token: 'old-token',
      refresh_token: 'old-refresh',
      expires_at: 1,
      user: { id: 'user-1' },
    };
    const renewedSession = {
      access_token: 'new-token',
      refresh_token: 'new-refresh',
      expires_at: 9999999999,
      user: { id: 'user-1' },
    };
    const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

    beforeEach(() => {
      localStorage.clear();
      Store.setSupabaseConfig({ url: 'https://example.supabase.co', anonKey: 'public-key' });
      Store.setSupabaseSession(savedSession);
      Store.setAccessGrant({ role: 'member', expires_at: 'infinity' });
      Store.setCurrentPlayerId('player-1');
      Store.setCurrentUser('Mattijs');
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it.each([429, 503, 409])('preserves login after refresh HTTP %s and retries later', async (status) => {
      const supabase = await loadSupabaseModule();
      const error = status === 429
        ? { code: 429, error_code: 'over_request_rate_limit', msg: 'Try again later' }
        : { message: 'Try again later' };
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(response(error, status))
        .mockResolvedValueOnce(response(renewedSession)));

      await expect(supabase.ensureAnonymousSession()).rejects.toThrow('Try again later');
      expect(Store.getSupabaseSession()).toEqual(savedSession);
      expect(Store.getAccessRole()).toBe('member');
      expect(Store.getCurrentPlayerId()).toBe('player-1');
      await expect(supabase.ensureAnonymousSession()).resolves.toEqual(renewedSession);
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
        'https://example.supabase.co/auth/v1/token?grant_type=refresh_token',
      ]);
    });

    it('keeps the identity after a network failure during refresh', async () => {
      const supabase = await loadSupabaseModule();
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      await expect(supabase.ensureAnonymousSession()).rejects.toThrow('Failed to fetch');
      expect(Store.getSupabaseSession()).toEqual(savedSession);
      expect(Store.getCurrentPlayerId()).toBe('player-1');
    });

    it.each([
      { code: 'refresh_token_not_found', message: 'Refresh token not found' },
      { code: 400, error_code: 'refresh_token_not_found', msg: 'Refresh token not found' },
    ])('surfaces a revoked refresh token without silently signing up another user (%#)', async (error) => {
      const supabase = await loadSupabaseModule();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(error, 400)));

      await expect(supabase.ensureAnonymousSession()).rejects.toThrow(/sign in again/i);
      expect(Store.getSupabaseSession()).toBeNull();
      expect(Store.getAccessRole()).toBe('');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('does not replace an expired identity whose refresh token is missing', async () => {
      const supabase = await loadSupabaseModule();
      Store.setSupabaseSession({ ...savedSession, refresh_token: '' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(renewedSession)));

      await expect(supabase.ensureAnonymousSession()).rejects.toThrow(/sign in again/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('shares one refresh between concurrent 401 retries', async () => {
      const supabase = await loadSupabaseModule();
      Store.setSupabaseSession({ ...savedSession, expires_at: 9999999999 });
      vi.stubGlobal('fetch', vi.fn(async (url, options) => {
        if (url.includes('/auth/v1/token')) return response(renewedSession);
        if (options.headers.Authorization === 'Bearer old-token') return response({}, 401);
        return response([{ id: 'player-1' }]);
      }));

      const results = await Promise.all([supabase.listPlayers(), supabase.listPlayers()]);
      expect(results).toEqual([[{ id: 'player-1' }], [{ id: 'player-1' }]]);
      expect(fetch.mock.calls.filter(([url]) => url.includes('/auth/v1/token'))).toHaveLength(1);
      expect(Store.getSupabaseSession()).toEqual(renewedSession);
    });

    it('reuses the renewed token when an older request returns 401 late', async () => {
      const supabase = await loadSupabaseModule();
      Store.setSupabaseSession({ ...savedSession, expires_at: 9999999999 });
      let rejectOldRequest;
      let oldRequests = 0;
      vi.stubGlobal('fetch', vi.fn(async (url, options) => {
        if (url.includes('/auth/v1/token')) return response(renewedSession);
        if (options.headers.Authorization === 'Bearer old-token') {
          oldRequests += 1;
          if (oldRequests === 2) {
            return new Promise(resolve => { rejectOldRequest = () => resolve(response({}, 401)); });
          }
          return response({}, 401);
        }
        return response([]);
      }));

      const first = supabase.listPlayers();
      const second = supabase.listPlayers();
      await first;
      rejectOldRequest();
      await second;
      expect(fetch.mock.calls.filter(([url]) => url.includes('/auth/v1/token'))).toHaveLength(1);
    });

    it('serializes refreshes across tabs and rereads the shared saved session', async () => {
      const firstTab = await loadSupabaseModule();
      vi.resetModules();
      const secondTab = await loadSupabaseModule();
      let queue = Promise.resolve();
      const request = vi.fn((_name, callback) => {
        const result = queue.then(callback);
        queue = result.catch(() => {});
        return result;
      });
      vi.stubGlobal('navigator', { locks: { request } });
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response(renewedSession)));

      await expect(Promise.all([
        firstTab.ensureAnonymousSession(), secondTab.ensureAnonymousSession(),
      ])).resolves.toEqual([renewedSession, renewedSession]);
      expect(request).toHaveBeenCalledTimes(2);
      expect(request.mock.calls[0][0]).toBe(request.mock.calls[1][0]);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('does not resurrect a session when logout happens during refresh', async () => {
      const supabase = await loadSupabaseModule();
      let finish;
      vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve; })));
      const refresh = supabase.ensureAnonymousSession();
      const rejected = expect(refresh).rejects.toThrow(/session changed/i);
      Store.clearSupabaseSession();
      finish(response(renewedSession));
      await rejected;
      expect(Store.getSupabaseSession()).toBeNull();
    });

    it('does not erase a newer login while reading a failed refresh response', async () => {
      const supabase = await loadSupabaseModule();
      let finish;
      let reading;
      const started = new Promise(resolve => { reading = resolve; });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false, status: 400,
        json: () => {
          reading();
          return new Promise(resolve => { finish = resolve; });
        },
      }));
      const rejected = expect(supabase.ensureAnonymousSession()).rejects.toThrow(/session changed/i);
      await started;
      Store.setSupabaseSession(renewedSession);
      finish({ code: 'refresh_token_not_found', message: 'Refresh token not found' });
      await rejected;
      expect(Store.getSupabaseSession()).toEqual(renewedSession);
    });

    it('does not sign up another user when a request returns 401 after logout', async () => {
      const supabase = await loadSupabaseModule();
      Store.setSupabaseSession({ ...savedSession, expires_at: 9999999999 });
      let finish;
      let requested;
      const started = new Promise(resolve => { requested = resolve; });
      vi.stubGlobal('fetch', vi.fn()
        .mockImplementationOnce(() => {
          requested();
          return new Promise(resolve => { finish = resolve; });
        })
        .mockImplementation(async () => response(renewedSession)));
      const rejected = expect(supabase.listPlayers()).rejects.toThrow(/session changed/i);
      await started;
      Store.clearSupabaseSession();
      finish(response({}, 401));
      await rejected;
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(Store.getSupabaseSession()).toBeNull();
    });

    it('refreshes before restoring the access grant and accepts expired admin elevation as membership', async () => {
      const supabase = await loadSupabaseModule();
      vi.stubGlobal('fetch', vi.fn(async (url) => url.includes('/auth/v1/token')
        ? response(renewedSession)
        : response([{
          role: 'admin', expires_at: '2020-01-01T00:00:00Z', revoked_at: null,
        }])));

      await supabase.syncAccessGrant();

      expect(fetch.mock.calls[0][0]).toContain('/auth/v1/token?grant_type=refresh_token');
      expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer new-token');
      expect(Store.getAccessRole()).toBe('member');
      expect(Store.getSupabaseSession().user.id).toBe('user-1');
    });

    it('still clears access when the server reports a revoked grant', async () => {
      const supabase = await loadSupabaseModule();
      Store.setSupabaseSession(renewedSession);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([{
        role: 'member', expires_at: 'infinity', revoked_at: '2026-01-01T00:00:00Z',
      }])));
      await expect(supabase.syncAccessGrant()).rejects.toThrow(/active Mexicano access/);
      expect(Store.getSupabaseSession()).toBeNull();
    });
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

  it('requests a magic link without creating unknown users', async () => {
    Store.setSupabaseConfig({
      url: 'https://example.supabase.co',
      anonKey: 'public-anon-key',
    });
    const supabase = await loadSupabaseModule();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }));

    await supabase.sendMagicLink(
      'approved@example.com',
      'https://minoplay.github.io/Mexicano_v3/preview/test/',
    );

    expect(fetch).toHaveBeenCalledWith(
      'https://example.supabase.co/auth/v1/otp'
        + '?redirect_to=https%3A%2F%2Fminoplay.github.io%2FMexicano_v3%2Fpreview%2Ftest%2F',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'approved@example.com',
          create_user: false,
        }),
      }),
    );
  });

  it('captures a magic-link callback session before hash routing', async () => {
    const supabase = await loadSupabaseModule();
    window.history.replaceState(
      null,
      '',
      '/Mexicano_v3/preview/test/#access_token=magic-token'
        + '&refresh_token=magic-refresh&expires_in=3600&token_type=bearer&type=magiclink',
    );

    const captured = supabase.captureAuthSessionFromUrl();

    expect(captured).toBe(true);
    expect(Store.getSupabaseSession()).toEqual(expect.objectContaining({
      access_token: 'magic-token',
      refresh_token: 'magic-refresh',
      token_type: 'bearer',
    }));
    expect(window.location.hash).toBe('#/');
  });
});
