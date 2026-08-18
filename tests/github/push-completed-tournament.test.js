/**
 * pushCompletedTournament — queue-free completion write.
 *
 * Ending a tournament must touch exactly two remote files: the tournament's day
 * file and tournaments.json. It must not go through the debounced pushAll()
 * queue (which rewrites every synced file and waits for unrelated in-flight
 * pushes) — that wait was part of the "End Tournament hangs" bug.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

function makeLocalStorage() {
  let store = {};
  return {
    getItem: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}
const ls = makeLocalStorage();
vi.stubGlobal('localStorage', ls);

import { pushCompletedTournament } from '../../js/services/github.js';
import { Store } from '../../js/store.js';

const GH_CONFIG = {
  owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'test-pat',
  basePath: 'mexicano_v3/backup-data',
};

const DATE = '2025-06-08';
const DAY_PATH = 'mexicano_v3/backup-data/2025/2025-06/2025-06-08.json';
const INDEX_PATH = 'mexicano_v3/backup-data/tournaments.json';

const INDEX_ENTRY = {
  date: DATE, playerCount: 4, roundCount: 1,
  matchCount: 1, completedCount: 1, isComplete: true,
};

const MATCHES = [{
  date: DATE, roundNumber: 1,
  team1Player1Name: 'Alice', team1Player2Name: 'Bob',
  team2Player1Name: 'Carol', team2Player2Name: 'Dave',
  scoreTeam1: 15, scoreTeam2: 10,
  team1Player1Elo: 1016, team1Player2Elo: 1016,
  team2Player1Elo: 984, team2Player2Elo: 984,
}];

function jsonResponse(body, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function b64(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}

beforeEach(() => {
  ls.clear();
  Store.setGitHubConfig(GH_CONFIG);
});
afterEach(() => vi.restoreAllMocks());

describe('pushCompletedTournament', () => {
  it('writes only the day file and tournaments.json, day file first', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      calls.push(`${opts.method || 'GET'} ${String(url).split('/contents/')[1]}`);
      if ((opts.method || 'GET') === 'GET') {
        const body = String(url).includes('tournaments.json')
          ? { content: b64([]), sha: 'idx-sha' }
          : { content: b64({ match_date: DATE }), sha: 'day-sha' };
        return jsonResponse(body);
      }
      return jsonResponse({ content: {} }, 200);
    }));

    await pushCompletedTournament(DATE, MATCHES, INDEX_ENTRY);

    const writes = calls.filter(c => c.startsWith('PUT'));
    expect(writes).toEqual([`PUT ${DAY_PATH}`, `PUT ${INDEX_PATH}`]);
  });

  it('serialises the day-file write before the index write', async () => {
    const order = [];
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const path = String(url).split('/contents/')[1];
      if ((opts.method || 'GET') === 'PUT') order.push(path);
      if ((opts.method || 'GET') === 'GET') {
        return jsonResponse(String(url).includes('tournaments.json')
          ? { content: b64([]), sha: 'idx-sha' }
          : { content: b64({ match_date: DATE }), sha: 'day-sha' });
      }
      return jsonResponse({}, 200);
    }));

    await pushCompletedTournament(DATE, MATCHES, INDEX_ENTRY);
    expect(order.indexOf(DAY_PATH)).toBeLessThan(order.indexOf(INDEX_PATH));
  });

  it('reports push and index steps', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'GET') {
        return jsonResponse(String(url).includes('tournaments.json')
          ? { content: b64([]), sha: 'idx-sha' }
          : { content: b64({ match_date: DATE }), sha: 'day-sha' });
      }
      return jsonResponse({}, 200);
    }));

    const steps = [];
    await pushCompletedTournament(DATE, MATCHES, INDEX_ENTRY, {
      onStep: (id, status) => steps.push(`${id}:${status}`),
    });

    expect(steps).toContain('push:running');
    expect(steps).toContain('push:success');
    expect(steps).toContain('index:running');
    expect(steps).toContain('index:success');
  });

  it('rejects and reports an error when the index write fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      const isIndex = String(url).includes('tournaments.json');
      if ((opts.method || 'GET') === 'GET') {
        return jsonResponse(isIndex ? { content: b64([]), sha: 'idx-sha' }
          : { content: b64({ match_date: DATE }), sha: 'day-sha' });
      }
      if (isIndex) return jsonResponse({ message: 'boom' }, 500);
      return jsonResponse({}, 200);
    }));

    const steps = [];
    await expect(pushCompletedTournament(DATE, MATCHES, INDEX_ENTRY, {
      onStep: (id, status) => steps.push(`${id}:${status}`),
    })).rejects.toThrow();

    expect(steps).toContain('push:success');
    expect(steps).toContain('index:error');
  });

  it('writes the day file in backup format with embedded ELO', async () => {
    let written;
    vi.stubGlobal('fetch', vi.fn(async (url, opts = {}) => {
      if ((opts.method || 'GET') === 'GET') {
        return jsonResponse(String(url).includes('tournaments.json')
          ? { content: b64([]), sha: 'idx-sha' }
          : { content: b64({ match_date: DATE }), sha: 'day-sha' });
      }
      if (String(url).includes('2025-06-08.json')) {
        written = JSON.parse(decodeURIComponent(escape(atob(JSON.parse(opts.body).content))));
      }
      return jsonResponse({}, 200);
    }));

    await pushCompletedTournament(DATE, MATCHES, INDEX_ENTRY);

    expect(written.match_date).toBe(DATE);
    expect(written.match_count).toBe(1);
    expect(written.matches[0].Team1Player1Elo).toBe(1016);
    expect(written.tournament).toBeUndefined();
  });
});
