/**
 * Admin-only tournament score/end controls tests.
 * Verify that non-admin users cannot see or interact with:
 * - "Tap to score" text
 * - Next Round button (id="next-round-btn")
 * - End Tournament button (id="end-tournament-btn")
 * - Match card click listeners for scoring
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mock dynamic imports used by tournament.js and store.js ───

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

vi.mock('../../js/services/local.js', () => ({
  writeTournamentDay: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../js/services/ranking.js', () => ({
  rankPlayers: vi.fn().mockReturnValue([]),
}));

vi.mock('../../js/components/toast.js', () => ({
  showToast: vi.fn(),
  showConfirmDialog: vi.fn(),
}));

vi.mock('../../js/pages/statistics.js', () => ({
  renderDayStatsInto: vi.fn().mockResolvedValue(undefined),
  showPlayerProfile: vi.fn(),
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

// ─── Setup jsdom environment (automatic in vitest with environment: 'jsdom') ───

// ─── Imports after mocks/stubs ───
import { renderTournament } from '../../js/pages/tournament.js';
import { Store } from '../../js/store.js';
import { State } from '../../js/state.js';

// ─── Test data ───
// Tournament with incomplete match (shows "Tap to score", action buttons)
const MOCK_TOURNAMENT_INCOMPLETE = {
  id: 'test-tournament-123',
  name: 'Test Tournament',
  tournamentDate: '2025-06-15',
  players: [
    { name: 'Alice' },
    { name: 'Bob' },
    { name: 'Charlie' },
    { name: 'Diana' },
  ],
  isStarted: true,
  isCompleted: false,
  rounds: [
    {
      number: 1,
      matches: [
        {
          id: 'm1',
          player1: { name: 'Alice' },
          player2: { name: 'Bob' },
          player3: { name: 'Charlie' },
          player4: { name: 'Diana' },
          team1Score: null,
          team2Score: null,
        },
      ],
    },
  ],
};

// ─── Reset state between tests ───
beforeEach(() => {
  localStorageStub.clear();
  State._listeners = {};
});

// ─── Tests ───

describe('Admin-Only Tournament Controls', () => {

  describe('Test Case 1: Admin sees score controls, non-admin does NOT', () => {
    it('Admin sees "Tap to score" text for incomplete match', () => {
      // Setup: mock as admin
      Store.setCurrentUser('mino');
      expect(Store.isMino()).toBe(true);

      // Setup: create container and render tournament
      const container = document.createElement('div');
      
      // Mock getActiveTournament to return our test tournament
      Store.setActiveTournament(MOCK_TOURNAMENT_INCOMPLETE);
      
      // Call renderTournament
      renderTournament(container, { date: MOCK_TOURNAMENT_INCOMPLETE.tournamentDate });

      // Get rendered HTML
      const html = container.innerHTML;

      // Assert: "Tap to score" text is visible for admin with incomplete match
      expect(html).toContain('Tap to score');
    });

    it('Admin sees end-tournament-btn button', () => {
      // Setup: mock as admin
      Store.setCurrentUser('kikke');
      expect(Store.isMino()).toBe(true);

      // Setup: create container and render tournament
      const container = document.createElement('div');
      
      // Mock getActiveTournament to return our test tournament
      Store.setActiveTournament(MOCK_TOURNAMENT_INCOMPLETE);
      
      // Call renderTournament
      renderTournament(container, { date: MOCK_TOURNAMENT_INCOMPLETE.tournamentDate });

      // Assert: End Tournament button exists for admin
      expect(container.querySelector('#end-tournament-btn')).not.toBeNull();
    });
  });

  describe('Test Case 2: Non-admin should NOT see UI controls in rendered HTML', () => {
    it('Non-admin sees "Tap to score" when rendered with incomplete tournament (CURRENTLY FAILS - shows bug)', () => {
      // Setup: mock as non-admin
      Store.setCurrentUser('alice');
      expect(Store.isMino()).toBe(false);

      // Setup: create container and render tournament
      const container = document.createElement('div');
      
      // Mock getActiveTournament to return our test tournament
      Store.setActiveTournament(MOCK_TOURNAMENT_INCOMPLETE);
      
      // Call renderTournament with same tournament state
      renderTournament(container, { date: MOCK_TOURNAMENT_INCOMPLETE.tournamentDate });

      // Get rendered HTML
      const html = container.innerHTML;

      // FAILING ASSERTION: Non-admin should NOT see "Tap to score" text
      // Current behavior: Shows it to everyone (bug!)
      // Expected behavior: Only admin should see it
      expect(html).not.toContain('Tap to score');
    });

    it('Non-admin should NOT see end-tournament-btn in rendered HTML', () => {
      // Setup: mock as non-admin
      Store.setCurrentUser('bob');
      expect(Store.isMino()).toBe(false);

      // Setup: create container and render tournament
      const container = document.createElement('div');
      
      // Mock getActiveTournament to return our test tournament
      Store.setActiveTournament(MOCK_TOURNAMENT_INCOMPLETE);
      
      // Call renderTournament with same tournament state
      renderTournament(container, { date: MOCK_TOURNAMENT_INCOMPLETE.tournamentDate });

      // FAILING ASSERTION: Non-admin should NOT see end-tournament-btn
      // Current behavior: Shows it to everyone (bug!)
      // Expected behavior: Only admin should see it
      expect(container.querySelector('#end-tournament-btn')).toBeNull();
    });
  });

});
