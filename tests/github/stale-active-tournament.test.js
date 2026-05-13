/**
 * Tests: active tournament state resolved from the date file in pullForRoute.
 *
 * Active tournament state is now embedded in the date file (YYYY-MM-DD.json)
 * under a `tournament` field instead of a separate data/active_tournament.json.
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

function inProgressTournament(overrides = {}) {
  return {
    id: 'test-uuid',
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
 * Build a fetch stub for the new architecture.
 *
 * @param {object|'completed'|null} tournamentInDateFile
 *   object    → date file has { tournament: object } (in-progress)
 *   'completed' → date file has { matches: [...], match_count: 1 } (completed format)
 *   null      → date file returns 404 (push hasn't happened yet or never will)
 * @param {object|null} activeTournamentJson
 *   For backward-compat migration: what data/active_tournament.json returns (null = 404).
 * @param {boolean} indexComplete
 *   Whether tournaments.json marks STALE_DATE as isComplete:true (stale/corrupt index).
 */
function makeFetch({ tournamentInDateFile = null, activeTournamentJson = null, indexComplete = false } = {}) {
  return vi.fn(async (url) => {
    if (url.includes(`/${STALE_DATE}.json`)) {
      if (tournamentInDateFile === null) return gh404();
      if (tournamentInDateFile === 'completed') {
        return ghOk({
          backup_timestamp: '2026-05-12T00:00:00Z',
          match_date: STALE_DATE,
          match_count: 1,
          matches: [{ Team1Player1Name: 'Alice', Team1Player2Name: 'Bob',
                      Team2Player1Name: 'Carol', Team2Player2Name: 'Dave',
                      ScoreTeam1: 15, ScoreTeam2: 10, RoundNumber: 1 }],
        });
      }
      return ghOk({
        backup_timestamp: '2026-05-12T00:00:00Z',
        match_date: STALE_DATE,
        tournament: tournamentInDateFile,
      });
    }
    if (url.includes('/active_tournament.json')) {
      return activeTournamentJson !== null ? ghOk(activeTournamentJson) : gh404();
    }
    if (url.includes('/players.json')) {
      return ghOk([{ Id: 1, Name: 'Alice', ELO: 1000, PreviousELO: 990,
                     Wins: 5, Losses: 2, TotalPoints: 50, Average: 10, Tournaments: 3 }]);
    }
    if (url.includes('/tournaments.json')) {
      return ghOk([
        { date: STALE_DATE, playerCount: 4, roundCount: 1, matchCount: 1,
          completedCount: 0, isComplete: indexComplete },
      ]);
    }
    return gh404();
  });
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

function seedLocalActive() {
  ls.setItem('mexicano_active_tournament', JSON.stringify(inProgressTournament()));
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
  vi.stubGlobal('localStorage', ls);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pullForRoute — active tournament resolved from date file', () => {

  // Helper to run a test for all three routes
  const routes = [
    { label: '/ (pullHomeData)',             hash: '#/'                             },
    { label: '/tournaments (pullTournamentsPage)', hash: '#/tournaments'            },
    { label: `/tournament/:date (pullCoreData)`, hash: `#/tournament/${STALE_DATE}` },
  ];

  // ── Date file has in-progress tournament ─────────────────────────────────────

  describe('date file has in-progress tournament', () => {
    routes.forEach(({ label, hash }) => {
      it(`[${label}] keeps active_tournament and updates from date file`, async () => {
        seedLocalActive();
        const fresh = inProgressTournament({ currentRoundNumber: 3 });
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: fresh }));
        await pullForRoute(hash);
        const stored = JSON.parse(ls.getItem('mexicano_active_tournament'));
        expect(stored).not.toBeNull();
        expect(stored.currentRoundNumber).toBe(3);
      });

      it(`[${label}] preserves matches for both dates`, async () => {
        seedLocalActive();
        const fresh = inProgressTournament({ currentRoundNumber: 2 });
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: fresh }));
        await pullForRoute(hash);
        const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
        expect(matches.some(m => m.date === STALE_DATE)).toBe(true);
        expect(matches.some(m => m.date === OTHER_DATE)).toBe(true);
      });
    });
  });

  // ── Date file returns 404 (push hasn't happened yet) ─────────────────────────

  describe('date file returns 404 — keeps local state', () => {
    routes.forEach(({ label, hash }) => {
      it(`[${label}] preserves local in-progress active_tournament`, async () => {
        seedLocalActive();
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: null }));
        await pullForRoute(hash);
        expect(ls.getItem('mexicano_active_tournament')).not.toBeNull();
      });
    });
  });

  // ── Index marks complete + date file 404 → clear stale local state ───────────

  describe('index marks date complete, date file 404 — clears stale local state', () => {
    routes.forEach(({ label, hash }) => {
      it(`[${label}] clears stale active_tournament when index says complete`, async () => {
        seedLocalActive();
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: null, indexComplete: true }));
        await pullForRoute(hash);
        expect(ls.getItem('mexicano_active_tournament')).toBeNull();
      });

      it(`[${label}] purges stale matches for the tournament date`, async () => {
        seedLocalActive();
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: null, indexComplete: true }));
        await pullForRoute(hash);
        const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
        expect(matches.some(m => m.date === STALE_DATE)).toBe(false);
      });

      it(`[${label}] preserves matches for other dates`, async () => {
        seedLocalActive();
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: null, indexComplete: true }));
        await pullForRoute(hash);
        const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
        expect(matches.some(m => m.date === OTHER_DATE)).toBe(true);
      });
    });
  });

  // ── Date file shows completed format → clear local ────────────────────────────

  describe('date file shows completed tournament format', () => {
    routes.forEach(({ label, hash }) => {
      it(`[${label}] clears active_tournament when date file has matches array`, async () => {
        seedLocalActive();
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: 'completed' }));
        await pullForRoute(hash);
        expect(ls.getItem('mexicano_active_tournament')).toBeNull();
      });

      it(`[${label}] purges stale matches for the tournament date`, async () => {
        seedLocalActive();
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: 'completed' }));
        await pullForRoute(hash);
        const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
        expect(matches.some(m => m.date === STALE_DATE)).toBe(false);
      });

      it(`[${label}] preserves matches for other dates`, async () => {
        seedLocalActive();
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: 'completed' }));
        await pullForRoute(hash);
        const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
        expect(matches.some(m => m.date === OTHER_DATE)).toBe(true);
      });
    });
  });

  // ── Local active_tournament is already completed ──────────────────────────────

  describe('local active_tournament is completed', () => {
    routes.forEach(({ label, hash }) => {
      it(`[${label}] clears completed local active_tournament immediately`, async () => {
        ls.setItem('mexicano_active_tournament', JSON.stringify(inProgressTournament({ isCompleted: true })));
        ls.setItem('mexicano_matches', JSON.stringify(mixedMatches()));
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: null }));
        await pullForRoute(hash);
        expect(ls.getItem('mexicano_active_tournament')).toBeNull();
      });

      it(`[${label}] does not purge matches when local was already completed`, async () => {
        ls.setItem('mexicano_active_tournament', JSON.stringify(inProgressTournament({ isCompleted: true })));
        ls.setItem('mexicano_matches', JSON.stringify(mixedMatches()));
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: null }));
        await pullForRoute(hash);
        const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
        expect(matches.some(m => m.date === STALE_DATE)).toBe(true);
      });
    });
  });

  // ── Stale tournaments.json (isComplete:true) but date file has in-progress ────

  describe('stale tournaments.json: isComplete:true but date file has active tournament', () => {
    routes.forEach(({ label, hash }) => {
      it(`[${label}] sets active_tournament from date file and fixes in-memory index`, async () => {
        // No local active tournament (fresh device or pullAll cleared it)
        ls.setItem('mexicano_matches', JSON.stringify(mixedMatches()));
        const fresh = inProgressTournament({ currentRoundNumber: 5 });
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: fresh, indexComplete: true }));
        await pullForRoute(hash);
        const stored = JSON.parse(ls.getItem('mexicano_active_tournament'));
        expect(stored).not.toBeNull();
        expect(stored.currentRoundNumber).toBe(5);
      });
    });
  });

  // ── Completion marker: push in-flight, must not restore stale state ───────────

  describe('completion marker: prevents restoring stale in-progress state while push is in-flight', () => {
    routes.forEach(({ label, hash }) => {
      it(`[${label}] skips restoring active tournament when completion marker matches date`, async () => {
        // Simulate: tournament was just completed locally, push is in-flight.
        // localStorage has no active tournament (cleared by completeTournament),
        // but the date file still shows in-progress format (push not yet landed).
        ls.removeItem('mexicano_active_tournament');
        ls.setItem('mexicano_completion_marker', STALE_DATE);
        const stale = inProgressTournament({ currentRoundNumber: 3 });
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: stale }));
        await pullForRoute(hash);
        // Must NOT restore the stale in-progress tournament
        expect(ls.getItem('mexicano_active_tournament')).toBeNull();
        // Marker must still be present (only cleared when push is confirmed)
        expect(ls.getItem('mexicano_completion_marker')).toBe(STALE_DATE);
      });

      it(`[${label}] without completion marker, still reconciles stale in-memory index`, async () => {
        ls.removeItem('mexicano_active_tournament');
        ls.removeItem('mexicano_completion_marker');
        ls.setItem('mexicano_matches', JSON.stringify(mixedMatches()));
        const fresh = inProgressTournament({ currentRoundNumber: 9 });
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: fresh, indexComplete: true }));
        await pullForRoute(hash);
        const stored = JSON.parse(ls.getItem('mexicano_active_tournament'));
        expect(stored).not.toBeNull();
        expect(stored.currentRoundNumber).toBe(9);
      });
    });
  });

  // ── Completion marker cleared when file shows completed (push confirmed) ──────

  describe('completion marker cleared when date file shows completed matches', () => {
    routes.forEach(({ label, hash }) => {
      it(`[${label}] clears completion marker when file shows completed tournament`, async () => {
        // Marker set from previous completion; now the push has landed so the
        // date file shows the completed format (matches array present).
        ls.setItem('mexicano_active_tournament', JSON.stringify(inProgressTournament()));
        ls.setItem('mexicano_matches', JSON.stringify(mixedMatches()));
        ls.setItem('mexicano_completion_marker', STALE_DATE);
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: 'completed' }));
        await pullForRoute(hash);
        expect(ls.getItem('mexicano_active_tournament')).toBeNull();
        expect(ls.getItem('mexicano_completion_marker')).toBeNull();
      });
    });
  });

  // ── Backward-compat migration from data/active_tournament.json ───────────────

  describe('backward-compat migration: date file 404, old active_tournament.json exists', () => {
    routes.forEach(({ label, hash }) => {
      it(`[${label}] migrates from old data/active_tournament.json when date file absent`, async () => {
        // No local active tournament, no date file, but old file has in-progress data
        const oldAt = inProgressTournament({ currentRoundNumber: 7 });
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: null, activeTournamentJson: oldAt }));
        await pullForRoute(hash);
        const stored = JSON.parse(ls.getItem('mexicano_active_tournament'));
        expect(stored).not.toBeNull();
        expect(stored.currentRoundNumber).toBe(7);
      });
    });
  });

  // ── No local active_tournament, no active in index ────────────────────────────

  describe('no active tournament anywhere', () => {
    routes.forEach(({ label, hash }) => {
      it(`[${label}] does nothing to matches when no active tournament exists`, async () => {
        ls.setItem('mexicano_matches', JSON.stringify(mixedMatches()));
        vi.stubGlobal('fetch', makeFetch({ tournamentInDateFile: null }));
        await pullForRoute(hash);
        const matches = JSON.parse(ls.getItem('mexicano_matches') || '[]');
        expect(matches.some(m => m.date === STALE_DATE)).toBe(true);
        expect(matches.some(m => m.date === OTHER_DATE)).toBe(true);
      });
    });
  });
});
