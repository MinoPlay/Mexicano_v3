/**
 * End Tournament progress steps.
 *
 * The dialog must reach a terminal state for EVERY awaited operation. The Web
 * Push relay used to be awaited after the last visible step, so a stalled relay
 * left the dialog on "Working…" with all steps green and no explanation.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  pushCompletedTournament: vi.fn(async (_date, _matches, _entry, opts = {}) => {
    opts.onStep?.('push', 'running');
    opts.onStep?.('push', 'success');
    opts.onStep?.('index', 'running');
    opts.onStep?.('index', 'success');
  }),
  sendTournamentCompletedAlert: vi.fn().mockResolvedValue(undefined),
  sendTournamentCompletedPush: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../js/services/github.js', () => ({
  schedulePush: vi.fn(),
  cancelPendingSync: vi.fn(),
  flushPush: vi.fn().mockResolvedValue(undefined),
  updateTournamentIndexEntry: vi.fn().mockResolvedValue(undefined),
  markMatchDateDirty: vi.fn(),
  keyToPath: vi.fn().mockReturnValue(null),
  readFile: vi.fn().mockResolvedValue(null),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  pushTournamentDayFile: vi.fn().mockResolvedValue(true),
  pushCompletedTournament: mocks.pushCompletedTournament,
  readDayMatches: vi.fn(async () => []),
  ensureAllMatchesLoaded: vi.fn(async () => []),
  FAST_TIMEOUTS: [2000, 3000],
}));

vi.mock('../../js/services/telegram.js', () => ({
  sendTournamentCompletedAlert: mocks.sendTournamentCompletedAlert,
}));

vi.mock('../../js/services/push.js', () => ({
  sendTournamentCompletedPush: mocks.sendTournamentCompletedPush,
}));

vi.mock('../../js/services/local.js', () => ({
  writeTournamentDay: vi.fn().mockResolvedValue(undefined),
  writeTournamentsIndex: vi.fn().mockResolvedValue(undefined),
}));

function makeLocalStorage() {
  let store = {};
  return {
    getItem: (k) => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}
const ls = makeLocalStorage();
vi.stubGlobal('localStorage', ls);

import {
  createTournament,
  startTournament,
  setMatchScore,
  runTournamentCompletion,
  COMPLETION_STEPS,
} from '../../js/services/tournament.js';
import { Store } from '../../js/store.js';
import { State } from '../../js/state.js';

const DATE = '2025-06-08';

function makePlayedTournament() {
  const t = createTournament(DATE, ['Alice', 'Bob', 'Carol', 'Dave']);
  startTournament(t);
  setMatchScore(t, 1, 1, 15, 10);
  return t;
}

function record() {
  const steps = [];
  return { steps, report: (id, status) => steps.push(`${id}:${status}`) };
}

beforeEach(() => {
  ls.clear();
  State._listeners = {};
  Store.setPlayersSummaryCache([{ name: 'Alice', elo: 1000 }]);
  Store.setTournamentsIndex([]);
  Store.setMatches([]);
  mocks.sendTournamentCompletedAlert.mockReset();
  mocks.sendTournamentCompletedAlert.mockResolvedValue(undefined);
  mocks.sendTournamentCompletedPush.mockReset();
  mocks.sendTournamentCompletedPush.mockResolvedValue(undefined);
  mocks.pushCompletedTournament.mockClear();
});

describe('runTournamentCompletion', () => {
  it('declares a step for every awaited operation, including the push relay', () => {
    expect(COMPLETION_STEPS.map(s => s.id)).toEqual(['finalize', 'push', 'index', 'telegram', 'notify']);
  });

  it('reports every step as terminal on the happy path', async () => {
    const { steps, report } = record();
    await runTournamentCompletion(makePlayedTournament(), report);

    for (const id of ['finalize', 'push', 'index', 'telegram', 'notify']) {
      expect(steps).toContain(`${id}:success`);
    }
  });

  it('still sends the alerts when the GitHub sync fails, and marks the failed step', async () => {
    mocks.pushCompletedTournament.mockRejectedValueOnce(new Error('Request timed out after 2000ms'));
    const { steps, report } = record();

    await runTournamentCompletion(makePlayedTournament(), report);

    expect(steps).toContain('push:error');
    expect(mocks.sendTournamentCompletedAlert).toHaveBeenCalledTimes(1);
    expect(steps).toContain('telegram:success');
    expect(steps).toContain('notify:success');
  });

  it('marks notify as error when the push relay stalls, and never rejects', async () => {
    mocks.sendTournamentCompletedPush.mockRejectedValueOnce(new Error('Request timed out after 2000ms'));
    const { steps, report } = record();

    await expect(runTournamentCompletion(makePlayedTournament(), report)).resolves.toBeUndefined();
    expect(steps).toContain('notify:error');
  });

  it('marks telegram as error without blocking the push relay', async () => {
    mocks.sendTournamentCompletedAlert.mockRejectedValueOnce(new Error('Request timed out after 2000ms'));
    const { steps, report } = record();

    await runTournamentCompletion(makePlayedTournament(), report);

    expect(steps).toContain('telegram:error');
    expect(mocks.sendTournamentCompletedPush).toHaveBeenCalledTimes(1);
  });

  it('passes the already-computed matches to the push relay (no second ELO replay)', async () => {
    const { report } = record();
    await runTournamentCompletion(makePlayedTournament(), report);

    const [tournament, allMatches] = mocks.sendTournamentCompletedPush.mock.calls[0];
    expect(tournament.tournamentDate).toBe(DATE);
    expect(Array.isArray(allMatches)).toBe(true);
    expect(allMatches.some(m => m.date === DATE)).toBe(true);
  });
});
