/**
 * Score-entry preset buttons in the tournament score sheet.
 * Verify the preset list is 9-16, 10-15, 11-14, 12-13, 13-12, 14-11, 15-10, 16-9.
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

// ─── Imports after mocks/stubs ───
import { renderTournament } from '../../js/pages/tournament.js';
import { Store } from '../../js/store.js';
import { State } from '../../js/state.js';
import ADMINISTRATORS from '../../data/administrators.json';

const MOCK_TOURNAMENT_INCOMPLETE = {
  id: 'test-tournament-presets',
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

beforeEach(() => {
  localStorageStub.clear();
  State._listeners = {};
  Store.setAdministrators(ADMINISTRATORS);
  document.body.innerHTML = '';
});

describe('Score sheet preset buttons', () => {
  it('shows presets 9-16, 10-15, 11-14, 12-13, 13-12, 14-11, 15-10, 16-9', () => {
    Store.setCurrentUser('mino');
    Store.setActiveTournament(MOCK_TOURNAMENT_INCOMPLETE);

    const container = document.createElement('div');
    renderTournament(container, { date: MOCK_TOURNAMENT_INCOMPLETE.tournamentDate });

    container.querySelector('.match-card').dispatchEvent(new Event('click', { bubbles: true }));

    const presetButtons = document.querySelectorAll('#score-presets .score-preset');
    const presets = Array.from(presetButtons).map(btn => [btn.dataset.s1, btn.dataset.s2].join('-'));

    expect(presets).toEqual([
      '9-16', '10-15', '11-14', '12-13', '13-12', '14-11', '15-10', '16-9',
    ]);
  });
});
