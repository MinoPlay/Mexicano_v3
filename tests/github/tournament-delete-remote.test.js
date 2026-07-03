/**
 * Remote tournament deletion tests.
 * removeTournamentIndexEntry: drops a date from tournaments.json (PUT with filtered list).
 * deleteTournamentDayFile:   deletes the generated YYYY/YYYY-MM/YYYY-MM-DD.json file.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

let _cacheData = {};
vi.mock('../../js/cache.js', () => ({
  Cache: {
    get:  (key)        => _cacheData[key] ?? null,
    set:  (key, value) => { _cacheData[key] = value; },
    has:  (key)        => _cacheData[key] != null,
    del:  (key)        => { delete _cacheData[key]; },
    keys: (prefix = '') => Object.keys(_cacheData).filter(k => k.startsWith(prefix)),
  },
}));

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

import { removeTournamentIndexEntry, deleteTournamentDayFile } from '../../js/services/github.js';
import { Store } from '../../js/store.js';

const DATE = '2026-05-12';
const OTHER = '2026-05-05';
const BASE_PATH = 'mexicano_v3/backup-data';
const GH_CONFIG = { owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'test-pat', basePath: BASE_PATH };

function ghB64(obj) { return btoa(JSON.stringify(obj)); }
function ghOk(obj, sha = 'sha-index') {
  return { status: 200, ok: true, json: () => Promise.resolve({ content: ghB64(obj), sha }) };
}
function gh404() { return { status: 404, ok: false, json: () => Promise.resolve({}) }; }

beforeEach(() => {
  ls.clear();
  _cacheData = {};
  Store.setGitHubConfig(GH_CONFIG);
});
afterEach(() => { vi.unstubAllGlobals(); vi.stubGlobal('localStorage', ls); });

describe('removeTournamentIndexEntry', () => {
  it('writes tournaments.json without the deleted date', async () => {
    let putBody = null;
    const fetchStub = vi.fn(async (url, opts) => {
      if (url.includes('/tournaments.json') && (!opts || opts.method === undefined || opts.method === 'GET')) {
        return ghOk([{ date: DATE, isComplete: false }, { date: OTHER, isComplete: true }]);
      }
      if (url.includes('/tournaments.json') && opts?.method === 'PUT') {
        putBody = JSON.parse(opts.body);
        return { status: 200, ok: true, json: () => Promise.resolve({ content: {}, sha: 'new' }) };
      }
      return gh404();
    });
    vi.stubGlobal('fetch', fetchStub);

    await removeTournamentIndexEntry(DATE);

    const written = JSON.parse(decodeURIComponent(escape(atob(putBody.content))));
    expect(written.map(e => e.date)).toEqual([OTHER]);
    expect(Store.getTournamentsIndex().map(e => e.date)).toEqual([OTHER]);
  });
});

describe('deleteTournamentDayFile', () => {
  it('DELETEs the date file at YYYY/YYYY-MM/YYYY-MM-DD.json using its sha', async () => {
    let deletedPath = null;
    let deletedSha = null;
    const fetchStub = vi.fn(async (url, opts) => {
      if (url.includes(`/${DATE}.json`) && (!opts || opts.method === undefined || opts.method === 'GET')) {
        return ghOk({ match_date: DATE }, 'sha-day');
      }
      if (url.includes(`/${DATE}.json`) && opts?.method === 'DELETE') {
        deletedPath = url;
        deletedSha = JSON.parse(opts.body).sha;
        return { status: 200, ok: true, json: () => Promise.resolve({}) };
      }
      return gh404();
    });
    vi.stubGlobal('fetch', fetchStub);

    await deleteTournamentDayFile(DATE);

    expect(deletedPath).toContain(`/2026/2026-05/${DATE}.json`);
    expect(deletedSha).toBe('sha-day');
  });

  it('is a no-op when the date file does not exist (404)', async () => {
    const fetchStub = vi.fn(async () => gh404());
    vi.stubGlobal('fetch', fetchStub);

    await expect(deleteTournamentDayFile(DATE)).resolves.toBeUndefined();
  });
});
