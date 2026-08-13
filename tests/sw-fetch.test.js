/**
 * Service-worker network-first fetch strategy.
 *
 * Reliable updates require the SW to fetch from the *network bypassing the HTTP
 * disk cache* — otherwise dynamically-loaded modules (e.g. js/pages/settings.js)
 * can be served stale on devices that cannot force-reload (mobile PWAs).
 */
import { describe, it, expect, vi } from 'vitest';
import { networkFirst, shouldHandleRequest } from '../js/sw-fetch.js';

function makeCaches({ matchResults = [] } = {}) {
  const put = vi.fn();
  const open = vi.fn(async () => ({ put }));
  const match = vi.fn();
  matchResults.forEach(r => match.mockResolvedValueOnce(r));
  return { open, put, match };
}

describe('networkFirst', () => {
  it('fetches from the network bypassing the HTTP cache (cache: "reload")', async () => {
    const res = { clone: () => ({ tag: 'copy' }) };
    const fetchFn = vi.fn(async () => res);
    const caches = makeCaches();

    const out = await networkFirst('REQ', { fetch: fetchFn, caches, cacheName: 'mexicano-v51' });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe('REQ');
    expect(fetchFn.mock.calls[0][1]).toEqual({ cache: 'reload' });
    expect(out).toBe(res);
  });

  it('writes the fresh response into the versioned cache', async () => {
    const copy = { tag: 'copy' };
    const res = { clone: () => copy };
    const fetchFn = vi.fn(async () => res);
    const caches = makeCaches();

    await networkFirst('REQ', { fetch: fetchFn, caches, cacheName: 'mexicano-v51' });

    expect(caches.open).toHaveBeenCalledWith('mexicano-v51');
    expect(caches.put).toHaveBeenCalledWith('REQ', copy);
  });

  it('falls back to the cached response when the network fails', async () => {
    const cached = { tag: 'cached' };
    const fetchFn = vi.fn(async () => { throw new Error('offline'); });
    const caches = makeCaches({ matchResults: [cached] });

    const out = await networkFirst('REQ', { fetch: fetchFn, caches, cacheName: 'mexicano-v51' });

    expect(caches.match).toHaveBeenCalledWith('REQ');
    expect(out).toBe(cached);
  });

  it('falls back to the offline shell when nothing is cached for the request', async () => {
    const shell = { tag: 'index' };
    const fetchFn = vi.fn(async () => { throw new Error('offline'); });
    const caches = makeCaches({ matchResults: [null, shell] });

    const out = await networkFirst('REQ', {
      fetch: fetchFn, caches, cacheName: 'mexicano-v51', offlineFallback: './index.html',
    });

    expect(caches.match).toHaveBeenNthCalledWith(1, 'REQ');
    expect(caches.match).toHaveBeenNthCalledWith(2, './index.html');
    expect(out).toBe(shell);
  });
});

describe('shouldHandleRequest', () => {
  const ORIGIN = 'https://minoplay.github.io';

  it('handles same-origin GET app-asset requests', () => {
    const req = { method: 'GET', url: `${ORIGIN}/Mexicano_v3/js/pages/tournament.js` };
    expect(shouldHandleRequest(req, ORIGIN)).toBe(true);
  });

  it('does NOT handle cross-origin GitHub API requests (they must hit the network directly)', () => {
    // This is the mobile-PWA hang: the SW re-fetching an auth'd api.github.com
    // GET (without the page's AbortController) and caching the response.
    const req = { method: 'GET', url: 'https://api.github.com/repos/MinoPlay/DataHub_Mexicano/contents/x.json' };
    expect(shouldHandleRequest(req, ORIGIN)).toBe(false);
  });

  it('does NOT handle cross-origin Telegram/push requests', () => {
    const req = { method: 'GET', url: 'https://api.telegram.org/bot123/sendMessage' };
    expect(shouldHandleRequest(req, ORIGIN)).toBe(false);
  });

  it('does NOT handle non-GET requests', () => {
    const req = { method: 'PUT', url: `${ORIGIN}/Mexicano_v3/index.html` };
    expect(shouldHandleRequest(req, ORIGIN)).toBe(false);
  });
});
