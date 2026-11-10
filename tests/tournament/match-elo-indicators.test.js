/**
 * Matches tab: ELO change indicators next to the player names of completed matches.
 * Left team shows the badge after the name, right team before it (inner side, toward "vs").
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../js/services/backend.js', async (importOriginal) => ({
  ...await importOriginal(),
  schedulePush: vi.fn(),
  cancelPendingSync: vi.fn(),
  flushPush: vi.fn().mockResolvedValue(undefined),
  updateTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  markMatchDateDirty: vi.fn(),
  keyToPath: vi.fn().mockReturnValue(null),
  readFile: vi.fn().mockResolvedValue(null),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  pushTournamentDayFile: vi.fn().mockResolvedValue(true),
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
import { Cache } from '../../js/cache.js';
import ADMINISTRATORS from '../../data/administrators.json';

const DATE = '2026-05-07';
const EARLIER = '2026-04-30';
const NAMES = ['Alice', 'Bob', 'Charlie', 'Diana'];

const summaryEntry = (name, elo, extra = {}) => ({ name, elo, previousElo: 1000, eloDate: EARLIER, ...extra });
const SUMMARY_1000 = NAMES.map(name => summaryEntry(name, 1000));

/** One match per round, Alice+Bob vs Charlie+Diana; `scores` = [[s1, s2] | null, ...] per round. */
function makeTournament(scores, overrides = {}) {
  return {
    id: 't-elo-indicators',
    name: 'ELO indicators',
    tournamentDate: DATE,
    players: NAMES.map(name => ({ name })),
    isStarted: true,
    isCompleted: false,
    currentRoundNumber: scores.length,
    rounds: scores.map((score, i) => ({
      roundNumber: i + 1,
      matches: [{
        id: 1,
        roundNumber: i + 1,
        player1: { name: 'Alice' },
        player2: { name: 'Bob' },
        player3: { name: 'Charlie' },
        player4: { name: 'Diana' },
        team1Score: score ? score[0] : null,
        team2Score: score ? score[1] : null,
      }],
    })),
    ...overrides,
  };
}

function mount(tournament, user = 'mino') {
  Store.setCurrentUser(user);
  Store.setActiveTournament(tournament);
  const container = document.createElement('div');
  renderTournament(container, { date: DATE });
  return container;
}

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const nameTexts = (container) => [...container.querySelectorAll('.match-card .match-team-name')].map(text);

function enterScore(container, s1, s2) {
  // closeSheet() removes the previous sheet only after 300 ms; drop it now so the #score ids stay unique
  document.querySelectorAll('.bottom-sheet, .bottom-sheet-overlay').forEach(el => el.remove());
  container.querySelector('.match-card').dispatchEvent(new Event('click', { bubbles: true }));
  const sheet = document.querySelector('.bottom-sheet');
  sheet.querySelector('#score1').value = String(s1);
  sheet.querySelector('#score2').value = String(s2);
  sheet.querySelector('#score-confirm').click();
}

beforeEach(() => {
  localStorageStub.clear();
  Cache.keys('').forEach(key => Cache.del(key));
  State._listeners = {};
  Store.setAdministrators(ADMINISTRATORS);
  document.body.innerHTML = '';
});

describe('Matches tab ELO change indicators', () => {
  it('shows gain/loss next to every name of a completed match (15-10, all at 1000)', () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const container = mount(makeTournament([[15, 10]]));

    expect(nameTexts(container)).toEqual(['Alice ▲16.0', 'Bob ▲16.0', '▼15.3 Charlie', '▼15.3 Diana']);
    const card = container.querySelector('.match-card');
    expect(card.querySelectorAll('.match-team-name .elo-change.positive')).toHaveLength(2);
    expect(card.querySelectorAll('.match-team-name .elo-change.negative')).toHaveLength(2);
  });

  it('shows nothing for a match that is not scored yet', () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const container = mount(makeTournament([null]));

    expect(nameTexts(container)).toEqual(['Alice', 'Bob', 'Charlie', 'Diana']);
    expect(container.querySelector('.elo-change')).toBeNull();
  });

  it('appears after entering a result and follows a changed result', () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const container = mount(makeTournament([null]));

    enterScore(container, 15, 10);
    expect(nameTexts(container)).toEqual(['Alice ▲16.0', 'Bob ▲16.0', '▼15.3 Charlie', '▼15.3 Diana']);

    enterScore(container, 10, 15);
    expect(nameTexts(container)).toEqual(['Alice ▼16.0', 'Bob ▼16.0', '▲15.3 Charlie', '▲15.3 Diana']);
    const card = container.querySelector('.match-card');
    expect(card.querySelectorAll('.elo-change.positive')).toHaveLength(2);
    expect(card.querySelectorAll('.elo-change.negative')).toHaveLength(2);
  });

  it('chains rounds: round 2 starts from the ELO after round 1', () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const container = mount(makeTournament([[15, 10], [10, 15]]));

    expect(nameTexts(container)).toEqual(['Alice ▼17.4', 'Bob ▼17.4', '▲16.6 Charlie', '▲16.6 Diana']);

    container.querySelector('#prev-round').click();
    expect(nameTexts(container)).toEqual(['Alice ▲16.0', 'Bob ▲16.0', '▼15.3 Charlie', '▼15.3 Diana']);
  });

  it('uses previousElo as baseline when the summary already contains this tournament', () => {
    Store.setPlayersSummaryCache([
      summaryEntry('Alice', 1016, { eloDate: DATE }),
      summaryEntry('Bob', 1016, { eloDate: DATE }),
      summaryEntry('Charlie', 984.74, { eloDate: DATE }),
      summaryEntry('Diana', 984.74, { eloDate: DATE }),
    ]);
    const container = mount(makeTournament([[15, 10]]));

    expect(nameTexts(container)).toEqual(['Alice ▲16.0', 'Bob ▲16.0', '▼15.3 Charlie', '▼15.3 Diana']);
  });

  it('shows a neutral dash when the change rounds to 0.0', () => {
    // 2200 vs 1000 at 15-10: raw changes are only +0.03 / -0.03
    Store.setPlayersSummaryCache([
      summaryEntry('Alice', 2200),
      summaryEntry('Bob', 2200),
      summaryEntry('Charlie', 1000),
      summaryEntry('Diana', 1000),
    ]);
    const container = mount(makeTournament([[15, 10]]));

    expect(nameTexts(container)).toEqual(['Alice –', 'Bob –', '– Charlie', '– Diana']);
    expect(container.querySelectorAll('.match-card .elo-change.neutral')).toHaveLength(4);
  });

  it('is visible to non-admins too', () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const container = mount(makeTournament([[15, 10]]), 'someone-else');

    expect(Store.isAdministrator()).toBe(false);
    expect(nameTexts(container)).toEqual(['Alice ▲16.0', 'Bob ▲16.0', '▼15.3 Charlie', '▼15.3 Diana']);
  });

  it('is shown on the Matches tab of a completed tournament', () => {
    Store.setPlayersSummaryCache([
      summaryEntry('Alice', 1016, { eloDate: DATE }),
      summaryEntry('Bob', 1016, { eloDate: DATE }),
      summaryEntry('Charlie', 984.74, { eloDate: DATE }),
      summaryEntry('Diana', 984.74, { eloDate: DATE }),
    ]);
    const container = mount(makeTournament([[15, 10]], { isCompleted: true }), 'someone-else');

    container.querySelector('#tournament-tabs [data-tab="matches"]').click();
    expect(nameTexts(container)).toEqual(['Alice ▲16.0', 'Bob ▲16.0', '▼15.3 Charlie', '▼15.3 Diana']);
  });

  it('shows nothing when a baseline is unknown (player missing from the summary)', () => {
    Store.setPlayersSummaryCache(SUMMARY_1000.filter(p => p.name !== 'Diana'));
    const container = mount(makeTournament([[15, 10]]));

    expect(nameTexts(container)).toEqual(['Alice', 'Bob', 'Charlie', 'Diana']);
    expect(container.querySelector('.elo-change')).toBeNull();
  });
});
