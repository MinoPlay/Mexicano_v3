import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cache } from '../../js/cache.js';
import { Store } from '../../js/store.js';
import * as supabase from '../../js/services/supabase.js';
import {
  pushCompletedTournament,
  pushDoodleNow,
  pushTournamentDayFile,
} from '../../js/services/backend.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const p = (name) => ({ name });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function tournament(overrides = {}) {
  return {
    tournamentDate: '2026-10-06',
    currentRoundNumber: 2,
    isCompleted: false,
    players: ['A', 'B', 'C', 'D'].map((name, i) => ({ id: i + 1, name })),
    rounds: [
      {
        roundNumber: 1,
        matches: [{ id: 1, player1: p('A'), player2: p('B'), player3: p('C'), player4: p('D'), team1Score: 15, team2Score: 10 }],
      },
      {
        roundNumber: 2,
        matches: [{ id: 1, player1: p('A'), player2: p('C'), player3: p('B'), player4: p('D'), team1Score: 0, team2Score: 0 }],
      },
    ],
    ...overrides,
  };
}

describe('backend mutations', () => {
  let invoke;

  beforeEach(() => {
    localStorage.clear();
    Cache.clear();
    vi.restoreAllMocks();
    vi.spyOn(supabase, 'invalidateReadCache').mockImplementation(() => {});
    invoke = vi.spyOn(supabase, 'invokeFunction').mockResolvedValue({ ok: true });
  });

  it('sends only the doodle entries of players changed by this save', async () => {
    Store.setDoodle('2026-10', [
      { name: 'Alice', selectedDates: ['2026-10-06'] },
      { name: 'Bob', selectedDates: ['2026-10-08'] },
    ]);
    const changes = [{ playerName: 'Alice', yearMonth: '2026-10', selectedAdded: ['2026-10-06'], selectedRemoved: [] }];

    await pushDoodleNow('2026-10', changes);

    const { payload } = invoke.mock.calls[0][1];
    expect(payload.entries).toEqual([{ name: 'Alice', selectedDates: ['2026-10-06'] }]);
    expect(payload.changes).toEqual(changes);
  });

  it('sends an empty entry for a changed player whose doodle row was removed', async () => {
    Store.setDoodle('2026-10', [{ name: 'Bob', selectedDates: ['2026-10-08'] }]);

    await pushDoodleNow('2026-10', [{ playerName: 'Alice', selectedAdded: [], selectedRemoved: ['2026-10-06'] }]);

    expect(invoke.mock.calls[0][1].payload.entries).toEqual([{ name: 'Alice', selectedDates: [] }]);
  });

  it('persists every generated round match, including unplayed ones, from tournament.rounds', async () => {
    Store.setMatches([]);

    await pushTournamentDayFile(tournament());

    const { payload } = invoke.mock.calls[0][1];
    expect(payload.matches).toEqual([
      { match_date: '2026-10-06', round_number: 1, match_order: 1, score_team_1: 15, score_team_2: 10 },
      { match_date: '2026-10-06', round_number: 2, match_order: 2, score_team_1: 0, score_team_2: 0 },
    ]);
    expect(payload.match_players.filter((row) => row.round_number === 2).map((row) => row.player_name))
      .toEqual(['A', 'C', 'B', 'D']);
  });

  it('writes incomplete partial scores as 0-0 so they never count in stats', async () => {
    const t = tournament();
    t.rounds[1].matches[0].team1Score = 7;

    await pushTournamentDayFile(t);

    const round2 = invoke.mock.calls[0][1].payload.matches.find((m) => m.round_number === 2);
    expect(round2).toMatchObject({ score_team_1: 0, score_team_2: 0 });
  });

  it('still serializes explicit day matches for completed-tournament pushes', async () => {
    const dayMatches = [{
      date: '2026-10-06', roundNumber: 1,
      team1Player1Name: 'A', team1Player2Name: 'B', team2Player1Name: 'C', team2Player2Name: 'D',
      scoreTeam1: 13, scoreTeam2: 12,
    }];

    await pushCompletedTournament('2026-10-06', dayMatches, { isComplete: true });

    expect(invoke.mock.calls[0][1].payload.matches).toEqual([
      { match_date: '2026-10-06', round_number: 1, match_order: 1, score_team_1: 13, score_team_2: 12 },
    ]);
  });

  it('serializes tournament writes per date and coalesces queued states to the latest', async () => {
    const first = deferred();
    invoke.mockReset();
    invoke.mockImplementationOnce(() => first.promise).mockResolvedValue({ ok: true });

    const scores = (s) => {
      const t = tournament();
      t.rounds[0].matches[0].team1Score = s;
      t.rounds[0].matches[0].team2Score = 25 - s;
      return t;
    };
    const w1 = pushTournamentDayFile(scores(10));
    await tick();
    const w2 = pushTournamentDayFile(scores(11));
    const w3 = pushTournamentDayFile(scores(12));
    await tick();

    expect(invoke).toHaveBeenCalledTimes(1);
    first.resolve({ ok: true });
    await Promise.all([w1, w2, w3]);

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1].payload.matches[0].score_team_1).toBe(12);
  });

  it('keeps writing queued state after an earlier tournament write fails', async () => {
    const first = deferred();
    invoke.mockReset();
    invoke.mockImplementationOnce(() => first.promise).mockResolvedValue({ ok: true });

    const w1 = pushTournamentDayFile(tournament({ tournamentDate: '2026-10-08' }));
    await tick();
    const w2 = pushTournamentDayFile(tournament({ tournamentDate: '2026-10-08', currentRoundNumber: 3 }));
    first.reject(new Error('boom'));

    await expect(w1).rejects.toThrow('boom');
    await expect(w2).resolves.toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
