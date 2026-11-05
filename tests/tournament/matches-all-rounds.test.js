/**
 * Tournament detail — Matches panel shows ALL rounds at once.
 *
 * Replaces the one-round-at-a-time view (◀ Round N ▶). A header control picks
 * the round order: "Last round first" or "First round first" (default).
 * Court cards inside a round always keep court order. Each match is a single
 * line card (court, team 1, score vs score, team 2) and a header select
 * filters the list to the matches of one player.
 * See .github/features/tournament-matches-panel.md.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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
import ADMINISTRATORS from '../../data/administrators.json';

const DATE = '2026-11-03';

function match(id, roundNumber, [p1, p2, p3, p4], scores) {
  return {
    id,
    roundNumber,
    player1: { name: p1 },
    player2: { name: p2 },
    player3: { name: p3 },
    player4: { name: p4 },
    team1Score: scores ? scores[0] : null,
    team2Score: scores ? scores[1] : null,
  };
}

// 8 players, up to 3 rounds x 2 courts. Round 3 has one unscored match.
function makeTournament({ rounds = 3, isCompleted = false } = {}) {
  const all = [
    {
      roundNumber: 1,
      matches: [
        match(1, 1, ['Alice', 'Bob', 'Carol', 'Dave'], [15, 10]),
        match(2, 1, ['Eve', 'Frank', 'Grace', 'Hank'], [14, 11]),
      ],
    },
    {
      roundNumber: 2,
      matches: [
        match(1, 2, ['Alice', 'Carol', 'Bob', 'Eve'], [13, 12]),
        match(2, 2, ['Dave', 'Frank', 'Grace', 'Hank'], [16, 9]),
      ],
    },
    {
      roundNumber: 3,
      matches: [
        match(1, 3, ['Alice', 'Eve', 'Bob', 'Frank'], [18, 7]),
        match(2, 3, ['Carol', 'Grace', 'Dave', 'Hank'], null),
      ],
    },
  ];
  return {
    id: 't-matches-panel',
    tournamentDate: DATE,
    players: ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Hank'].map(name => ({ name })),
    rounds: all.slice(0, rounds),
    currentRoundNumber: rounds,
    isStarted: true,
    isCompleted,
  };
}

// 5 players on 1 court: one player sits out each round (R1 Eve, R2 Dave, R3 Carol).
function makeSitOutTournament() {
  return {
    id: 't-sit-out',
    tournamentDate: DATE,
    players: ['Alice', 'Bob', 'Carol', 'Dave', 'Eve'].map(name => ({ name })),
    rounds: [
      { roundNumber: 1, matches: [match(1, 1, ['Alice', 'Bob', 'Carol', 'Dave'], [15, 10])] },
      { roundNumber: 2, matches: [match(1, 2, ['Alice', 'Carol', 'Bob', 'Eve'], [13, 12])] },
      { roundNumber: 3, matches: [match(1, 3, ['Alice', 'Dave', 'Bob', 'Eve'], [18, 7])] },
    ],
    currentRoundNumber: 3,
    isStarted: true,
    isCompleted: false,
  };
}

function renderAs(user, tournament = makeTournament()) {
  Store.setCurrentUser(user);
  Store.setActiveTournament(tournament);
  const container = document.createElement('div');
  renderTournament(container, { date: DATE });
  return container;
}

const roundTitles = (c) => [...c.querySelectorAll('.round-title')].map(el => el.textContent.trim());
const courtLabels = (c) => [...c.querySelectorAll('.match-court')].map(el => el.textContent.trim());
const cardScore = (card) => {
  const values = [...card.querySelectorAll('.match-score-value')].map(el => el.textContent.trim());
  return values.length ? values.join('-') : 'none';
};
const cardScores = (c) => [...c.querySelectorAll('.match-card')].map(cardScore);
const isBefore = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

function clickOrder(container, order) {
  const btn = container.querySelector(`#matches-order [data-order="${order}"]`);
  expect(btn, `order button "${order}"`).not.toBeNull();
  btn.click();
}

const filterSelect = (c) => c.querySelector('#matches-player-filter');
const cardTokens = (card) => [...card.querySelectorAll('.match-court, .match-team-name, .match-score-value, .match-vs, .match-hint')]
  .map(el => el.textContent.trim());

function pickPlayer(container, name) {
  const select = filterSelect(container);
  expect(select, 'player filter select').not.toBeNull();
  select.value = name;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  localStorageStub.clear();
  State._listeners = {};
  Store.setAdministrators(ADMINISTRATORS);
  Store.setMatches([]);
  renderDayStatsIntoMock.mockClear();
  document.body.innerHTML = '';
});

describe('Tournament Matches panel — all rounds', () => {
  it.each([false, true])('shows every round first-to-last by default without round navigation (completed: %s)', (isCompleted) => {
    const container = renderAs('Zed', makeTournament({ isCompleted }));

    expect(container.querySelectorAll('.match-card')).toHaveLength(6);
    expect(roundTitles(container)).toEqual(['Round 1', 'Round 2', 'Round 3']);
    expect(cardScores(container)).toEqual(['15-10', '14-11', '13-12', '16-9', '18-7', 'none']);
    expect(container.querySelector('.page-header').textContent).toContain('3 rounds');
    expect(container.querySelector('#prev-round')).toBeNull();
    expect(container.querySelector('#next-round')).toBeNull();
  });

  it('flips to last round first and back; active option has aria-pressed', () => {
    const container = renderAs('Zed');

    expect(container.querySelector('#matches-order [data-order="asc"]').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('#matches-order [data-order="desc"]').getAttribute('aria-pressed')).toBe('false');

    clickOrder(container, 'desc');
    expect(roundTitles(container)).toEqual(['Round 3', 'Round 2', 'Round 1']);
    expect(cardScores(container)).toEqual(['18-7', 'none', '13-12', '16-9', '15-10', '14-11']);
    expect(container.querySelector('#matches-order [data-order="desc"]').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('#matches-order [data-order="asc"]').getAttribute('aria-pressed')).toBe('false');

    clickOrder(container, 'asc');
    expect(roundTitles(container)).toEqual(['Round 1', 'Round 2', 'Round 3']);
    expect(cardScores(container)).toEqual(['15-10', '14-11', '13-12', '16-9', '18-7', 'none']);
    expect(container.querySelector('#matches-order [data-order="asc"]').getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('#matches-order [data-order="desc"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('resets to first round first when the tournament is reopened', () => {
    const container = renderAs('Zed');
    clickOrder(container, 'desc');
    expect(roundTitles(container)).toEqual(['Round 3', 'Round 2', 'Round 1']);

    const reopened = renderAs('Zed');
    expect(roundTitles(reopened)).toEqual(['Round 1', 'Round 2', 'Round 3']);
    expect(reopened.querySelector('#matches-order [data-order="asc"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps court order inside each round in both directions', () => {
    const container = renderAs('Zed');
    const perRound = ['Court 1', 'Court 2', 'Court 1', 'Court 2', 'Court 1', 'Court 2'];

    expect(courtLabels(container)).toEqual(perRound);
    clickOrder(container, 'desc');
    expect(courtLabels(container)).toEqual(perRound);
  });

  it('shows a single round with its title and no order control', () => {
    const container = renderAs('Zed', makeTournament({ rounds: 1 }));

    expect(roundTitles(container)).toEqual(['Round 1']);
    expect(container.querySelectorAll('.match-card')).toHaveLength(2);
    expect(container.querySelector('[data-order]')).toBeNull();
    expect(container.querySelector('.page-header').textContent).toContain('1 round');
  });

  it('re-renders only the Matches panel when the order changes (leaderboard is not reloaded)', () => {
    Store.setMatches([{
      date: DATE,
      roundNumber: 1,
      team1Player1Name: 'Alice',
      team1Player2Name: 'Bob',
      team2Player1Name: 'Carol',
      team2Player2Name: 'Dave',
      scoreTeam1: 15,
      scoreTeam2: 10,
    }]);
    const container = renderAs('Zed');
    expect(renderDayStatsIntoMock).toHaveBeenCalledTimes(1);

    clickOrder(container, 'desc');

    expect(roundTitles(container)).toEqual(['Round 3', 'Round 2', 'Round 1']);
    expect(renderDayStatsIntoMock).toHaveBeenCalledTimes(1);
  });
});

describe('Tournament Matches panel — admin actions across rounds', () => {
  it('keeps End Tournament next to the latest round in both orders', () => {
    const container = renderAs('Mino');
    const cards = () => [...container.querySelectorAll('.match-card')];
    expect(cards()).toHaveLength(6);

    // First round first: round 3 cards are last (4,5) -> actions at the very end
    let end = container.querySelector('#end-tournament-btn');
    expect(end).not.toBeNull();
    expect(isBefore(cards()[5], end)).toBe(true);

    // Last round first: round 3 cards (0,1) -> actions -> round 2 cards (2,3)
    clickOrder(container, 'desc');
    end = container.querySelector('#end-tournament-btn');
    expect(end).not.toBeNull();
    expect(isBefore(cards()[1], end)).toBe(true);
    expect(isBefore(end, cards()[2])).toBe(true);
  });

  it('shows one edit warning, only to an admin on an in-progress tournament with 2+ rounds', () => {
    const warnings = (c) => (c.textContent.match(/Editing a previous round/g) || []).length;

    expect(warnings(renderAs('Mino'))).toBe(1);
    expect(warnings(renderAs('Zed'))).toBe(0);
    expect(warnings(renderAs('Mino', makeTournament({ isCompleted: true })))).toBe(0);
    expect(warnings(renderAs('Mino', makeTournament({ rounds: 1 })))).toBe(0);
  });

  it('opens the score sheet for the exact round and match that was clicked', () => {
    const container = renderAs('Mino');
    const cardWith = (score) => [...container.querySelectorAll('.match-card')].find(c => cardScore(c) === score);

    expect(cardWith('15-10'), 'round 1 / court 1 card').toBeDefined();
    cardWith('15-10').click();
    expect(document.querySelector('#score1').value).toBe('15');
    expect(document.querySelector('#score2').value).toBe('10');

    document.body.innerHTML = '';
    expect(cardWith('16-9'), 'round 2 / court 2 card').toBeDefined();
    cardWith('16-9').click();
    expect(document.querySelector('#score1').value).toBe('16');
    expect(document.querySelector('#score2').value).toBe('9');
  });
});

describe('Tournament Matches panel — round label on the left', () => {
  it('puts one round label left of the cards of each round, with no header row', () => {
    const container = renderAs('Zed');
    const sections = [...container.querySelectorAll('.round-section')];

    expect(sections).toHaveLength(3);
    expect(container.querySelector('.round-header')).toBeNull();
    sections.forEach(section => {
      expect(section.querySelectorAll('.round-title')).toHaveLength(1);
      expect(section.children[0].classList.contains('round-label')).toBe(true);
      expect(section.children[0].querySelector('.round-title')).not.toBeNull();
      expect(section.children[1].classList.contains('round-matches')).toBe(true);
      expect(section.children[1].querySelectorAll('.match-card')).toHaveLength(2);
    });
    expect(roundTitles(container)).toEqual(['Round 1', 'Round 2', 'Round 3']);
  });

  it('keeps one label per visible round next to its cards, also with a single round or a filter', () => {
    const labelOf = (s) => s.children[0].classList.contains('round-label') ? s.children[0].textContent.trim() : null;
    const single = renderAs('Zed', makeTournament({ rounds: 1 }));
    expect([...single.querySelectorAll('.round-section')].map(labelOf)).toEqual(['Round 1']);

    const filtered = renderAs('Zed');
    pickPlayer(filtered, 'Dave');
    const sections = [...filtered.querySelectorAll('.round-section')];
    expect(sections.map(labelOf)).toEqual(['Round 1', 'Round 2', 'Round 3']);
    sections.forEach(s => expect(s.children[1].querySelectorAll('.match-card')).toHaveLength(1));
  });
});

describe('Tournament Matches panel — one-line cards', () => {
  it('lays each match out as: court, team 1 players, score vs score, team 2 players', () => {
    const cards = [...renderAs('Zed').querySelectorAll('.match-card')];

    expect(cardTokens(cards[0])).toEqual(['Court 1', 'Alice', 'Bob', '15', 'vs', '10', 'Carol', 'Dave']);
    expect(cardTokens(cards[1])).toEqual(['Court 2', 'Eve', 'Frank', '14', 'vs', '11', 'Grace', 'Hank']);
    expect(cardTokens(cards[5])).toEqual(['Court 2', 'Carol', 'Grace', 'vs', 'Dave', 'Hank']);
  });

  it('shows the "Tap to score" hint in the score cell only to an admin', () => {
    const adminCards = [...renderAs('Mino').querySelectorAll('.match-card')];
    expect(cardTokens(adminCards[5])).toEqual(['Court 2', 'Carol', 'Grace', 'Tap to score', 'Dave', 'Hank']);
    expect(cardTokens(adminCards[4])).toEqual(['Court 1', 'Alice', 'Eve', '18', 'vs', '7', 'Bob', 'Frank']);
  });
});

describe('Tournament Matches panel — player filter', () => {
  it('lists All players plus every player of the day alphabetically, also with a single round', () => {
    const options = (c) => [...filterSelect(c).options].map(o => [o.value, o.textContent.trim()]);
    const expected = [
      ['', 'All players'],
      ['Alice', 'Alice'], ['Bob', 'Bob'], ['Carol', 'Carol'], ['Dave', 'Dave'],
      ['Eve', 'Eve'], ['Frank', 'Frank'], ['Grace', 'Grace'], ['Hank', 'Hank'],
    ];

    const container = renderAs('Zed');
    expect(options(container)).toEqual(expected);
    expect(filterSelect(container).value).toBe('');
    expect(options(renderAs('Zed', makeTournament({ rounds: 1 })))).toEqual(expected);
  });

  it('keeps only the matches of the picked player, in any seat, and restores all on All players', () => {
    const container = renderAs('Zed');

    pickPlayer(container, 'Dave'); // seat 4 in R1, seat 1 in R2, seat 3 in R3
    expect(roundTitles(container)).toEqual(['Round 1', 'Round 2', 'Round 3']);
    expect(cardScores(container)).toEqual(['15-10', '16-9', 'none']);
    expect(courtLabels(container)).toEqual(['Court 1', 'Court 2', 'Court 2']);

    pickPlayer(container, 'Frank');
    expect(cardScores(container)).toEqual(['14-11', '16-9', '18-7']);
    expect(courtLabels(container)).toEqual(['Court 2', 'Court 2', 'Court 1']);

    pickPlayer(container, '');
    expect(container.querySelectorAll('.match-card')).toHaveLength(6);
    expect(filterSelect(container).value).toBe('');
  });

  it('highlights the picked player name in every visible card', () => {
    const highlighted = (c) => [...c.querySelectorAll('.match-card')].map(card => {
      const hits = [...card.querySelectorAll('.match-team-name.is-filtered-player')];
      const names = [...card.querySelectorAll('.match-team-name')];
      return hits.map(h => `${h.textContent.trim()}@${names.indexOf(h)}`).join('|');
    });
    const container = renderAs('Zed');
    expect(container.querySelectorAll('.is-filtered-player')).toHaveLength(0);

    pickPlayer(container, 'Dave');
    expect(highlighted(container)).toEqual(['Dave@3', 'Dave@0', 'Dave@2']);

    pickPlayer(container, 'Frank');
    clickOrder(container, 'desc');
    expect(highlighted(container)).toEqual(['Frank@3', 'Frank@1', 'Frank@1']);

    pickPlayer(container, '');
    expect(container.querySelectorAll('.is-filtered-player')).toHaveLength(0);

    const css = fs.readFileSync(path.resolve('css/pages.css'), 'utf8');
    expect(css).toMatch(/\.match-team-name\.is-filtered-player\s*\{[^}]*color:\s*var\(--color-primary\)/);
  });

  it('combines with the round order', () => {
    const container = renderAs('Zed');

    pickPlayer(container, 'Alice');
    expect(cardScores(container)).toEqual(['15-10', '13-12', '18-7']);

    clickOrder(container, 'desc');
    expect(cardScores(container)).toEqual(['18-7', '13-12', '15-10']);
    expect(filterSelect(container).value).toBe('Alice');
  });

  it('hides the rounds where the player sits out', () => {
    const container = renderAs('Zed', makeSitOutTournament());

    pickPlayer(container, 'Dave');
    expect(roundTitles(container)).toEqual(['Round 1', 'Round 3']);
    pickPlayer(container, 'Carol');
    expect(roundTitles(container)).toEqual(['Round 1', 'Round 2']);
  });

  it('scores the exact match that was clicked in a filtered list', () => {
    const container = renderAs('Mino');

    pickPlayer(container, 'Frank');
    const card = [...container.querySelectorAll('.match-card')].find(c => cardScore(c) === '14-11');
    expect(card, 'round 1 / court 2 card').toBeDefined();
    card.click();

    expect(document.querySelector('#score1').value).toBe('14');
    expect(document.querySelector('#score2').value).toBe('11');
  });

  it('keeps the admin actions when the filter hides the latest round', () => {
    const container = renderAs('Mino', makeSitOutTournament());

    pickPlayer(container, 'Carol'); // sits out round 3 = the latest round
    expect(roundTitles(container)).toEqual(['Round 1', 'Round 2']);
    expect(container.querySelectorAll('#end-tournament-btn')).toHaveLength(1);
    expect(container.querySelectorAll('#next-round-btn')).toHaveLength(1);
    const cards = container.querySelectorAll('.match-card');
    expect(isBefore(cards[cards.length - 1], container.querySelector('#end-tournament-btn'))).toBe(true);

    clickOrder(container, 'desc');
    expect(isBefore(container.querySelector('#end-tournament-btn'), container.querySelector('.round-section'))).toBe(true);
  });

  it('survives a full re-render and resets when the player disappears', () => {
    const container = renderAs('Zed');

    pickPlayer(container, 'Hank');
    State.emit('tournament-changed', null);
    expect(filterSelect(container).value).toBe('Hank');
    expect(container.querySelectorAll('.match-card')).toHaveLength(3);

    const renamed = JSON.parse(JSON.stringify(makeTournament()).replaceAll('Hank', 'Ivan'));
    Store.setActiveTournament(renamed);
    State.emit('tournament-changed', renamed);
    expect(filterSelect(container).value).toBe('');
    expect(container.querySelectorAll('.match-card')).toHaveLength(6);
  });

  it('re-renders only the Matches panel when the filter changes (leaderboard is not reloaded)', () => {
    Store.setMatches([{
      date: DATE,
      roundNumber: 1,
      team1Player1Name: 'Alice',
      team1Player2Name: 'Bob',
      team2Player1Name: 'Carol',
      team2Player2Name: 'Dave',
      scoreTeam1: 15,
      scoreTeam2: 10,
    }]);
    const container = renderAs('Zed');
    expect(renderDayStatsIntoMock).toHaveBeenCalledTimes(1);

    pickPlayer(container, 'Alice');

    expect(container.querySelectorAll('.match-card')).toHaveLength(3);
    expect(renderDayStatsIntoMock).toHaveBeenCalledTimes(1);
  });
});

describe('Tournament Matches panel — one shared grid for the whole list', () => {
  const listChildren = (c) => [...c.querySelectorAll('.round-list')].map(list =>
    [...list.children].map(el => el.classList.contains('round-section')
      ? `Round ${el.dataset.roundIdx * 1 + 1}`
      : el.classList.contains('round-actions') ? 'actions' : el.className));

  it('puts every round section in one .round-list, in display order', () => {
    expect(listChildren(renderAs('Zed'))).toEqual([['Round 1', 'Round 2', 'Round 3']]);
  });

  it('keeps the admin actions inside the list, right after the latest round', () => {
    const container = renderAs('Mino');
    expect(listChildren(container)).toEqual([['Round 1', 'Round 2', 'Round 3', 'actions']]);
    clickOrder(container, 'desc');
    expect(listChildren(container)).toEqual([['Round 3', 'actions', 'Round 2', 'Round 1']]);
  });

  it('keeps the warning outside the list', () => {
    const container = renderAs('Mino');
    expect(container.querySelector('.round-list').textContent).not.toContain('Editing a previous round');
    expect(container.querySelector('#tournament-content').textContent).toContain('Editing a previous round');
  });
});
