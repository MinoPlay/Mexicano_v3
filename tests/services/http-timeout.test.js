/**
 * Shared timed-fetch helper tests.
 *
 * Part of the "End Tournament hangs" fix: every network call in the completion
 * flow (GitHub Contents API, Telegram relay dispatch, Web Push relay dispatch)
 * must fail fast instead of waiting forever on a stalled connection.
 *
 * Contract:
 *   • fetchWithTimeout(url, opts, timeoutMs) aborts + rejects after timeoutMs.
 *   • fetchWithRetry(url, opts, { timeouts }) retries with an escalating
 *     timeout ladder (3s → 6s → 12s) and resolves as soon as one attempt lands.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout, fetchWithRetry, FAST_TIMEOUTS, BACKGROUND_TIMEOUTS } from '../../js/services/http.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('fetchWithTimeout', () => {
  it('rejects with a timeout error when the network never responds', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    const p = fetchWithTimeout('https://api.github.com/x', {}, 3000);
    const assertion = expect(p).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it('aborts the underlying request on timeout', async () => {
    let signal;
    vi.stubGlobal('fetch', vi.fn((_url, opts) => {
      signal = opts.signal;
      return new Promise(() => {});
    }));

    const p = fetchWithTimeout('https://api.github.com/x', {}, 3000);
    const assertion = expect(p).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;

    expect(signal.aborted).toBe(true);
  });

  it('resolves normally when the response arrives in time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));

    const res = await fetchWithTimeout('https://api.github.com/x', {}, 3000);
    expect(res.status).toBe(200);
  });
});

describe('fetchWithRetry', () => {
  it('uses a short escalating ladder that never exceeds 5s in total', () => {
    expect(FAST_TIMEOUTS).toEqual([2000, 3000]);
    expect(FAST_TIMEOUTS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(5000);
  });

  it('never waits more than 5s on a single background attempt', () => {
    expect(Math.max(...BACKGROUND_TIMEOUTS)).toBeLessThanOrEqual(5000);
  });

  it('retries a stalled attempt and resolves when a later attempt lands', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      call++;
      if (call === 1) return new Promise(() => {}); // stalls → times out at 3s
      return Promise.resolve({ ok: true, status: 201 });
    }));

    const p = fetchWithRetry('https://api.github.com/x', {}, { timeouts: FAST_TIMEOUTS });
    await vi.advanceTimersByTimeAsync(3000);

    const res = await p;
    expect(res.status).toBe(201);
    expect(call).toBe(2);
  });

  it('rejects after the whole ladder is exhausted', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    const p = fetchWithRetry('https://api.github.com/x', {}, { timeouts: FAST_TIMEOUTS });
    const assertion = expect(p).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(2000 + 3000 + 1000);
    await assertion;
  });

  it('does not retry a request that responded (even with an error status)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 409 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchWithRetry('https://api.github.com/x', {}, { timeouts: FAST_TIMEOUTS });
    expect(res.status).toBe(409);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
