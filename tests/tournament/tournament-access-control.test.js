/**
 * Tournament access control tests.
 * Verify that non-admin users cannot mutate tournament state.
 * Admin users (isMino) can perform all mutations.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mock GitHub service ───
vi.mock('../../js/services/github.js', () => ({
  schedulePush: vi.fn(),
  cancelPendingSync: vi.fn(),
  flushPush: vi.fn().mockResolvedValue(undefined),
  updateTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  markMatchDateDirty: vi.fn(),
  keyToPath: vi.fn().mockReturnValue(null),
  readFile: vi.fn().mockResolvedValue(null),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock local service ───
vi.mock('../../js/services/local.js', () => ({
  writeTournamentDay: vi.fn().mockResolvedValue(undefined),
}));

// ─── In-memory localStorage stub ───
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

const localStorageStub = makeLocalStorage();
vi.stubGlobal('localStorage', localStorageStub);

// ─── Imports after mocks/stubs ───
import {
  createTournament,
  startTournament,
  setMatchScore,
  startNextRound,
  completeTournament,
  updateAccessCode,
} from '../../js/services/tournament.js';
import { Store } from '../../js/store.js';
import { State } from '../../js/state.js';
import ADMINISTRATORS from '../../data/administrators.json';

// ─── Test data ───
const DATE = '2025-06-01';
const PLAYERS_4 = ['Alice', 'Bob', 'Carol', 'Dave'];

// ─── Helpers ───
function makeCompletedRound1Tournament() {
  const t = createTournament(DATE, PLAYERS_4);
  startTournament(t);
  setMatchScore(t, 1, 1, 15, 10);
  return t;
}

function makeCompletedAllRoundsTournament() {
  const t = createTournament(DATE, PLAYERS_4);
  startTournament(t);
  setMatchScore(t, 1, 1, 15, 10);
  startNextRound(t);
  setMatchScore(t, 2, 1, 13, 12);
  return t;
}

// ─── Reset state between tests ───
beforeEach(() => {
  localStorageStub.clear();
  State._listeners = {};
  Store.setAdministrators(ADMINISTRATORS);
});

// ─── Tests ───

describe('Tournament Access Control', () => {

  describe('getTournamentAccessibleList - non-admin sees active tournament', () => {
    it('non-admin can see both completed and active tournaments', () => {
      // Setup: mock tournaments index with one completed, one active
      const tournamentsIndex = [
        { date: '2024-01-01', isComplete: true, playerCount: 4, roundCount: 1, matchCount: 1, completedCount: 1 },
        { date: '2024-01-02', isComplete: false, playerCount: 4, roundCount: 1, matchCount: 1, completedCount: 0 }
      ];
      Store.setTournamentsIndex(tournamentsIndex);

      // Mock user is non-admin
      Store.setCurrentUser('alice');
      expect(Store.isAdministrator()).toBe(false);

      // Get accessible list
      const accessible = Store.getTournamentsIndex();

      // Both tournaments should be visible (active NOT filtered out)
      expect(accessible).toHaveLength(2);
      expect(accessible[0].date).toBe('2024-01-01');
      expect(accessible[0].isComplete).toBe(true);
      expect(accessible[1].date).toBe('2024-01-02');
      expect(accessible[1].isComplete).toBe(false);
    });
  });

  describe('setMatchScore - non-admin access control', () => {
    it('non-admin cannot call setMatchScore (throws error)', () => {
      // Setup: fresh tournament, ready to set first score
      const t = createTournament(DATE, PLAYERS_4);
      startTournament(t);
      
      // Mock user is non-admin
      Store.setCurrentUser('alice');
      expect(Store.isAdministrator()).toBe(false);

      // Attempt to set score should throw or fail
      // Current behavior: succeeds (no guard). Test expects: throws error
      expect(() => {
        setMatchScore(t, 1, 1, 15, 10);
      }).toThrow();
    });

    it('admin CAN call setMatchScore (succeeds)', () => {
      // Setup: fresh tournament, ready to set first score
      const t = createTournament(DATE, PLAYERS_4);
      startTournament(t);
      
      // Mock user IS admin
      Store.setCurrentUser('mino');
      expect(Store.isAdministrator()).toBe(true);

      // Attempt to set score should succeed
      // This should not throw
      expect(() => {
        setMatchScore(t, 1, 1, 15, 10);
      }).not.toThrow();
    });
  });

  describe('startNextRound - non-admin access control', () => {
    it('non-admin cannot call startNextRound (throws error)', () => {
      // Setup: tournament with round 1 complete
      const t = makeCompletedRound1Tournament();
      
      // Mock user is non-admin
      Store.setCurrentUser('alice');
      expect(Store.isAdministrator()).toBe(false);

      // Attempt to start next round should throw or fail
      // Current behavior: succeeds (no guard). Test expects: throws error
      expect(() => {
        startNextRound(t);
      }).toThrow();
    });

    it('admin CAN call startNextRound (succeeds)', () => {
      // Setup: tournament with round 1 complete
      const t = makeCompletedRound1Tournament();
      
      // Mock user IS admin
      Store.setCurrentUser('kikke');
      expect(Store.isAdministrator()).toBe(true);

      // Attempt to start next round should succeed
      expect(() => {
        startNextRound(t);
      }).not.toThrow();
    });
  });

  describe('completeTournament - non-admin access control', () => {
    it('non-admin cannot call completeTournament (throws error)', () => {
      // Setup: tournament with all rounds complete
      const t = makeCompletedAllRoundsTournament();
      
      // Mock user is non-admin
      Store.setCurrentUser('alice');
      expect(Store.isAdministrator()).toBe(false);

      // Attempt to complete tournament should throw or fail
      // Current behavior: succeeds (no guard). Test expects: throws error
      expect(() => {
        completeTournament(t);
      }).toThrow();
    });

    it('admin CAN call completeTournament (succeeds)', () => {
      // Setup: tournament with all rounds complete
      const t = makeCompletedAllRoundsTournament();
      
      // Mock user IS admin
      Store.setCurrentUser('mino');
      expect(Store.isAdministrator()).toBe(true);

      // Attempt to complete tournament should succeed
      expect(() => {
        completeTournament(t);
      }).not.toThrow();
    });
  });

  describe('updateAccessCode - non-admin access control', () => {
    it('non-admin cannot call updateAccessCode (throws error)', () => {
      // Setup: create a tournament
      const t = createTournament(DATE, PLAYERS_4, 'OLD-CODE');
      Store.setActiveTournament(t);
      
      // Mock user is non-admin
      Store.setCurrentUser('alice');
      expect(Store.isAdministrator()).toBe(false);

      // Attempt to update access code should throw or fail
      // Current behavior: succeeds (no guard). Test expects: throws error
      expect(() => {
        updateAccessCode(DATE, 'NEW-CODE');
      }).toThrow();
    });

    it('admin CAN call updateAccessCode (succeeds)', () => {
      // Setup: create a tournament
      const t = createTournament(DATE, PLAYERS_4, 'OLD-CODE');
      Store.setActiveTournament(t);
      
      // Mock user IS admin
      Store.setCurrentUser('mino');
      expect(Store.isAdministrator()).toBe(true);

      // Attempt to update access code should succeed
      expect(() => {
        updateAccessCode(DATE, 'NEW-CODE');
      }).not.toThrow();
    });
  });

});
