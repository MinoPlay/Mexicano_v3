import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cache } from '../../js/cache.js';
import { Store } from '../../js/store.js';
import * as supabase from '../../js/services/supabase.js';
import * as backend from '../../js/services/backend.js';

const PLAYERS = [
  { id: 'p1', name: 'A', email: null, match_padel_id: 11 },
  { id: 'p2', name: 'B', email: null, match_padel_id: null },
  { id: 'p3', name: 'C', email: null, match_padel_id: null },
  { id: 'p4', name: 'D', email: null, match_padel_id: null },
];

const INDEX = [
  { id: 't-jul', tournament_date: '2026-07-30', status: 'completed', player_count: 4, round_count: 1, match_count: 1, completed_count: 1 },
  { id: 't-aug', tournament_date: '2026-08-27', status: 'completed', player_count: 4, round_count: 1, match_count: 1, completed_count: 1 },
  { id: 't-sep', tournament_date: '2026-09-24', status: 'completed', player_count: 4, round_count: 1, match_count: 1, completed_count: 1 },
];

const slots = [
  { player_id: 'p1', team: 1, position: 1 },
  { player_id: 'p2', team: 1, position: 2 },
  { player_id: 'p3', team: 2, position: 1 },
  { player_id: 'p4', team: 2, position: 2 },
];

const MATCHES = {
  '2026-08-27': { id: 'm-aug', tournament_id: 't-aug', round_number: 1, match_order: 1, score_team_1: 13, score_team_2: 12, match_players: slots, tournaments: { tournament_date: '2026-08-27' } },
  '2026-09-24': { id: 'm-sep', tournament_id: 't-sep', round_number: 1, match_order: 1, score_team_1: 13, score_team_2: 10, match_players: slots, tournaments: { tournament_date: '2026-09-24' } },
};

const ELO_ROWS = [
  { player_id: 'p1', tournament_date: '2026-08-27', elo: 1016, previous_elo: 1000 },
  { player_id: 'p3', tournament_date: '2026-08-27', elo: 984.74, previous_elo: 1000 },
  { player_id: 'p1', tournament_date: '2026-09-24', elo: 1030.56, previous_elo: 1016 },
  { player_id: 'p3', tournament_date: '2026-09-24', elo: 970.84, previous_elo: 984.74 },
];

// Precomputed server-side (supabase/migrations/20261006090000_precomputed_home_summaries.sql).
const MONTHLY_ROWS = [
  { year_month: '2026-08', player_id: 'p1', wins: 1, losses: 0, points: 13, games: 1, average: 13, elo: 1016 },
  { year_month: '2026-08', player_id: 'p3', wins: 0, losses: 1, points: 12, games: 1, average: 12, elo: 984.74 },
  { year_month: '2026-09', player_id: 'p1', wins: 1, losses: 0, points: 13, games: 1, average: 13, elo: 1030.56 },
  { year_month: '2026-09', player_id: 'p3', wins: 0, losses: 1, points: 10, games: 1, average: 10, elo: 970.84 },
];

function eqValue(url, column) {
  const match = decodeURIComponent(url).match(new RegExp(`${column}=eq\\.([^&]*)`));
  return match ? match[1] : null;
}

function inList(url, column) {
  const match = decodeURIComponent(url).match(new RegExp(`${column}=in\\.\\(([^)]*)\\)`));
  return match ? match[1].split(',') : null;
}

function respond(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function backendMock(overrides = {}) {
  return vi.fn(async (url, options = {}) => {
    for (const [fragment, handler] of Object.entries(overrides)) {
      if (url.includes(fragment)) return handler(url, options);
    }
    if (url.includes('/rest/v1/players?')) return respond(PLAYERS);
    if (url.includes('/rest/v1/tournament_index?')) return respond(INDEX);
    if (url.includes('/rest/v1/tournaments?')) return respond([]);
    if (url.includes('/rest/v1/matches?')) {
      const dates = inList(url, 'tournaments.tournament_date') || [];
      return respond(dates.map((date) => MATCHES[date]).filter(Boolean));
    }
    if (url.includes('/rest/v1/rpc/get_player_elo')) {
      const body = JSON.parse(options.body || '{}');
      return respond(ELO_ROWS.filter((row) =>
        (!body.p_dates || body.p_dates.includes(row.tournament_date))
        && (!body.p_player_ids || body.p_player_ids.includes(row.player_id))));
    }
    if (url.includes('/rest/v1/player_monthly_summary?')) {
      const months = inList(url, 'year_month') || [];
      return respond(MONTHLY_ROWS.filter((row) => months.includes(row.year_month)));
    }
    if (url.includes('/rest/v1/player_tournament_elo?')) {
      const date = eqValue(url, 'tournament_date');
      const dates = inList(url, 'tournament_date');
      const ids = inList(url, 'player_id');
      return respond(ELO_ROWS.filter((row) =>
        (!date || row.tournament_date === date)
        && (!dates || dates.includes(row.tournament_date))
        && (!ids || ids.includes(row.player_id))));
    }
    if (url.includes('/rest/v1/player_current_elo?')) {
      return respond([
        { player_id: 'p1', tournament_date: '2026-09-24', elo: 1030.56, previous_elo: 1016 },
      ]);
    }
    if (url.includes('/rest/v1/player_totals_summary?')) {
      return respond([{ player_id: 'p1', wins: 2, losses: 1, points: 36, games: 3, tournaments: 2 }]);
    }
    if (url.includes('/rest/v1/rpc/get_current_elo')) {
      return respond([
        { player_id: 'p1', tournament_date: '2026-09-24', elo: 1030.56, previous_elo: 1016 },
      ]);
    }
    if (url.includes('/rest/v1/player_totals?')) {
      return respond([{ player_id: 'p1', wins: 2, losses: 1, points: 36, games: 3, tournaments: 2 }]);
    }
    if (url.includes('/rest/v1/player_attendance?')) {
      return respond([
        { tournament_date: '2026-08-27', player_id: 'p1' },
        { tournament_date: '2026-08-27', player_id: 'p2' },
        { tournament_date: '2026-09-24', player_id: 'p1' },
      ]);
    }
    if (url.includes('/rest/v1/attendance_records?')) {
      return respond([{ id: 'a1', attendance_date: '2026-09-10', note: '', attendance_players: [{ player_id: 'p4' }] }]);
    }
    if (url.includes('/rest/v1/doodle_availability?')) {
      return respond([{ availability_date: '2026-09-29', player_id: 'p2' }]);
    }
    if (url.includes('/rest/v1/doodle_changelog?')) return respond([]);
    return respond([]);
  });
}

const urls = () => fetch.mock.calls.map(([url]) => decodeURIComponent(url));
const requested = (fragment) => urls().filter((url) => url.includes(fragment));

describe('route-scoped Supabase reads', () => {
  beforeEach(() => {
    localStorage.clear();
    Cache.clear();
    vi.restoreAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-25T08:00:00'));
    Store.setSupabaseConfig({ url: 'https://example.supabase.co', anonKey: 'anon' });
    Store.setSupabaseSession({ access_token: 'access', refresh_token: 'refresh', expires_at: 9999999999 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('Home reads precomputed month summaries and latest-day ELO, never replays ELO or loads month matches', async () => {
    vi.stubGlobal('fetch', backendMock());

    await supabase.pullForRoute('#/');

    const matchUrls = requested('/rest/v1/matches?');
    expect(matchUrls).toHaveLength(1);
    expect(inList(matchUrls[0], 'tournaments.tournament_date')).toEqual(['2026-09-24']);
    expect(requested('/rpc/get_player_elo')).toHaveLength(0);
    const summaryUrls = requested('/rest/v1/player_monthly_summary?');
    expect(summaryUrls).toHaveLength(1);
    expect(inList(summaryUrls[0], 'year_month').sort()).toEqual(['2026-08', '2026-09']);
    const eloUrls = requested('/rest/v1/player_tournament_elo?');
    expect(eloUrls).toHaveLength(1);
    expect(eqValue(eloUrls[0], 'tournament_date')).toBe('2026-09-24');
    expect(requested('/rest/v1/tournament_index?')).toHaveLength(1);
    for (const table of ['doodle_availability', 'doodle_changelog', 'attendance_records', 'player_attendance', 'player_totals']) {
      expect(requested(`/rest/v1/${table}?`)).toHaveLength(0);
    }

    expect(Store.getTournamentsIndex().at(-1)).toEqual({
      date: '2026-09-24', playerCount: 4, roundCount: 1, matchCount: 1, completedCount: 1, isComplete: true,
    });
    expect(Cache.get('home_matches').map((m) => m.date)).toEqual(['2026-09-24']);
    expect(Cache.get('home_players_summary')).toEqual([
      expect.objectContaining({ name: 'A', elo: 1030.56, previousElo: 1016 }),
      expect.objectContaining({ name: 'C', elo: 970.84, previousElo: 984.74 }),
    ]);
    expect(Store.getMonthlyOverview('2026-09')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'A', wins: 1, totalPoints: 13, elo: 1030.56 }),
      expect.objectContaining({ name: 'C', wins: 0, totalPoints: 10, elo: 970.84 }),
    ]));
    expect(Store.getMonthlyOverview('2026-08')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'A', wins: 1, totalPoints: 13, average: 13, elo: 1016 }),
      expect.objectContaining({ name: 'C', wins: 0, losses: 1, totalPoints: 12, elo: 984.74 }),
    ]));

    const before = fetch.mock.calls.length;
    await supabase.pullForRoute('#/');
    await backend.ensureDayMatchesLoaded('2026-09-24');
    expect(fetch.mock.calls.length).toBe(before);
  });

  it('Home falls back to match + ELO replay when the summary tables are not migrated yet', async () => {
    const missing = () => respond({ code: 'PGRST205', message: 'missing' }, { status: 404 });
    vi.stubGlobal('fetch', backendMock({
      '/rest/v1/player_monthly_summary?': missing,
      '/rest/v1/player_tournament_elo?': missing,
    }));

    await supabase.pullForRoute('#/');

    expect(Cache.has('supabase_snapshot_loaded')).toBe(false);
    const eloCalls = fetch.mock.calls.filter(([url]) => url.includes('/rpc/get_player_elo'));
    expect(eloCalls).toHaveLength(1);
    expect(JSON.parse(eloCalls[0][1].body).p_dates.sort()).toEqual(['2026-08-27', '2026-09-24']);
    expect(Store.getMonthlyOverview('2026-09')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'A', wins: 1, totalPoints: 13, elo: 1030.56 }),
    ]));
    expect(Cache.get('home_players_summary')).toEqual([
      expect.objectContaining({ name: 'A', elo: 1030.56, previousElo: 1016 }),
      expect.objectContaining({ name: 'C', elo: 970.84, previousElo: 984.74 }),
    ]);
  });

  it('Home builds month overview from the already fetched match and ELO batches instead of reloading the same month', async () => {
    vi.stubGlobal('fetch', backendMock());
    await supabase.pullForRoute('#/');

    const overview = supabase.buildMonthOverviewFromMatches('2026-09', Store.getMatches(), {
      '2026-09-24': { A: { elo: 1030.56, previousElo: 1016 }, C: { elo: 970.84, previousElo: 984.74 } },
    });

    expect(overview).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'A', elo: 1030.56, wins: 1 }),
      expect.objectContaining({ name: 'C', elo: 970.84, wins: 0 }),
    ]));
    expect(Store.getMonthlyOverview('2026-09')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'A', elo: 1030.56 }),
      expect.objectContaining({ name: 'C', elo: 970.84 }),
    ]));
  });

  it('Home merges its days into already loaded matches instead of replacing them', async () => {
    const older = { date: '2025-01-02', team1Player1Name: 'X', team1Player2Name: 'Y', team2Player1Name: 'Z', team2Player2Name: 'W', scoreTeam1: 13, scoreTeam2: 5 };
    Store.setMatches([older]);
    vi.stubGlobal('fetch', backendMock());

    await supabase.pullForRoute('#/');

    expect(Store.getMatches().map((m) => m.date)).toEqual(['2025-01-02', '2026-09-24']);
  });

  it('Home requests players, index, active tournament and month summaries concurrently', async () => {
    const started = [];
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const base = backendMock();
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      started.push(url);
      if (/\/rest\/v1\/(players|tournament_index|tournaments)\?/.test(url)) await gate;
      return base(url, options);
    }));

    const pending = supabase.pullForRoute('#/');
    await vi.waitFor(() => expect(started.length).toBe(4));
    expect(started.some((url) => url.includes('/rest/v1/player_monthly_summary?'))).toBe(true);
    expect(started.some((url) => url.includes('/rest/v1/players?'))).toBe(true);
    expect(started.some((url) => url.includes('/rest/v1/tournament_index?'))).toBe(true);
    expect(started.find((url) => url.includes('/rest/v1/tournaments?'))).toContain('status=in.(planned,active)');
    release();
    await pending;
  });

  it('Tournaments list only reads the server-side tournament index', async () => {
    vi.stubGlobal('fetch', backendMock());

    await supabase.pullForRoute('#/tournaments');
    await backend.fetchTournamentsIndexPublic();

    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toContain('/rest/v1/tournament_index?');
    expect(Store.getTournamentsIndex()).toHaveLength(3);
  });

  it('Tournament detail loads one day plus roster, summary and index', async () => {
    vi.stubGlobal('fetch', backendMock());

    await supabase.pullForRoute('#/tournament/2026-09-24');

    const matchUrls = requested('/rest/v1/matches?');
    expect(matchUrls).toHaveLength(1);
    expect(inList(matchUrls[0], 'tournaments.tournament_date')).toEqual(['2026-09-24']);
    expect(requested('/rest/v1/tournaments?')).toEqual([expect.stringContaining('status=in.(planned,active)')]);
    expect(requested('/rest/v1/player_totals_summary?')).toHaveLength(1);
    expect(requested('/rest/v1/player_totals?')).toHaveLength(0);
    expect(requested('/rpc/get_current_elo')).toHaveLength(0);
    expect(Store.getMatches()).toEqual([expect.objectContaining({ date: '2026-09-24', team1Player1Name: 'A' })]);
    expect(requested('/rest/v1/doodle_availability?')).toHaveLength(0);
  });

  it('Statistics reads precomputed totals and current ELO, never replays ELO or scans matches', async () => {
    vi.stubGlobal('fetch', backendMock());

    await supabase.pullForRoute('#/statistics');

    expect(Store.getPlayersSummary()[0]).toEqual({
      id: 'p1', name: 'A', email: null, matchPadelId: 11,
      elo: 1030.56, previousElo: 1016,
      wins: 2, losses: 1, points: 36, average: 12, tournaments: 2,
    });
    expect(Store.getPlayersSummary()[1]).toMatchObject({ name: 'B', elo: 1000, previousElo: 1000, wins: 0, average: 0 });
    expect(requested('/rest/v1/player_totals_summary?')).toHaveLength(1);
    expect(requested('/rest/v1/player_current_elo?')).toHaveLength(1);
    expect(requested('/rest/v1/player_totals?')).toHaveLength(0);
    expect(requested('/rpc/get_current_elo')).toHaveLength(0);
    // Only the latest tournament day (default "Latest" filter) is fetched.
    const matchUrls = requested('/rest/v1/matches?');
    expect(matchUrls).toHaveLength(1);
    expect(inList(matchUrls[0], 'tournaments.tournament_date')).toEqual(['2026-09-24']);
    expect(requested('/rpc/get_player_elo')).toHaveLength(0);
  });

  it('Statistics falls back to player_totals + get_current_elo when summaries are not migrated', async () => {
    const missing = () => respond({ code: 'PGRST205', message: 'missing' }, { status: 404 });
    vi.stubGlobal('fetch', backendMock({
      '/rest/v1/player_totals_summary?': missing,
      '/rest/v1/player_current_elo?': missing,
    }));

    await supabase.pullForRoute('#/statistics');

    expect(Cache.has('supabase_snapshot_loaded')).toBe(false);
    expect(requested('/rest/v1/player_totals?')).toHaveLength(1);
    expect(requested('/rpc/get_current_elo')).toHaveLength(1);
    expect(Store.getPlayersSummary()[0]).toMatchObject({ name: 'A', elo: 1030.56, previousElo: 1016, wins: 2, points: 36 });
  });

  it('Statistics attendance months read player_attendance for that range only', async () => {
    vi.stubGlobal('fetch', backendMock());

    const raw = await backend.pullMonthlyOverviewRaw('2026-08');

    expect(raw).toEqual([
      { Name: 'A', ELO: [{ Date: '2026-08-27' }] },
      { Name: 'B', ELO: [{ Date: '2026-08-27' }] },
    ]);
    const attendanceUrls = requested('/rest/v1/player_attendance?');
    expect(attendanceUrls).toHaveLength(1);
    expect(attendanceUrls[0]).toContain('tournament_date=gte.2026-08-01');
    expect(attendanceUrls[0]).toContain('tournament_date=lt.2026-09-01');
    expect(requested('/rest/v1/matches?')).toHaveLength(0);
  });

  it('Attendance loads participation and manual records, never matches', async () => {
    vi.stubGlobal('fetch', backendMock());

    await supabase.pullForRoute('#/attendance');

    expect(requested('/rest/v1/matches?')).toHaveLength(0);
    expect(requested('/rest/v1/player_attendance?')[0]).not.toContain('tournament_date=gte');
    expect(Store.getParticipation()).toEqual([
      { date: '2026-08-27', players: ['A', 'B'] },
      { date: '2026-09-24', players: ['A'] },
    ]);
    expect(Store.getManualAttendance()).toEqual([{ date: '2026-09-10', players: ['D'], note: '' }]);
  });

  it('Doodle loads only the viewed month of availability and changelog', async () => {
    vi.stubGlobal('fetch', backendMock());

    await supabase.pullForRoute('#/doodle');

    const availability = requested('/rest/v1/doodle_availability?');
    expect(availability).toHaveLength(1);
    expect(availability[0]).toContain('availability_date=gte.2026-09-01');
    expect(availability[0]).toContain('availability_date=lt.2026-10-01');
    expect(requested('/rest/v1/doodle_changelog?')[0]).toContain('year_month=eq.2026-09');
    expect(Store.getDoodle('2026-09')).toEqual([{ name: 'B', selectedDates: ['2026-09-29'] }]);
    const matchUrls = requested('/rest/v1/matches?');
    expect(matchUrls).toHaveLength(1);
    expect(inList(matchUrls[0], 'tournaments.tournament_date')).toEqual(['2026-09-24']);
    expect(requested('/rpc/get_player_elo')).toHaveLength(0);
    const eloUrls = requested('/rest/v1/player_tournament_elo?');
    expect(eloUrls).toHaveLength(1);
    expect(inList(eloUrls[0], 'tournament_date')).toEqual(['2026-09-24']);
    expect(Store.getMonthlyOverview('2026-09')).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'A', elo: 1030.56 }),
    ]));
  });

  it('Create tournament reads recent participation, not matches', async () => {
    vi.stubGlobal('fetch', backendMock());

    await supabase.pullForRoute('#/create-tournament');

    expect(requested('/rest/v1/matches?')).toHaveLength(0);
    expect(requested('/rest/v1/player_attendance?')[0]).toContain('tournament_date=gte.2026-08-01');
    const { getRecentMembers } = await import('../../js/services/members.js');
    expect(getRecentMembers()).toEqual(['A', 'B']);
  });

  it('Create tournament loads the roster so members work without recent games', async () => {
    vi.stubGlobal('fetch', backendMock());

    await supabase.pullForRoute('#/create-tournament');

    expect(requested('/rest/v1/players?')).toHaveLength(1);
    expect(Store.getMembers().length).toBeGreaterThan(0);
  });

  it('ELO history reads precomputed per-player rows, never the replay RPC', async () => {
    vi.stubGlobal('fetch', backendMock());

    const result = await backend.pullEloHistoryForPlayerIds(['p1', 'p2']);

    expect(requested('/rest/v1/matches?')).toHaveLength(0);
    expect(requested('/rpc/get_player_elo')).toHaveLength(0);
    const eloUrls = requested('/rest/v1/player_tournament_elo?');
    expect(eloUrls).toHaveLength(1);
    expect(inList(eloUrls[0], 'player_id')).toEqual(['p1', 'p2']);
    expect(result).toEqual({ loadedPlayerIds: ['p1'], missingPlayerIds: ['p2'] });
    expect(Cache.get('elo_history_player_p1')).toEqual({
      playerId: 'p1',
      playerName: 'A',
      points: [
        { date: '2026-08-27', elo: 1016, delta: 16 },
        { date: '2026-09-24', elo: 1030.56, delta: 14.6 },
      ],
    });

    const before = fetch.mock.calls.length;
    await backend.pullEloHistoryForPlayerIds(['p1', 'p2']);
    expect(fetch.mock.calls.length).toBe(before);
  });

  it('ELO history falls back to the replay RPC when the table is not migrated', async () => {
    vi.stubGlobal('fetch', backendMock({
      '/rest/v1/player_tournament_elo?': () => respond({ code: 'PGRST205', message: 'missing' }, { status: 404 }),
    }));

    await backend.pullEloHistoryForPlayerIds(['p1']);

    const call = fetch.mock.calls.find(([url]) => url.includes('/rpc/get_player_elo'));
    expect(JSON.parse(call[1].body)).toEqual({ p_player_ids: ['p1'] });
    expect(Cache.get('elo_history_player_p1').points).toHaveLength(2);
    expect(Cache.has('supabase_snapshot_loaded')).toBe(false);
  });

  it('falls back to the full snapshot when the migration is not applied yet', async () => {
    vi.stubGlobal('fetch', backendMock({
      '/rest/v1/tournament_index?': () => respond({ code: 'PGRST205', message: 'missing' }, { status: 404 }),
      '/rest/v1/matches?': () => respond([]),
    }));

    await expect(supabase.pullForRoute('#/tournaments')).resolves.toBe(true);

    expect(Cache.has('supabase_snapshot_loaded')).toBe(true);
    expect(requested('/rest/v1/matches?')[0]).not.toContain('tournaments.tournament_date');
  });

  it('fetches remaining pages in parallel once the total is known', async () => {
    const ranges = [];
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      const range = options.headers.Range;
      ranges.push(range);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      inFlight -= 1;
      const start = Number(range.split('-')[0]);
      const size = Math.min(1000, 2500 - start);
      return respond(Array.from({ length: size }, (_, i) => ({ n: start + i })), {
        headers: { 'content-range': `${start}-${start + size - 1}/2500` },
      });
    }));

    const rows = await supabase.selectAll('player_attendance', 'select=*');

    expect(rows).toHaveLength(2500);
    expect(rows.at(-1)).toEqual({ n: 2499 });
    expect(ranges).toEqual(['0-999', '1000-1999', '2000-2999']);
    expect(fetch.mock.calls[0][1].headers.Prefer).toBe('count=exact');
    expect(maxInFlight).toBe(2);
  });

  it('shares one session refresh across concurrent requests', async () => {
    Store.setSupabaseSession({ access_token: 'old', refresh_token: 'refresh', expires_at: 1 });
    const base = backendMock();
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      if (url.includes('/auth/v1/token')) {
        return respond({ access_token: 'new', refresh_token: 'r2', expires_at: 9999999999 });
      }
      return base(url, options);
    }));

    await supabase.pullForRoute('#/');

    expect(requested('/auth/v1/token')).toHaveLength(1);
  });

  it('invalidates route data after a mutation so the next visit reloads it', async () => {
    vi.stubGlobal('fetch', backendMock({
      '/functions/v1/domain-mutation': () => respond({ ok: true }),
    }));
    await supabase.pullForRoute('#/tournaments');

    await backend.pushDoodleNow('2026-09', []);
    await supabase.pullForRoute('#/tournaments');

    expect(requested('/rest/v1/tournament_index?')).toHaveLength(2);
  });
});
