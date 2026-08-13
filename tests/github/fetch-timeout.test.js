/**
 * Fetch timeout tests.
 *
 * Repro for: "when completing a tournament the status window hangs and nothing
 * happens." Root cause is that GitHub Contents API calls used a raw `fetch`
 * with no timeout, so a stalled connection (typical on mobile) leaves the push
 * — and therefore the completion progress dialog — waiting forever.
 *
 * These tests assert that GitHub requests reject after a bounded timeout
 * instead of hanging indefinitely.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── In-memory localStorage stub ─────────────────────────────────────────────

function makeLocalStorage() {
  let _store = {};
  return {
    getItem:    (key)        => Object.prototype.hasOwnProperty.call(_store, key) ? _store[key] : null,
    setItem:    (key, value) => { _store[key] = String(value); },
    removeItem: (key)        => { delete _store[key]; },
    clear:      ()           => { _store = {}; },
    get length()              { return Object.keys(_store).length; },
    key:        (i)          => Object.keys(_store)[i] ?? null,
  };
}

const ls = makeLocalStorage();
vi.stubGlobal('localStorage', ls);

// ─── Imports (after stubs) ────────────────────────────────────────────────────

import { readFile, writeFile } from '../../js/services/github.js';
import { Store } from '../../js/store.js';

const GH_CONFIG = {
  owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'test-pat',
  basePath: 'mexicano_v3/backup-data',
};

beforeEach(() => {
  ls.clear();
  Store.setGitHubConfig(GH_CONFIG);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('GitHub fetch timeout', () => {
  it('readFile rejects (does not hang) when the network never responds', async () => {
    // fetch that never settles — simulates a stalled mobile connection.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    const p = readFile('mexicano_v3/backup-data/data/attendance_manual.json');
    const assertion = expect(p).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(60000);
    await assertion;
  });

  it('writeFile rejects (does not hang) when the network never responds', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));

    const p = writeFile('mexicano_v3/backup-data/data/attendance_manual.json', { a: 1 });
    const assertion = expect(p).rejects.toThrow(/timed out/i);

    await vi.advanceTimersByTimeAsync(60000);
    await assertion;
  });
});
