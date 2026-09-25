import { describe, expect, it } from 'vitest';

describe('Supabase ELO projection', () => {
  it('builds versioned, deterministic end-of-tournament snapshots', async () => {
    const projection = await import('../scripts/supabase/build-elo-projection.mjs').catch(() => null);
    expect(projection).not.toBeNull();

    const dataset = {
      matches: [
        {
          match_key: '2026-01-01:1:1',
          match_date: '2026-01-01',
          round_number: 1,
          match_order: 1,
          score_team_1: 13,
          score_team_2: 10,
        },
        {
          match_key: '2026-01-08:1:1',
          match_date: '2026-01-08',
          round_number: 1,
          match_order: 1,
          score_team_1: 0,
          score_team_2: 0,
        },
      ],
      match_players: [
        { match_key: '2026-01-01:1:1', team: 1, position: 1, player_name: 'A' },
        { match_key: '2026-01-01:1:1', team: 1, position: 2, player_name: 'B' },
        { match_key: '2026-01-01:1:1', team: 2, position: 1, player_name: 'C' },
        { match_key: '2026-01-01:1:1', team: 2, position: 2, player_name: 'D' },
        { match_key: '2026-01-08:1:1', team: 1, position: 1, player_name: 'A' },
        { match_key: '2026-01-08:1:1', team: 1, position: 2, player_name: 'B' },
        { match_key: '2026-01-08:1:1', team: 2, position: 1, player_name: 'C' },
        { match_key: '2026-01-08:1:1', team: 2, position: 2, player_name: 'D' },
      ],
    };

    expect(projection.buildEloProjection(dataset, 'mexicano-v1')).toEqual({
      calculation_version: 'mexicano-v1',
      source_match_count: 1,
      snapshots: [
        { tournament_date: '2026-01-01', player_name: 'A', previous_elo: 1000, elo: 1016, source_match_count: 1 },
        { tournament_date: '2026-01-01', player_name: 'B', previous_elo: 1000, elo: 1016, source_match_count: 1 },
        { tournament_date: '2026-01-01', player_name: 'C', previous_elo: 1000, elo: 984.74, source_match_count: 1 },
        { tournament_date: '2026-01-01', player_name: 'D', previous_elo: 1000, elo: 984.74, source_match_count: 1 },
      ],
    });
  });
});
