import { describe, it, expect, vi } from 'vitest';

// supabase.js touches localStorage at import-time via store.js helpers.
function makeLocalStorage() {
  let store = {};
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}
vi.stubGlobal('localStorage', makeLocalStorage());

import { rowToMatch, matchToRow } from '../../js/services/supabase.js';

describe('supabase row <-> match converters', () => {
  it('round-trips a plain match (no ELO snapshot)', () => {
    const match = {
      date: '2024-03-10', roundNumber: 2, scoreTeam1: 15, scoreTeam2: 10,
      team1Player1Name: 'A', team1Player2Name: 'B',
      team2Player1Name: 'C', team2Player2Name: 'D',
    };
    expect(rowToMatch(matchToRow(match))).toEqual(match);
  });

  it('preserves optional ELO snapshot columns when present', () => {
    const row = {
      match_date: '2024-03-10', round_number: 1, score_team1: 13, score_team2: 12,
      team1_player1_name: 'A', team1_player2_name: 'B',
      team2_player1_name: 'C', team2_player2_name: 'D',
      team1_player1_elo: 1012.5, team2_player2_elo: 987.5,
      team1_player2_elo: null, team2_player1_elo: null,
    };
    const m = rowToMatch(row);
    expect(m.team1Player1Elo).toBe(1012.5);
    expect(m.team2Player2Elo).toBe(987.5);
    expect('team1Player2Elo' in m).toBe(false); // null dropped
    // matchToRow only re-emits present ELO fields
    const back = matchToRow(m);
    expect(back.team1_player1_elo).toBe(1012.5);
    expect('team1_player2_elo' in back).toBe(false);
  });

  it('defaults missing scores to 0 on the way to a row', () => {
    const row = matchToRow({
      date: '2024-03-10', roundNumber: 1,
      team1Player1Name: 'A', team1Player2Name: 'B',
      team2Player1Name: 'C', team2Player2Name: 'D',
    });
    expect(row.score_team1).toBe(0);
    expect(row.score_team2).toBe(0);
  });
});
