/**
 * Telegram + Web Push relay dispatch must not hang.
 *
 * Both relays POST to api.github.com/dispatches with a bare fetch(). On a
 * stalled connection that promise never settles, so the End Tournament dialog
 * sat on "Working…" forever. They must use the shared timed fetch instead.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

function makeLocalStorage() {
  let store = {};
  return {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}
const ls = makeLocalStorage();
vi.stubGlobal('localStorage', ls);

import { sendTournamentCompletedAlert } from '../../js/services/telegram.js';
import { sendPushNotification } from '../../js/services/push.js';
import { Store } from '../../js/store.js';

const GH_CONFIG = {
  owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'test-pat',
  basePath: 'mexicano_v3/backup-data',
};

const TOURNAMENT = {
  tournamentDate: '2025-06-08',
  players: [{ name: 'Alice', totalPoints: 21, rank: 1 }],
};

beforeEach(() => {
  ls.clear();
  Store.setGitHubConfig(GH_CONFIG);
  Store.setCurrentUser('mino');
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('relay dispatch timeouts', () => {
  it('telegram alert rejects instead of hanging on a stalled connection', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    const p = sendTournamentCompletedAlert(TOURNAMENT);
    const assertion = expect(p).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(60000);
    await assertion;
  });

  it('web push relay rejects instead of hanging on a stalled connection', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    const p = sendPushNotification('t', 'b');
    const assertion = expect(p).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(60000);
    await assertion;
  });

  it('telegram alert aborts the first attempt after 3s and retries', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      calls++;
      if (calls === 1) return new Promise(() => {});
      return Promise.resolve({ status: 204, ok: true });
    }));

    const p = sendTournamentCompletedAlert(TOURNAMENT);
    await vi.advanceTimersByTimeAsync(4000);
    await expect(p).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});
