/**
 * Tests: stale active_tournament + matches cleanup in pullForRoute.
 *
 * When active_tournament.json returns 404 from GitHub, the pull functions must:
 *   1. Remove mexicano_active_tournament from localStorage
 *   2. Purge mexicano_matches entries for that tournament date
 *      (so tournament page re-fetches complete data instead of using partial cache)
 *
 * Covered routes: / (pullHomeData), /tournaments (pullTournamentsPage),
 *                 /tournament/:date (pullCoreData)
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ─── Mock Cache (inject clear helper) ────────────────────────────────────────

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

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { pullForRoute } from '../../js/services/github.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const STALE_DATE  = '2026-05-12';
const OTHER_DATE  = '2026-05-05';
const BASE_PATH   = 'mexicano_v3/backup-data';
const GH_CONFIG   = {
  owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'test-pat', basePath: BASE_PATH,
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function staleActiveTournament(overrides = {}) {
  return {
    id: 'stale-uuid',
    tournamentDate: STALE_DATE,
    players: [{ id: 1, name: 'Alice' }],
    rounds: [{ roundNumber: 1, matches: [], completedAt: null }],
    currentRoundNumber: 1,
    isStarted: true,
    isCompleted: false,
    startedAt: 1000,
    completedAt: null,
    ...overrides,
  };
}

function mixedMatches() {
  // Some matches for the stale date, some for another date that must be preserved
  return [
    {
      date: STALE_DATE, roundNumber: 1,
      team1Player1Name: 'Alice', team1Player2Name: 'Bob',
      team2Player1Name: 'Carol', team2Player2Name: 'Dave',
      scoreTeam1: 15, scoreTeam2: 10,
    },
    {
      date: OTHER_DATE, roundNumber: 1,
      team1Player1Name: 'Alice', team1Player2Name: 'Bob',
      team2Player1Name: 'Carol', team2Player2Name: 'Dave',
      scoreTeam1: 13, scoreTeam2: 12,
    },
  ];
}

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

/** Encode a JS value as the base64 content string GitHub returns. */
function ghB64(obj) {
  return btoa(JSON.stringify(obj));
}

function ghOk(obj, sha = 'sha1') {
  return { status: 200, ok: true, json: () => Promise.resolve({ content: ghB64(obj), sha }) };
}

function gh404() {
  return { status: 404, ok: false, json: () => Promise.resolve({}) };
}

/**
 * Build a fetch stub.
 * @param {{ activeTournament?: object|null }} opts
 *   activeTournament: the object to return for active_tournament.json, or null for 404.
 */
function makeFetch({ activeTournament = null } = {}) {
  return vi.fn(async (url) => {
    if (url.includes('/active_tournament.json')) {
      return activeTournament !== null ? ghOk(activeTournament) : gh404();
    }
    if (url.includes('/players.json')) {
      return ghOk([{ Id: 1, Name: 'Alice', ELO: 1000, PreviousELO: 990,
                     Wins: 5, Losses: 2, TotalPoints: 50, Average: 10, Tournaments: 3 }]);
    }
    if (url.includes('/tournaments.json')) {
      return ghOk([
        { date: STALE_DATE, playerCount: 4, roundCount: 1, matchCount: 1,
          completedCount: 0, isComplete: false },
      ]);
    }
    // players_overview, match day files, elo_history — not relevant here
    return gh404();
  });
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function seedStale() {
  ls.setItem('mexicano_active_tournament', JSON.stringify(staleActiveTournament()));
  ls.setItem('mexicano_matches', JSON.stringify(mixedMatches()));
}

// ─── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  ls.clear();
  _cacheData = {};
  ls.setItem('mexicano_github_config', JSON.stringify(GH_CONFIG));
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Re-stub localStorage after unstubAllGlobals removes our stub
  vi.stubGlobal('localStorage', ls);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pullForRoute — active_tournament.json 404 clears localStorage', () => {

  // ── Home page (/): pullHomeData ──────────────────────────────────────────────

  describe('route: / (pullHomeData)', () => {
    it('removes active_tournament when remote 404', async () => {
      seedStale();
      vi.stubGlobal('fetch', makeFetch());
      await pullForRoute('#/');
      expect(ls.getItem('mexicano_active_tournament')).toBeNull();
    });

    it('purges stale matches for the tournament date', async () => {
      seedStale();
      vi.stubGlobal('fetch', makeFetch());
      await pullForRoute('#/');
      const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
      expect(matches.some(m => m.date === STALE_DATE)).toBe(false);
    });

    it('preserves matches for other dates', async () => {
      seedStale();
      vi.stubGlobal('fetch', makeFetch());
      await pullForRoute('#/');
      const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
      expect(matches.some(m => m.date === OTHER_DATE)).toBe(true);
    });

    it('keeps active_tournament when remote returns valid in-progress tournament', async () => {
      seedStale();
      const live = staleActiveTournament({ isCompleted: false });
      vi.stubGlobal('fetch', makeFetch({ activeTournament: live }));
      await pullForRoute('#/');
      expect(ls.getItem('mexicano_active_tournament')).not.toBeNull();
    });

    it('does not purge matches when remote returns valid in-progress tournament', async () => {
      seedStale();
      const live = staleActiveTournament({ isCompleted: false });
      vi.stubGlobal('fetch', makeFetch({ activeTournament: live }));
      await pullForRoute('#/');
      const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
      expect(matches.some(m => m.date === STALE_DATE)).toBe(true);
    });

    it('removes active_tournament when remote returns a completed tournament', async () => {
      seedStale();
      const completed = staleActiveTournament({ isCompleted: true });
      vi.stubGlobal('fetch', makeFetch({ activeTournament: completed }));
      await pullForRoute('#/');
      expect(ls.getItem('mexicano_active_tournament')).toBeNull();
    });

    it('does not purge matches when local active_tournament is already completed', async () => {
      // Local is already completed → no stale partial-match purge needed
      ls.setItem('mexicano_active_tournament', JSON.stringify(staleActiveTournament({ isCompleted: true })));
      ls.setItem('mexicano_matches', JSON.stringify(mixedMatches()));
      vi.stubGlobal('fetch', makeFetch());
      await pullForRoute('#/');
      expect(ls.getItem('mexicano_active_tournament')).toBeNull();
      const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
      expect(matches.some(m => m.date === STALE_DATE)).toBe(true);
    });

    it('does nothing to matches when no local active_tournament exists', async () => {
      ls.setItem('mexicano_matches', JSON.stringify(mixedMatches()));
      vi.stubGlobal('fetch', makeFetch());
      await pullForRoute('#/');
      const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
      expect(matches.some(m => m.date === STALE_DATE)).toBe(true);
      expect(matches.some(m => m.date === OTHER_DATE)).toBe(true);
    });
  });

  // ── Tournaments list (/tournaments): pullTournamentsPage ─────────────────────

  describe('route: /tournaments (pullTournamentsPage)', () => {
    it('removes active_tournament when remote 404', async () => {
      seedStale();
      vi.stubGlobal('fetch', makeFetch());
      await pullForRoute('#/tournaments');
      expect(ls.getItem('mexicano_active_tournament')).toBeNull();
    });

    it('purges stale matches for the tournament date', async () => {
      seedStale();
      vi.stubGlobal('fetch', makeFetch());
      await pullForRoute('#/tournaments');
      const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
      expect(matches.some(m => m.date === STALE_DATE)).toBe(false);
    });

    it('preserves matches for other dates', async () => {
      seedStale();
      vi.stubGlobal('fetch', makeFetch());
      await pullForRoute('#/tournaments');
      const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
      expect(matches.some(m => m.date === OTHER_DATE)).toBe(true);
    });

    it('keeps active_tournament when remote returns valid in-progress tournament', async () => {
      seedStale();
      const live = staleActiveTournament({ isCompleted: false });
      vi.stubGlobal('fetch', makeFetch({ activeTournament: live }));
      await pullForRoute('#/tournaments');
      expect(ls.getItem('mexicano_active_tournament')).not.toBeNull();
    });
  });

  // ── Tournament detail (/tournament/:date): pullCoreData ──────────────────────

  describe('route: /tournament/:date (pullCoreData)', () => {
    it('removes active_tournament when remote 404', async () => {
      seedStale();
      vi.stubGlobal('fetch', makeFetch());
      await pullForRoute(`#/tournament/${STALE_DATE}`);
      expect(ls.getItem('mexicano_active_tournament')).toBeNull();
    });

    it('purges stale matches for the tournament date', async () => {
      seedStale();
      vi.stubGlobal('fetch', makeFetch());
      await pullForRoute(`#/tournament/${STALE_DATE}`);
      const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
      expect(matches.some(m => m.date === STALE_DATE)).toBe(false);
    });

    it('preserves matches for other dates', async () => {
      seedStale();
      vi.stubGlobal('fetch', makeFetch());
      await pullForRoute(`#/tournament/${STALE_DATE}`);
      const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
      expect(matches.some(m => m.date === OTHER_DATE)).toBe(true);
    });

    it('keeps active_tournament when remote returns valid in-progress tournament', async () => {
      seedStale();
      const live = staleActiveTournament({ isCompleted: false });
      vi.stubGlobal('fetch', makeFetch({ activeTournament: live }));
      await pullForRoute(`#/tournament/${STALE_DATE}`);
      expect(ls.getItem('mexicano_active_tournament')).not.toBeNull();
    });
  });
});
