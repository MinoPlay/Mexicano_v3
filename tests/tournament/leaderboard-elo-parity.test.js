/**
 * Tournament leaderboard ELO parity with Home/Statistics "latest".
 *
 * Bug: the Tournament leaderboard always passed isLatest=false to
 * renderDayStatsInto, so it recomputed ELO instead of using the authoritative
 * players_summary ELO that Home and Statistics "latest" use. For the latest
 * tournament this produced ELO values that differed from Home/Stats.
 *
 * Expected: when the viewed tournament IS the latest complete tournament, the
 * leaderboard must render with isLatest=true (summary-based ELO). For older
 * tournaments it stays isLatest=false (historical recompute).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

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

const { renderDayStatsIntoMock } = vi.hoisted(() => ({
  renderDayStatsIntoMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../js/pages/statistics.js', () => ({
  renderDayStatsInto: renderDayStatsIntoMock,
  showPlayerProfile: vi.fn(),
}));

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

import { renderTournament } from '../../js/pages/tournament.js';
import { Store } from '../../js/store.js';
import { State } from '../../js/state.js';

const LATEST_DATE = '2025-06-15';
const OLDER_DATE = '2025-05-10';

function matchFor(date) {
  return {
    date,
    roundNumber: 1,
    team1Player1Name: 'Alice',
    team1Player2Name: 'Bob',
    team2Player1Name: 'Charlie',
    team2Player2Name: 'Diana',
    scoreTeam1: 13,
    scoreTeam2: 12,
  };
}

function completedTournament(date) {
  return {
    id: `t-${date}`,
    name: 'Test Tournament',
    tournamentDate: date,
    players: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Charlie' }, { name: 'Diana' }],
    isStarted: true,
    isCompleted: true,
    rounds: [{
      roundNumber: 1,
      matches: [{
        id: 'm1',
        player1: { name: 'Alice' }, player2: { name: 'Bob' },
        player3: { name: 'Charlie' }, player4: { name: 'Diana' },
        team1Score: 13, team2Score: 12,
      }],
    }],
  };
}

beforeEach(() => {
  localStorageStub.clear();
  State._listeners = {};
  renderDayStatsIntoMock.mockClear();
  Store.setTournamentsIndex([
    { date: OLDER_DATE, isComplete: true },
    { date: LATEST_DATE, isComplete: true },
  ]);
  Store.setMatches([matchFor(OLDER_DATE), matchFor(LATEST_DATE)]);
});

describe('Tournament leaderboard ELO parity', () => {
  it('passes isLatest=true when viewing the latest complete tournament', () => {
    Store.setActiveTournament(completedTournament(LATEST_DATE));

    const container = document.createElement('div');
    renderTournament(container, { date: LATEST_DATE });

    expect(renderDayStatsIntoMock).toHaveBeenCalled();
    const args = renderDayStatsIntoMock.mock.calls[0];
    // args: (container, matches, targetDate, isLatest, onPlayerClick)
    expect(args[2]).toBe(LATEST_DATE);
    expect(args[3]).toBe(true);
  });

  it('passes isLatest=false when viewing an older tournament', () => {
    Store.setActiveTournament(completedTournament(OLDER_DATE));

    const container = document.createElement('div');
    renderTournament(container, { date: OLDER_DATE });

    expect(renderDayStatsIntoMock).toHaveBeenCalled();
    const args = renderDayStatsIntoMock.mock.calls[0];
    expect(args[2]).toBe(OLDER_DATE);
    expect(args[3]).toBe(false);
  });
});
