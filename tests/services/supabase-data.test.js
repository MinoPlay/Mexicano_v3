import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cache } from '../../js/cache.js';
import { Store } from '../../js/store.js';
import * as supabase from '../../js/services/supabase.js';

describe('Supabase domain hydration', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const key of Cache.keys()) Cache.del(key);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates existing Store shapes from normalized relational rows', () => {
    expect(typeof supabase.hydrateSupabaseDataset).toBe('function');

    supabase.hydrateSupabaseDataset({
      players: [
        { id: 'p1', name: 'A', email: null, match_padel_id: 1 },
        { id: 'p2', name: 'B', email: null, match_padel_id: 2 },
        { id: 'p3', name: 'C', email: null, match_padel_id: 3 },
        { id: 'p4', name: 'D', email: null, match_padel_id: 4 },
      ],
      tournaments: [{
        id: 't1',
        tournament_date: '2026-01-01',
        status: 'completed',
      }],
      matches: [{
        id: 'm1',
        tournament_id: 't1',
        round_number: 1,
        match_order: 1,
        score_team_1: 13,
        score_team_2: 10,
      }],
      match_players: [
        { match_id: 'm1', player_id: 'p1', team: 1, position: 1 },
        { match_id: 'm1', player_id: 'p2', team: 1, position: 2 },
        { match_id: 'm1', player_id: 'p3', team: 2, position: 1 },
        { match_id: 'm1', player_id: 'p4', team: 2, position: 2 },
      ],
      doodle_availability: [
        { availability_date: '2026-01-08', player_id: 'p1' },
      ],
      attendance_records: [{
        id: 'a1',
        attendance_date: '2026-01-08',
        note: 'Training',
      }],
      attendance_players: [{ attendance_id: 'a1', player_id: 'p2' }],
    });

    expect(Store.getMatches()).toEqual([{
      date: '2026-01-01',
      roundNumber: 1,
      scoreTeam1: 13,
      scoreTeam2: 10,
      team1Player1Name: 'A',
      team1Player2Name: 'B',
      team2Player1Name: 'C',
      team2Player2Name: 'D',
    }]);
    // ELO is calculated at runtime from matches; no elo_snapshots rows are provided.
    expect(Store.getPlayersSummary()[0]).toMatchObject({
      id: 'p1',
      name: 'A',
      elo: 1016,
      previousElo: 1000,
    });
    expect(Store.getPlayersSummary()[2]).toMatchObject({
      name: 'C',
      elo: 984.74,
      previousElo: 1000,
    });
    expect(Cache.get('elo_history_player_p3')).toEqual({
      playerId: 'p3',
      playerName: 'C',
      points: [{ date: '2026-01-01', elo: 984.74, delta: -15.3 }],
    });
    expect(Store.getTournamentsIndex()).toEqual([{
      date: '2026-01-01',
      playerCount: 4,
      roundCount: 1,
      matchCount: 1,
      completedCount: 1,
      isComplete: true,
    }]);
    expect(Store.getDoodle('2026-01')).toEqual([
      { name: 'A', selectedDates: ['2026-01-08'] },
    ]);
    expect(Store.getManualAttendance()).toEqual([
      { date: '2026-01-08', players: ['B'], note: 'Training' },
    ]);
    expect(Store.getMonthlyOverview('2026-01')).toEqual([
      expect.objectContaining({
        name: 'A',
        wins: 1,
        losses: 0,
        totalPoints: 13,
        average: 13,
        elo: 1016,
      }),
      expect.objectContaining({
        name: 'B',
        wins: 1,
        losses: 0,
        totalPoints: 13,
        average: 13,
      }),
      expect.objectContaining({
        name: 'C',
        wins: 0,
        losses: 1,
        totalPoints: 10,
        average: 10,
        elo: 984.74,
      }),
      expect.objectContaining({
        name: 'D',
        wins: 0,
        losses: 1,
        totalPoints: 10,
        average: 10,
      }),
    ]);
    expect(Cache.get('monthly_raw_2026-01')).toEqual([
      { Name: 'A', ELO: [{ Date: '2026-01-01' }] },
      { Name: 'B', ELO: [{ Date: '2026-01-01' }] },
      { Name: 'C', ELO: [{ Date: '2026-01-01' }] },
      { Name: 'D', ELO: [{ Date: '2026-01-01' }] },
    ]);
  });

  it('keeps inactive historical players in matches but excludes them from members', () => {
    supabase.hydrateSupabaseDataset({
      players: [
        { id: 'p1', name: 'Active A', active: true },
        { id: 'p2', name: 'Inactive B', active: false },
        { id: 'p3', name: 'Active C', active: true },
        { id: 'p4', name: 'Active D', active: true },
      ],
      tournaments: [{
        id: 't1',
        tournament_date: '2026-01-01',
        status: 'completed',
      }],
      matches: [{
        id: 'm1',
        tournament_id: 't1',
        round_number: 1,
        match_order: 1,
        score_team_1: 13,
        score_team_2: 10,
      }],
      match_players: [
        { match_id: 'm1', player_id: 'p1', team: 1, position: 1 },
        { match_id: 'm1', player_id: 'p2', team: 1, position: 2 },
        { match_id: 'm1', player_id: 'p3', team: 2, position: 1 },
        { match_id: 'm1', player_id: 'p4', team: 2, position: 2 },
      ],
    });

    expect(Store.getMatches()[0]).toMatchObject({
      team1Player1Name: 'Active A',
      team1Player2Name: 'Inactive B',
    });
    expect(Store.getMembers()).toEqual(['Active A', 'Active C', 'Active D']);
  });

  it('shares one embedded hydration batch across concurrent consumers', async () => {
    Store.setSupabaseConfig({ url: 'https://example.supabase.co', anonKey: 'anon' });
    Store.setSupabaseSession({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: 9999999999,
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => [],
      text: async () => '[]',
    })));

    await Promise.all([
      supabase.pullForRoute('#/__full__', { force: true }),
      supabase.pullForRoute('#/__full__', { force: true }),
      supabase.pullForRoute('#/__full__', { force: true }),
    ]);

    expect(fetch).toHaveBeenCalledTimes(6);
    const urls = fetch.mock.calls.map(([url]) => url);
    expect(urls.some((url) => url.includes('/rest/v1/match_players?'))).toBe(false);
    expect(urls.some((url) => url.includes('/rest/v1/tournament_players?'))).toBe(false);
    expect(urls.some((url) => url.includes('/rest/v1/attendance_players?'))).toBe(false);
    const playersUrl = urls.find((url) => url.includes('/rest/v1/players?'));
    expect(playersUrl).toContain('select=id,name,email,match_padel_id,active');
    expect(playersUrl).not.toContain('active=eq.true');
    expect(urls.find((url) => url.includes('/rest/v1/matches?')))
      .toContain('match_players(player_id,team,position)');
    expect(urls.find((url) => url.includes('/rest/v1/matches?')))
      .toContain('order=tournament_id.asc,round_number.asc,match_order.asc,id.asc');
  });

  it('loads only tournament-route resources and reuses the completed route hydration', async () => {
    Store.setSupabaseConfig({ url: 'https://example.supabase.co', anonKey: 'anon' });
    Store.setSupabaseSession({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: 9999999999,
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      json: async () => url.includes('/rest/v1/players?') ? [
        { id: 'p1', name: 'A', email: null, match_padel_id: null },
      ] : [],
      text: async () => '[]',
    })));

    await supabase.pullForRoute('#/tournament/2026-09-24');
    const firstVisitCalls = fetch.mock.calls.length;
    await supabase.pullForRoute('#/tournament/2026-09-24');

    expect(fetch).toHaveBeenCalledTimes(firstVisitCalls);
    const urls = fetch.mock.calls.map(([url]) => url);
    expect(urls.filter((url) => url.includes('/rest/v1/players?'))).toHaveLength(1);
    expect(urls.filter((url) => url.includes('/rest/v1/tournaments?'))).toHaveLength(1);
    expect(urls.filter((url) => url.includes('/rest/v1/matches?'))).toHaveLength(1);
    expect(urls.find((url) => url.includes('/rest/v1/matches?')))
      .toContain('tournaments!inner(tournament_date)');
    expect(urls.find((url) => url.includes('/rest/v1/matches?')))
      .toMatch(/tournaments\.tournament_date=(eq\.2026-09-24|in\.\(2026-09-24\))/);
    expect(urls.some((url) => url.includes('/rest/v1/elo_snapshots?'))).toBe(false);
    expect(urls.some((url) => url.includes('/rest/v1/doodle_availability?'))).toBe(false);
    expect(urls.some((url) => url.includes('/rest/v1/attendance_records?'))).toBe(false);
  });

  it('full hydration calculates ELO at runtime without reading elo_snapshots', async () => {
    Store.setSupabaseConfig({ url: 'https://example.supabase.co', anonKey: 'anon' });
    Store.setSupabaseSession({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: 9999999999,
    });
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({
      ok: true, status: 200, json: async () => [],
    })));

    await supabase.pullForRoute('#/__full__');

    const urls = fetch.mock.calls.map(([url]) => url);
    expect(urls.some((url) => url.includes('/rest/v1/matches?'))).toBe(true);
    expect(urls.some((url) => url.includes('/rest/v1/elo_snapshots?'))).toBe(false);
  });

  it.each(['#/logs', '#/settings'])('skips canonical hydration for %s', async (hash) => {
    Store.setSupabaseConfig({ url: 'https://example.supabase.co', anonKey: 'anon' });
    Store.setSupabaseSession({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: 9999999999,
    });
    vi.stubGlobal('fetch', vi.fn());

    await expect(supabase.pullForRoute(hash)).resolves.toBe(false);

    expect(fetch).not.toHaveBeenCalled();
  });
});
