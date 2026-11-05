/**
 * Tournament page: "ELO Progression" panel under the Leaderboard. Shows how each player's ELO moved
 * through the rounds (round 0 = before the tournament) with the chart of the ELO Charts page and a
 * chip per player that shows/hides that player's curve.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

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
function makeTournament(scores) {
  return {
    id: 't-elo-progression',
    name: 'ELO progression',
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
  };
}

function mount(tournament) {
  Store.setCurrentUser('mino');
  Store.setActiveTournament(tournament);
  const container = document.createElement('div');
  const cleanup = renderTournament(container, { date: DATE });
  return { container, cleanup };
}

const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
const panel = (container) => container.querySelector('#tournament-elo');
const canvasOf = (container) => panel(container).querySelector('canvas');
const chips = (container) => [...panel(container).querySelectorAll('.elo-cache-chip')];
const chip = (container, name) => chips(container).find(el => text(el) === name);
const isOn = (el) => el.classList.contains('active') && el.getAttribute('aria-pressed') === 'true';
const curves = (container) => canvasOf(container)._chartMeta.datasets
  .map(ds => ({ name: ds.label, color: ds.color, elo: ds.data.map(pt => pt.y) }));

let drawnTexts = [];
/** ELO change labels drawn by the last redraw(s) since the previous call ("+16", "-17.4"). */
const takeDeltaLabels = () => { const labels = drawnTexts.filter(t => /^[+-]\d/.test(t)); drawnTexts = []; return labels; };
const deltaBtn = (container) => panel(container).querySelector('#tournament-elo-deltas');
const pickFilter = async (container, value) => {
  const filter = container.querySelector('#matches-player-filter');
  filter.value = value;
  filter.dispatchEvent(new Event('change'));
  await nextFrame();
};

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
  // jsdom has no canvas: give the chart a no-op 2D context and a laid-out box to draw on
  const noop = () => {};
  drawnTexts = [];
  const ctx = new Proxy({ measureText: () => ({ width: 0 }), fillText: (t) => { drawnTexts.push(String(t)); } }, {
    get: (target, prop) => (prop in target ? target[prop] : noop),
    set: (target, prop, value) => { target[prop] = value; return true; },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 288, width: 400, height: 288 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Tournament ELO progression panel', () => {
  it('sits under the Leaderboard in the right column', () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const { container } = mount(makeTournament([[15, 10]]));

    const side = container.querySelector('.tournament-desktop > .tournament-side');
    expect([...side.children].map(el => text(el.querySelector('.panel-title')))).toEqual(['Leaderboard', 'ELO Progression']);
    expect(side.children[0].querySelector('#tournament-leaderboard')).not.toBeNull();
    expect(side.children[1]).toBe(panel(container));
  });

  it('plots every player from round 0 on, one chip per player (15-10 then 10-15, all at 1000)', async () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const { container } = mount(makeTournament([[15, 10], [10, 15]]));
    await nextFrame();

    expect(canvasOf(container)._chartMeta.xLabels).toEqual([0, 1, 2]);
    expect(curves(container)).toEqual([
      { name: 'Alice', color: '#e6194b', elo: [1000, 1016, 998.56] },
      { name: 'Bob', color: '#3cb44b', elo: [1000, 1016, 998.56] },
      { name: 'Charlie', color: '#4363d8', elo: [1000, 984.74, 1001.38] },
      { name: 'Diana', color: '#911eb4', elo: [1000, 984.74, 1001.38] },
    ]);
    const alice = canvasOf(container)._chartMeta.datasets[0].data;
    expect(alice.map(pt => [pt.x, pt.label, pt.delta])).toEqual([[0, 'Round 0', 0], [1, 'Round 1', 16], [2, 'Round 2', -17.4]]);
    expect(chips(container).map(text)).toEqual(NAMES);
    expect(chips(container).every(isOn)).toBe(true);
  });

  it('hides and shows a player\'s curve with their chip, without recolouring the others', async () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const { container } = mount(makeTournament([[15, 10], [10, 15]]));
    await nextFrame();

    chip(container, 'Bob').click();

    expect(isOn(chip(container, 'Bob'))).toBe(false);
    expect(chip(container, 'Bob').getAttribute('aria-pressed')).toBe('false');
    expect(curves(container).map(c => [c.name, c.color])).toEqual([
      ['Alice', '#e6194b'], ['Charlie', '#4363d8'], ['Diana', '#911eb4'],
    ]);

    chip(container, 'Bob').click();

    expect(isOn(chip(container, 'Bob'))).toBe(true);
    expect(curves(container).map(c => c.name)).toEqual(NAMES);
  });

  it('lets every player be hidden', async () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const { container } = mount(makeTournament([[15, 10]]));
    await nextFrame();

    chips(container).forEach(el => el.click());

    expect(chips(container).some(isOn)).toBe(false);
    expect(canvasOf(container)._chartMeta).toBeNull();
  });

  it('keeps hidden players hidden across a re-render', async () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const { container } = mount(makeTournament([[15, 10]]));
    await nextFrame();
    chip(container, 'Bob').click();

    State.emit('tournament-changed');
    await nextFrame();

    expect(isOn(chip(container, 'Bob'))).toBe(false);
    expect(curves(container).map(c => c.name)).toEqual(['Alice', 'Charlie', 'Diana']);
  });

  it('shows only the player picked in the Matches player filter, all again for "All players"', async () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const { container } = mount(makeTournament([[15, 10], [10, 15]]));
    await nextFrame();
    const filter = container.querySelector('#matches-player-filter');

    filter.value = 'Charlie';
    filter.dispatchEvent(new Event('change'));
    await nextFrame();

    expect(curves(container).map(c => [c.name, c.color])).toEqual([['Charlie', '#4363d8']]);
    expect(chips(container).filter(isOn).map(text)).toEqual(['Charlie']);

    filter.value = '';
    filter.dispatchEvent(new Event('change'));
    await nextFrame();

    expect(curves(container).map(c => c.name)).toEqual(NAMES);
    expect(chips(container).every(isOn)).toBe(true);
  });

  it('still lets chips add players after filtering by a player', async () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const { container } = mount(makeTournament([[15, 10]]));
    await nextFrame();
    const filter = container.querySelector('#matches-player-filter');
    filter.value = 'Charlie';
    filter.dispatchEvent(new Event('change'));
    await nextFrame();

    chip(container, 'Alice').click();

    expect(curves(container).map(c => c.name)).toEqual(['Alice', 'Charlie']);
  });

  it('has a Δ toggle for ELO change labels, off by default', async () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const { container } = mount(makeTournament([[15, 10], [10, 15]]));
    await nextFrame();

    expect(deltaBtn(container).classList.contains('active')).toBe(false);
    expect(deltaBtn(container).getAttribute('aria-pressed')).toBe('false');
    expect(takeDeltaLabels()).toEqual([]);

    deltaBtn(container).click();

    expect(deltaBtn(container).getAttribute('aria-pressed')).toBe('true');
    expect(takeDeltaLabels()).toEqual(['+16', '-17.4', '+16', '-17.4', '-15.3', '+16.6', '-15.3', '+16.6']);

    deltaBtn(container).click();

    expect(deltaBtn(container).classList.contains('active')).toBe(false);
    expect(takeDeltaLabels()).toEqual([]);
  });

  it('turns ELO change labels on for a picked player and off again for "All players"', async () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const { container } = mount(makeTournament([[15, 10], [10, 15]]));
    await nextFrame();
    takeDeltaLabels();

    await pickFilter(container, 'Charlie');

    expect(deltaBtn(container).getAttribute('aria-pressed')).toBe('true');
    expect(takeDeltaLabels()).toEqual(['-15.3', '+16.6']);

    await pickFilter(container, '');

    expect(deltaBtn(container).getAttribute('aria-pressed')).toBe('false');
    expect(takeDeltaLabels()).toEqual([]);
  });

  it('says so until a match is scored, then shows the chart', async () => {
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const { container } = mount(makeTournament([null]));

    expect(text(panel(container).querySelector('.panel-body'))).toBe('No ELO data yet');
    expect(canvasOf(container)).toBeNull();
    expect(chips(container)).toHaveLength(0);
    expect(deltaBtn(container)).toBeNull();

    enterScore(container, 15, 10);
    await nextFrame();

    expect(chips(container).map(text)).toEqual(NAMES);
    expect(canvasOf(container)._chartMeta.xLabels).toEqual([0, 1]);
  });

  it('says it is unavailable when a baseline is unknown (player missing from the summary)', () => {
    Store.setPlayersSummaryCache(SUMMARY_1000.filter(p => p.name !== 'Diana'));
    const { container } = mount(makeTournament([[15, 10]]));

    expect(text(panel(container).querySelector('.panel-body'))).toBe('ELO progression not available for this tournament');
    expect(canvasOf(container)).toBeNull();
    expect(chips(container)).toHaveLength(0);
  });

  it('releases every resize listener it adds, on re-render and when the page is left', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    Store.setPlayersSummaryCache(SUMMARY_1000);
    const { cleanup } = mount(makeTournament([[15, 10]]));

    State.emit('tournament-changed');
    State.emit('tournament-changed');
    cleanup();

    const resizeCalls = (spy) => spy.mock.calls.filter(([type]) => type === 'resize').length;
    expect(resizeCalls(add)).toBe(3);
    expect(resizeCalls(remove)).toBe(3);
  });
});
