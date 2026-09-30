import { Store } from '../store.js';
import { Cache } from '../cache.js';
import { calculatePlayerStatistics } from './statistics.js';
import { buildTournamentFromRows } from './tournament-shape.js';
import { getEloSnapshots } from './elo.js';
import { perfStart } from './perf.js';

const EXPIRY_SKEW_SECONDS = 30;
const snapshotPromises = new Map();

function getConfig() {
  const config = Store.getSupabaseConfig();
  if (!config?.url || !config?.anonKey) {
    throw new Error('Supabase backend is not configured');
  }
  return config;
}

function sessionIsUsable(session) {
  if (!session?.access_token) return false;
  if (!session.expires_at) return true;
  return Number(session.expires_at) > Math.floor(Date.now() / 1000) + EXPIRY_SKEW_SECONDS;
}

async function parseError(response, fallback) {
  const body = await response.json().catch(() => null);
  return body?.message || body?.error_description || body?.error || fallback;
}

// Error carrying the HTTP status and PostgREST/Postgres code, so callers can
// detect a missing view/function (migration not applied yet).
async function requestError(response, fallback) {
  const body = await response.json().catch(() => null);
  const error = new Error(body?.message || body?.error_description || body?.error || fallback);
  error.status = response.status;
  error.code = body?.code ?? null;
  return error;
}

function normalizeEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Enter a valid email address.');
  }
  return normalized;
}

export function captureAuthSessionFromUrl() {
  if (typeof window === 'undefined' || !window.location.hash) return false;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get('access_token');
  if (!accessToken) return false;

  const expiresIn = Number(params.get('expires_in') || 3600);
  Store.setSupabaseSession({
    access_token: accessToken,
    refresh_token: params.get('refresh_token') || '',
    token_type: params.get('token_type') || 'bearer',
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
  });
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
  return true;
}

async function fetchCurrentAuthUser(session) {
  const config = getConfig();
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.anonKey,
      Authorization: 'Bearer ' + session.access_token,
    },
  });
  if (!response.ok) {
    throw new Error(await parseError(response, `User session lookup failed (${response.status})`));
  }
  return response.json();
}

export async function syncAccessGrant(session = Store.getSupabaseSession()) {
  if (!session?.access_token) throw new Error('Supabase session is missing.');
  const config = getConfig();
  const user = session.user || await fetchCurrentAuthUser(session);
  if (!user?.id) throw new Error('Supabase session has no user identity.');
  if (!session.user) {
    session = { ...session, user };
    Store.setSupabaseSession(session);
  }

  const response = await fetch(
    `${config.url}/rest/v1/app_access_grants`
      + `?select=role,expires_at,revoked_at,selected_player_id`
      + `&user_id=eq.${encodeURIComponent(user.id)}`,
    {
      headers: {
        apikey: config.anonKey,
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
      },
    },
  );
  if (!response.ok) {
    throw new Error(await parseError(response, `Access grant lookup failed (${response.status})`));
  }
  const [grant] = await response.json();
  if (!grant || grant.revoked_at || Date.parse(grant.expires_at) <= Date.now()) {
    Store.clearSupabaseSession();
    throw new Error('This email address does not have active Mexicano access.');
  }
  Store.setAccessGrant(grant);
  if (grant.selected_player_id) {
    await bindPlayerFromGrant(grant.selected_player_id, session);
  }
  return grant;
}

async function bindPlayerFromGrant(playerId, session) {
  const config = getConfig();
  const response = await fetch(
    `${config.url}/rest/v1/players?select=id,name&id=eq.${encodeURIComponent(playerId)}`,
    {
      headers: {
        apikey: config.anonKey,
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
      },
    },
  );
  if (!response.ok) return;
  const [player] = await response.json();
  if (!player?.name) return;
  Store.setCurrentPlayerId(player.id);
  Store.setCurrentUser(player.name);
}

export async function sendMagicLink(email, redirectTo) {
  const config = getConfig();
  const normalizedEmail = normalizeEmail(email);
  const redirectUrl = String(redirectTo || '').trim();
  if (!redirectUrl) throw new Error('Magic-link redirect URL is missing.');
  const response = await fetch(
    `${config.url}/auth/v1/otp?redirect_to=${encodeURIComponent(redirectUrl)}`,
    {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: normalizedEmail, create_user: false }),
    },
  );
  if (!response.ok) {
    throw new Error(await parseError(response, `Magic-link request failed (${response.status})`));
  }
}

async function createAnonymousSession() {
  const config = getConfig();
  const response = await fetch(`${config.url}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, `Anonymous sign-in failed (${response.status})`));
  }
  const body = await response.json();
  const session = body.session || body;
  if (!session?.access_token) throw new Error('Anonymous sign-in returned no session');
  Store.setSupabaseSession(session);
  return session;
}

async function refreshSession(session) {
  const config = getConfig();
  if (!session?.refresh_token) return createAnonymousSession();
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: config.anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!response.ok) {
    Store.clearSupabaseSession();
    return createAnonymousSession();
  }
  const refreshed = await response.json();
  Store.setSupabaseSession(refreshed);
  return refreshed;
}

let sessionPromise = null;

// Parallel route reads share one refresh/sign-in instead of racing on the
// same refresh token.
export async function ensureAnonymousSession() {
  const session = Store.getSupabaseSession();
  if (sessionIsUsable(session)) return session;
  if (!sessionPromise) {
    sessionPromise = (session?.refresh_token ? refreshSession(session) : createAnonymousSession())
      .finally(() => { sessionPromise = null; });
  }
  return sessionPromise;
}

async function authenticatedFetch(url, options = {}, retry = true) {
  const config = getConfig();
  const session = await ensureAnonymousSession();
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (response.status === 401 && retry) {
    await refreshSession(Store.getSupabaseSession());
    return authenticatedFetch(url, options, false);
  }
  return response;
}

export async function invokeFunction(name, payload = {}) {
  const config = getConfig();
  const response = await authenticatedFetch(`${config.url}/functions/v1/${name}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, `${name} failed (${response.status})`));
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function rpc(name, payload = {}) {
  const config = getConfig();
  const done = perfStart(`rpc ${name}`);
  const response = await authenticatedFetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await requestError(response, `${name} failed (${response.status})`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  const result = text ? JSON.parse(text) : null;
  done({ rows: Array.isArray(result) ? result.length : null, bytes: text.length });
  return result;
}

export async function claimAccess(code) {
  const result = await invokeFunction('claim-access', { code });
  Store.setAccessGrant(result);
  return result;
}

export async function elevateAdmin(code) {
  const result = await invokeFunction('elevate-admin', { code });
  Store.setAccessGrant(result);
  return result;
}

export async function listPlayers() {
  const config = getConfig();
  const response = await authenticatedFetch(
    `${config.url}/rest/v1/players?select=id,name&active=eq.true&order=name.asc`,
  );
  if (!response.ok) {
    throw new Error(await parseError(response, `Player load failed (${response.status})`));
  }
  return response.json();
}

export async function listAuditEvents(limit = 200) {
  const config = getConfig();
  const response = await authenticatedFetch(
    `${config.url}/rest/v1/audit_events?select=*,actor_player:players(name)&order=created_at.desc&limit=${limit}`,
  );
  if (!response.ok) {
    throw new Error(await parseError(response, `Audit log load failed (${response.status})`));
  }
  return response.json();
}

export async function bindCurrentPlayer(playerId, playerName) {
  await rpc('bind_current_player', { p_player_id: playerId });
  Store.setCurrentPlayerId(playerId);
  Store.setCurrentUser(playerName);
}

export async function savePushSubscription(subscription, playerId = Store.getCurrentPlayerId()) {
  const config = getConfig();
  const session = await ensureAnonymousSession();
  const endpoint = subscription?.endpoint;
  const keys = subscription?.keys || {};
  if (!endpoint || !keys.p256dh || !keys.auth) {
    throw new Error('Push subscription is missing endpoint or keys');
  }
  const response = await authenticatedFetch(
    `${config.url}/rest/v1/push_subscriptions?on_conflict=endpoint`,
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        owner_user_id: session.user?.id,
        player_id: playerId || null,
        endpoint,
        p256dh: keys.p256dh,
        auth_key: keys.auth,
        active: true,
        last_failure: null,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(await parseError(response, `Push subscription failed (${response.status})`));
  }
}

export async function testConnection() {
  try {
    await ensureAnonymousSession();
    const response = await listPlayers();
    return { ok: true, message: `Connected to Supabase (${response.length} players)` };
  } catch (error) {
    return { ok: false, message: error.message || 'Supabase connection failed' };
  }
}

function valueBySlot(rows, team, position, playersById) {
  const slot = rows.find((row) => row.team === team && row.position === position);
  return playersById.get(slot?.player_id)?.name || '';
}

function buildAppMatches(dataset, playersById, tournamentsById) {
  const slotsByMatch = new Map();
  for (const slot of dataset.match_players || []) {
    const slots = slotsByMatch.get(slot.match_id) || [];
    slots.push(slot);
    slotsByMatch.set(slot.match_id, slots);
  }
  return (dataset.matches || []).map((match) => {
    const tournament = tournamentsById.get(match.tournament_id);
    const slots = slotsByMatch.get(match.id) || [];
    return {
      date: tournament?.tournament_date || '',
      roundNumber: match.round_number,
      scoreTeam1: match.score_team_1,
      scoreTeam2: match.score_team_2,
      team1Player1Name: valueBySlot(slots, 1, 1, playersById),
      team1Player2Name: valueBySlot(slots, 1, 2, playersById),
      team2Player1Name: valueBySlot(slots, 2, 1, playersById),
      team2Player2Name: valueBySlot(slots, 2, 2, playersById),
    };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.roundNumber - b.roundNumber);
}

// ELO is derived at runtime from the full match history:
// player name -> [{ date, elo, previous_elo }] (end of each tournament, ascending).
function buildRuntimeElo(allAppMatches) {
  const { snapshots } = getEloSnapshots(allAppMatches);
  const eloByName = new Map();
  for (const [name, byDate] of Object.entries(snapshots)) {
    let previous = 1000;
    eloByName.set(name, Object.keys(byDate).sort().map((date) => {
      const point = { date, elo: byDate[date], previous_elo: previous };
      previous = byDate[date];
      return point;
    }));
  }
  return eloByName;
}

function buildPlayerSummary(dataset, appMatches, eloByName) {

  const stats = new Map();
  const ensureStats = (name) => {
    if (!stats.has(name)) {
      stats.set(name, { wins: 0, losses: 0, points: 0, games: 0, tournaments: new Set() });
    }
    return stats.get(name);
  };
  for (const match of appMatches) {
    if (match.scoreTeam1 === 0 && match.scoreTeam2 === 0) continue;
    const teams = [
      [[match.team1Player1Name, match.team1Player2Name], match.scoreTeam1, match.scoreTeam2],
      [[match.team2Player1Name, match.team2Player2Name], match.scoreTeam2, match.scoreTeam1],
    ];
    for (const [names, score, opponentScore] of teams) {
      for (const name of names) {
        const playerStats = ensureStats(name);
        playerStats.points += score;
        playerStats.games += 1;
        playerStats.tournaments.add(match.date);
        if (score > opponentScore) playerStats.wins += 1;
        else playerStats.losses += 1;
      }
    }
  }

  return (dataset.players || []).map((player) => {
    const playerStats = stats.get(player.name) || {
      wins: 0, losses: 0, points: 0, games: 0, tournaments: new Set(),
    };
    const elo = eloByName.get(player.name)?.at(-1);
    return {
      id: player.id,
      name: player.name,
      email: player.email ?? null,
      matchPadelId: player.match_padel_id ?? null,
      elo: Number(elo?.elo ?? 1000),
      previousElo: Number(elo?.previous_elo ?? 1000),
      wins: playerStats.wins,
      losses: playerStats.losses,
      points: playerStats.points,
      average: playerStats.games ? Math.round((playerStats.points / playerStats.games) * 100) / 100 : 0,
      tournaments: playerStats.tournaments.size,
    };
  });
}

function buildTournamentIndex(dataset, appMatches, playersById) {
  const rosterByTournament = new Map();
  for (const row of dataset.tournament_players || []) {
    const roster = rosterByTournament.get(row.tournament_id) || new Set();
    roster.add(row.player_id);
    rosterByTournament.set(row.tournament_id, roster);
  }
  return (dataset.tournaments || []).map((tournament) => {
    const matches = appMatches.filter((match) => match.date === tournament.tournament_date);
    const roundCount = new Set(matches.map((match) => match.roundNumber)).size;
    const names = new Set(matches.flatMap((match) => [
      match.team1Player1Name,
      match.team1Player2Name,
      match.team2Player1Name,
      match.team2Player2Name,
    ]).filter(Boolean));
    const rosterCount = rosterByTournament.get(tournament.id)?.size || 0;
    return {
      date: tournament.tournament_date,
      playerCount: rosterCount || names.size,
      roundCount,
      matchCount: matches.length,
      completedCount: matches.filter((match) => match.scoreTeam1 !== 0 || match.scoreTeam2 !== 0).length,
      isComplete: tournament.status === 'completed',
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

function hydrateDoodles(dataset, playersById) {
  const byMonth = new Map();
  for (const row of dataset.doodle_availability || []) {
    const month = row.availability_date.slice(0, 7);
    const players = byMonth.get(month) || new Map();
    const name = playersById.get(row.player_id)?.name;
    if (!name) continue;
    const dates = players.get(name) || [];
    dates.push(row.availability_date);
    players.set(name, dates);
    byMonth.set(month, players);
  }
  for (const [month, players] of byMonth) {
    Store.setDoodle(month, [...players.entries()]
      .map(([name, selectedDates]) => ({ name, selectedDates: selectedDates.sort() }))
      .sort((a, b) => a.name.localeCompare(b.name)));
  }
}

function hydrateAttendance(dataset, playersById) {
  const playersByAttendance = new Map();
  for (const row of dataset.attendance_players || []) {
    const names = playersByAttendance.get(row.attendance_id) || [];
    const name = playersById.get(row.player_id)?.name;
    if (name) names.push(name);
    playersByAttendance.set(row.attendance_id, names);
  }
  Store.setManualAttendance((dataset.attendance_records || [])
    .map((record) => ({
      date: record.attendance_date,
      players: (playersByAttendance.get(record.id) || []).sort(),
      note: record.note || '',
    }))
    .sort((a, b) => a.date.localeCompare(b.date)));
}

function hydrateEloHistory(dataset, eloByName) {
  for (const player of dataset.players || []) {
    const history = eloByName.get(player.name);
    if (!history?.length) continue;
    Cache.set(`elo_history_player_${player.id}`, {
      playerId: player.id,
      playerName: player.name,
      points: history.map(({ date, elo, previous_elo: previousElo }) => ({
        date,
        elo,
        delta: Math.round((elo - previousElo) * 10) / 10,
      })),
    });
  }
}

function hydrateMonthlyProjections(appMatches, eloByName) {
  for (const key of Cache.keys('monthly_')) Cache.del(key);

  const matchesByMonth = new Map();
  const attendanceByMonth = new Map();
  for (const match of appMatches) {
    const month = match.date.slice(0, 7);
    const monthMatches = matchesByMonth.get(month) || [];
    monthMatches.push(match);
    matchesByMonth.set(month, monthMatches);

    const attendance = attendanceByMonth.get(month) || new Map();
    for (const name of [
      match.team1Player1Name,
      match.team1Player2Name,
      match.team2Player1Name,
      match.team2Player2Name,
    ]) {
      if (!name) continue;
      const dates = attendance.get(name) || new Set();
      dates.add(match.date);
      attendance.set(name, dates);
    }
    attendanceByMonth.set(month, attendance);
  }

  const monthlyElo = new Map();
  for (const [name, history] of eloByName) {
    for (const { date, elo } of history) {
      const month = date.slice(0, 7);
      const eloByPlayer = monthlyElo.get(month) || new Map();
      eloByPlayer.set(name, { date, elo });
      monthlyElo.set(month, eloByPlayer);
    }
  }

  for (const [month, matches] of matchesByMonth) {
    const eloByPlayer = monthlyElo.get(month) || new Map();
    const overview = calculatePlayerStatistics(matches).map((row) => ({
      name: row.name,
      wins: row.wins,
      losses: row.losses,
      totalPoints: row.points,
      average: row.average,
      elo: eloByPlayer.get(row.name)?.elo ?? null,
    }));
    Cache.set(`monthly_${month}`, overview);
  }
  for (const key of Cache.keys('participation_')) Cache.del(key);
  for (const [month, attendance] of attendanceByMonth) setMonthParticipation(month, attendance);
}

// Month attendance (name -> Set<date>) as both the attendance-page rows
// (`participation_YYYY-MM`: [{ date, players }]) and the statistics raw shape
// (`monthly_raw_YYYY-MM`: [{ Name, ELO: [{ Date }] }]).
function setMonthParticipation(month, attendance) {
  const namesByDate = new Map();
  for (const [name, dates] of attendance) {
    for (const date of dates) {
      const names = namesByDate.get(date) || [];
      names.push(name);
      namesByDate.set(date, names);
    }
  }
  Cache.set(`participation_${month}`, [...namesByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, players]) => ({ date, players: players.sort() })));
  Cache.set(`monthly_raw_${month}`, [...attendance.entries()]
    .map(([name, dates]) => ({
      Name: name,
      ELO: [...dates].sort().map((date) => ({ Date: date })),
    }))
    .sort((a, b) => a.Name.localeCompare(b.Name)));
}

function hydrateDoodleChangelog(dataset, playersById, onlyMonth = null) {
  const byMonth = new Map();
  for (const row of dataset.doodle_changelog || []) {
    const entries = byMonth.get(row.year_month) || [];
    entries.push({
      playerName: playersById.get(row.player_id)?.name || '',
      yearMonth: row.year_month,
      year: Number(row.year_month.slice(0, 4)),
      month: Number(row.year_month.slice(5, 7)),
      selectedAdded: row.selected_added || [],
      selectedRemoved: row.selected_removed || [],
      timestamp: row.created_at,
    });
    byMonth.set(row.year_month, entries);
  }
  if (onlyMonth) {
    Store.setDoodleChangelog(onlyMonth, []);
  } else {
    for (const key of Cache.keys('doodle_changelog_')) Cache.del(key);
  }
  for (const [month, entries] of byMonth) {
    Store.setDoodleChangelog(
      month,
      entries.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))),
    );
  }
}

/**
 * Rebuild the in-progress tournament from Supabase instead of trusting a local
 * copy, so a refresh (or a second device) always sees the real current round.
 *
 * `loadedTournamentIds` restricts hydration to tournaments whose matches are
 * present in `dataset`; partial route snapshots pass it so they cannot
 * overwrite a fully hydrated tournament with an empty one.
 */
function hydrateActiveTournament(dataset, playersById, loadedTournamentIds = null) {
  const candidates = (dataset.tournaments || [])
    .filter((tournament) => tournament.status !== 'completed'
      && tournament.status !== 'cancelled')
    .sort((a, b) => b.tournament_date.localeCompare(a.tournament_date));

  const active = candidates[0];
  if (!active) {
    Store.clearActiveTournament();
    return null;
  }
  if (loadedTournamentIds && !loadedTournamentIds.has(active.id)) {
    return Store.getActiveTournament();
  }

  const matches = (dataset.matches || []).filter((match) => match.tournament_id === active.id);
  const matchIds = new Set(matches.map((match) => match.id));
  const built = buildTournamentFromRows({
    tournament: active,
    tournamentPlayers: (dataset.tournament_players || [])
      .filter((row) => row.tournament_id === active.id),
    matches,
    matchPlayers: (dataset.match_players || []).filter((row) => matchIds.has(row.match_id)),
    playersById,
  });
  Store.setActiveTournament(built);
  return built;
}

export function hydrateSupabaseDataset(dataset) {
  const playersById = new Map((dataset.players || []).map((player) => [player.id, player]));
  const tournamentsById = new Map((dataset.tournaments || []).map((tournament) => [tournament.id, tournament]));
  const appMatches = buildAppMatches(dataset, playersById, tournamentsById);
  const eloByName = buildRuntimeElo(appMatches);
  const summary = buildPlayerSummary(dataset, appMatches, eloByName);

  Store.setMatches(appMatches);
  Store.setMembers(summary.map((player) => player.name).sort());
  Store.setPlayersSummaryCache(summary);
  Store.setTournamentsIndex(buildTournamentIndex(dataset, appMatches, playersById));
  hydrateDoodles(dataset, playersById);
  hydrateDoodleChangelog(dataset, playersById);
  hydrateAttendance(dataset, playersById);
  hydrateEloHistory(dataset, eloByName);
  hydrateMonthlyProjections(appMatches, eloByName);
  hydrateActiveTournament(dataset, playersById);
  Store.setMatchesFullyLoaded(true);
  Cache.set('supabase_snapshot_loaded', true);
  return { matches: appMatches, players: summary };
}

const PAGE_SIZE = 1000;

async function fetchPage(table, url, start, withCount) {
  const response = await authenticatedFetch(url, {
    headers: {
      Range: `${start}-${start + PAGE_SIZE - 1}`,
      ...(withCount ? { Prefer: 'count=exact' } : {}),
    },
  });
  if (!response.ok) {
    throw await requestError(response, `${table} load failed (${response.status})`);
  }
  const rows = await response.json();
  const contentRange = withCount ? response.headers?.get?.('content-range') : null;
  const total = Number(String(contentRange || '').split('/')[1]);
  return { rows, total: Number.isFinite(total) && contentRange ? total : null };
}

/**
 * Read every row of a PostgREST query. The first page asks for an exact count;
 * when more pages are needed they are fetched in parallel (sequentially only if
 * the server did not report a total).
 */
export async function selectAll(table, query = 'select=*') {
  const config = getConfig();
  const url = `${config.url}/rest/v1/${table}?${query}`;
  const done = perfStart(`select ${table}`);
  const first = await fetchPage(table, url, 0, true);
  let rows = first.rows;
  if (rows.length >= PAGE_SIZE) {
    if (first.total != null) {
      const starts = [];
      for (let start = PAGE_SIZE; start < first.total; start += PAGE_SIZE) starts.push(start);
      const pages = await Promise.all(starts.map((start) => fetchPage(table, url, start, false)));
      rows = rows.concat(...pages.map((page) => page.rows));
    } else {
      for (let start = PAGE_SIZE; ; start += PAGE_SIZE) {
        const page = await fetchPage(table, url, start, false);
        rows = rows.concat(page.rows);
        if (page.rows.length < PAGE_SIZE) break;
      }
    }
  }
  done({ rows: rows.length });
  return rows;
}

const PLAYER_QUERY = 'select=id,name,email,match_padel_id&active=eq.true&order=name.asc,id.asc';
const TOURNAMENT_SELECT = 'id,tournament_date,status,current_round_number,completed_at,access_code,courts,tournament_players(player_id,seed_position,confirmed)';
const MATCH_SELECT = 'id,tournament_id,round_number,match_order,score_team_1,score_team_2,match_players(player_id,team,position)';
const MATCH_ORDER = 'order=tournament_id.asc,round_number.asc,match_order.asc,id.asc';

async function loadSnapshot() {
  const [
    players,
    tournaments,
    matches,
    doodleAvailability,
    doodleChangelog,
    attendanceRecords,
  ] = await Promise.all([
    selectAll('players', PLAYER_QUERY),
    selectAll('tournaments', `select=${TOURNAMENT_SELECT}&order=tournament_date.asc,id.asc`),
    selectAll('matches', `select=${MATCH_SELECT}&${MATCH_ORDER}`),
    selectAll('doodle_availability', 'select=availability_date,player_id&order=availability_date.asc,player_id.asc'),
    selectAll('doodle_changelog', 'select=year_month,player_id,selected_added,selected_removed,created_at&order=created_at.desc'),
    selectAll('attendance_records', 'select=id,attendance_date,note,attendance_players(player_id)&order=attendance_date.asc,id.asc'),
  ]);

  Cache.set('supabase_players_rows', players);
  hydrateSupabaseDataset({
    players,
    tournaments,
    tournament_players: flattenEmbeddedRows(tournaments, 'tournament_players', 'tournament_id'),
    matches,
    match_players: flattenEmbeddedRows(matches, 'match_players', 'match_id'),
    doodle_availability: doodleAvailability,
    doodle_changelog: doodleChangelog,
    attendance_records: attendanceRecords,
    attendance_players: flattenEmbeddedRows(attendanceRecords, 'attendance_players', 'attendance_id'),
  });
  return true;
}

function flattenEmbeddedRows(rows, relationName, foreignKey) {
  return rows.flatMap((parent) =>
    (parent[relationName] || []).map((row) => ({
      ...row,
      [foreignKey]: parent.id,
    })));
}

function yearMonthOffset(yearMonth, delta) {
  const [year, month] = yearMonth.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

// ─── Route-scoped resources ─────────────────────────────────────────────────
// Each page loads only what it renders. Resources are cached in memory for the
// session (flag `supabase_res_<key>`), shared between routes, deduped while in
// flight, and invalidated after any mutation.

const RESOURCE_PREFIX = 'supabase_res_';
const MISSING_SCHEMA_CODES = new Set(['PGRST202', 'PGRST205', '42P01', '42883']);
const resourcePromises = new Map();

function isMissingSchemaError(error) {
  return error?.status === 404 || MISSING_SCHEMA_CODES.has(error?.code);
}

function snapshotLoaded() {
  return Cache.has('supabase_snapshot_loaded');
}

function loadResource(key, loader, { force = false } = {}) {
  const flag = RESOURCE_PREFIX + key;
  if (!force && (snapshotLoaded() || Cache.has(flag))) return Promise.resolve(false);
  if (resourcePromises.has(key)) return resourcePromises.get(key);
  const promise = loader()
    .then(() => {
      Cache.set(flag, true);
      return true;
    })
    .catch(async (error) => {
      // Migration with the read views/RPCs not applied yet: keep the app
      // working with the legacy full snapshot.
      if (!isMissingSchemaError(error)) throw error;
      console.warn(`[supabase] ${key} unavailable (${error.code || error.status}); loading full snapshot`);
      await pullForRoute('#/__full__');
      return true;
    })
    .finally(() => resourcePromises.delete(key));
  resourcePromises.set(key, promise);
  return promise;
}

function playersById() {
  return new Map((Cache.get('supabase_players_rows') || []).map((player) => [player.id, player]));
}

export function loadPlayers() {
  return loadResource('players', async () => {
    const players = await selectAll('players', PLAYER_QUERY);
    Cache.set('supabase_players_rows', players);
    Store.setMembers(players.map((player) => player.name).sort());
  });
}

export function loadTournamentIndex() {
  return loadResource('tournament_index', async () => {
    const rows = await selectAll(
      'tournament_index',
      'select=id,tournament_date,status,player_count,round_count,match_count,completed_count&order=tournament_date.asc,id.asc',
    );
    Store.setTournamentsIndex(rows.map((row) => ({
      date: row.tournament_date,
      playerCount: row.player_count,
      roundCount: row.round_count,
      matchCount: row.match_count,
      completedCount: row.completed_count,
      isComplete: row.status === 'completed',
    })));
  });
}

/** The single planned/active tournament with its roster and matches. */
export function loadActiveTournament({ force = false } = {}) {
  return loadResource('active_tournament', async () => {
    const [rows] = await Promise.all([
      selectAll(
        'tournaments',
        `select=${TOURNAMENT_SELECT},matches(${MATCH_SELECT})&status=in.(planned,active)&order=tournament_date.desc,id.desc&limit=1`,
      ),
      loadPlayers(),
    ]);
    const active = rows[0];
    if (!active) {
      Store.clearActiveTournament();
      return;
    }
    const matches = active.matches || [];
    Store.setActiveTournament(buildTournamentFromRows({
      tournament: active,
      tournamentPlayers: flattenEmbeddedRows([active], 'tournament_players', 'tournament_id'),
      matches,
      matchPlayers: flattenEmbeddedRows(matches, 'match_players', 'match_id'),
      playersById: playersById(),
    }));
  }, { force });
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

/** Matches of the given tournament days, merged into Store.getMatches(). */
export async function loadDayMatches(dates) {
  const wanted = uniqueSorted(dates);
  const missing = wanted.filter((date) => !Cache.has(`${RESOURCE_PREFIX}day_${date}`));
  if (missing.length) {
    await loadResource(`days_${missing.join(',')}`, async () => {
      const [rows] = await Promise.all([
        selectAll(
          'matches',
          `select=${MATCH_SELECT},tournaments!inner(tournament_date)&tournaments.tournament_date=in.(${missing.join(',')})&${MATCH_ORDER}`,
        ),
        loadPlayers(),
      ]);
      const tournamentsById = new Map(rows.map((row) => [row.tournament_id, row.tournaments]));
      const dayMatches = buildAppMatches({
        matches: rows,
        match_players: flattenEmbeddedRows(rows, 'match_players', 'match_id'),
      }, playersById(), tournamentsById);
      const missingSet = new Set(missing);
      Store.setMatches([
        ...Store.getMatches().filter((match) => !missingSet.has(match.date)),
        ...dayMatches,
      ].sort((a, b) => a.date.localeCompare(b.date) || a.roundNumber - b.roundNumber));
      for (const date of missing) Cache.set(`${RESOURCE_PREFIX}day_${date}`, true);
    });
  }
  const wantedSet = new Set(wanted);
  return Store.getMatches().filter((match) => wantedSet.has(match.date));
}

/** End-of-day ELO per player for the given dates: { date: { name: { elo, previousElo } } }. */
export async function loadEloForDates(dates) {
  const wanted = uniqueSorted(dates);
  const missing = wanted.filter((date) => !Cache.has(`elo_day_${date}`));
  if (missing.length) {
    await loadResource(`elo_days_${missing.join(',')}`, async () => {
      const [rows] = await Promise.all([
        rpc('get_player_elo', { p_dates: missing }),
        loadPlayers(),
      ]);
      const byId = playersById();
      const byDate = new Map(missing.map((date) => [date, {}]));
      for (const row of rows || []) {
        const name = byId.get(row.player_id)?.name;
        const day = byDate.get(row.tournament_date);
        if (name && day) {
          day[name] = { elo: Number(row.elo), previousElo: Number(row.previous_elo) };
        }
      }
      for (const [date, eloByName] of byDate) Cache.set(`elo_day_${date}`, eloByName);
    });
  }
  return Object.fromEntries(wanted.map((date) => [date, Cache.get(`elo_day_${date}`) || {}]));
}

function tournamentDatesIn(yearMonth) {
  return Store.getTournamentsIndex()
    .map((entry) => entry.date)
    .filter((date) => date?.startsWith(yearMonth));
}

function latestCompletedDate() {
  return Store.getTournamentsIndex()
    .filter((entry) => entry.isComplete)
    .map((entry) => entry.date)
    .sort()
    .at(-1) || null;
}

/** Monthly overview (stats + month-end ELO) and attendance for one month. */
export function loadMonth(yearMonth) {
  return loadResource(`month_${yearMonth}`, async () => {
    await loadTournamentIndex();
    const dates = tournamentDatesIn(yearMonth);
    if (!dates.length || snapshotLoaded()) return;
    const [matches, eloByDate] = await Promise.all([
      loadDayMatches(dates),
      loadEloForDates(dates),
    ]);
    if (snapshotLoaded()) return;

    const monthElo = {};
    for (const date of [...dates].sort()) Object.assign(monthElo, eloByDate[date]);
    Cache.set(`monthly_${yearMonth}`, calculatePlayerStatistics(matches).map((row) => ({
      name: row.name,
      wins: row.wins,
      losses: row.losses,
      totalPoints: row.points,
      average: row.average,
      elo: monthElo[row.name]?.elo ?? null,
    })));

    const attendance = new Map();
    for (const match of matches) {
      for (const name of [
        match.team1Player1Name, match.team1Player2Name,
        match.team2Player1Name, match.team2Player2Name,
      ]) {
        if (!name) continue;
        const played = attendance.get(name) || new Set();
        played.add(match.date);
        attendance.set(name, played);
      }
    }
    setMonthParticipation(yearMonth, attendance);
  });
}

/** Who played on which date, for the given months (null = all history). */
export async function loadParticipation(months = null) {
  if (Cache.has(`${RESOURCE_PREFIX}participation_all`)) return false;
  const missing = months
    ? uniqueSorted(months).filter((month) => !Cache.has(`participation_${month}`))
    : null;
  if (missing && !missing.length) return false;
  const key = missing ? `participation_${missing.join(',')}` : 'participation_all';
  return loadResource(key, async () => {
    let query = 'select=tournament_date,player_id&order=tournament_date.asc,player_id.asc';
    if (missing) {
      query += `&tournament_date=gte.${missing[0]}-01&tournament_date=lt.${yearMonthOffset(missing.at(-1), 1)}-01`;
    }
    const [rows] = await Promise.all([selectAll('player_attendance', query), loadPlayers()]);
    const byId = playersById();
    const byMonth = new Map((missing || []).map((month) => [month, new Map()]));
    for (const row of rows) {
      const name = byId.get(row.player_id)?.name;
      if (!name) continue;
      const month = row.tournament_date.slice(0, 7);
      const attendance = byMonth.get(month) || new Map();
      const dates = attendance.get(name) || new Set();
      dates.add(row.tournament_date);
      attendance.set(name, dates);
      byMonth.set(month, attendance);
    }
    for (const [month, attendance] of byMonth) setMonthParticipation(month, attendance);
  });
}

export function loadManualAttendance() {
  return loadResource('attendance_records', async () => {
    const [records] = await Promise.all([
      selectAll('attendance_records', 'select=id,attendance_date,note,attendance_players(player_id)&order=attendance_date.asc,id.asc'),
      loadPlayers(),
    ]);
    hydrateAttendance({
      attendance_records: records,
      attendance_players: flattenEmbeddedRows(records, 'attendance_players', 'attendance_id'),
    }, playersById());
  });
}

export function loadDoodleMonth(yearMonth = currentYearMonth()) {
  return loadResource(`doodle_${yearMonth}`, async () => {
    const [availability, changelog] = await Promise.all([
      selectAll(
        'doodle_availability',
        `select=availability_date,player_id&availability_date=gte.${yearMonth}-01&availability_date=lt.${yearMonthOffset(yearMonth, 1)}-01&order=availability_date.asc,player_id.asc`,
      ),
      selectAll(
        'doodle_changelog',
        `select=year_month,player_id,selected_added,selected_removed,created_at&year_month=eq.${yearMonth}&order=created_at.desc`,
      ),
      loadPlayers(),
    ]);
    const byId = playersById();
    Store.setDoodle(yearMonth, []);
    hydrateDoodles({ doodle_availability: availability }, byId);
    hydrateDoodleChangelog({ doodle_changelog: changelog }, byId, yearMonth);
  });
}

/** All-time rankings: totals and current ELO aggregated server-side. */
export function loadPlayerSummary() {
  return loadResource('player_summary', async () => {
    const [totals, currentElo] = await Promise.all([
      selectAll('player_totals', 'select=player_id,wins,losses,points,games,tournaments'),
      rpc('get_current_elo', {}),
      loadPlayers(),
    ]);
    const totalsById = new Map(totals.map((row) => [row.player_id, row]));
    const eloById = new Map((currentElo || []).map((row) => [row.player_id, row]));
    Store.setPlayersSummaryCache((Cache.get('supabase_players_rows') || []).map((player) => {
      const total = totalsById.get(player.id) || {};
      const elo = eloById.get(player.id);
      const games = total.games || 0;
      return {
        id: player.id,
        name: player.name,
        email: player.email ?? null,
        matchPadelId: player.match_padel_id ?? null,
        elo: Number(elo?.elo ?? 1000),
        previousElo: Number(elo?.previous_elo ?? 1000),
        wins: total.wins || 0,
        losses: total.losses || 0,
        points: total.points || 0,
        average: games ? Math.round(((total.points || 0) / games) * 100) / 100 : 0,
        tournaments: total.tournaments || 0,
      };
    }));
  });
}

/** Per-date ELO history for the selected players only. */
export async function loadEloHistory(playerIds = []) {
  const missing = uniqueSorted(playerIds.map(String))
    .filter((id) => !Cache.has(`elo_history_player_${id}`)
      && !Cache.has(`${RESOURCE_PREFIX}elo_history_${id}`));
  if (!missing.length) return false;
  return loadResource(`elo_histories_${missing.join(',')}`, async () => {
    const [rows] = await Promise.all([
      rpc('get_player_elo', { p_player_ids: missing }),
      loadPlayers(),
    ]);
    const byId = playersById();
    const pointsById = new Map();
    for (const row of rows || []) {
      const points = pointsById.get(row.player_id) || [];
      points.push({
        date: row.tournament_date,
        elo: Number(row.elo),
        delta: Math.round((Number(row.elo) - Number(row.previous_elo)) * 10) / 10,
      });
      pointsById.set(row.player_id, points);
    }
    for (const id of missing) {
      Cache.set(`${RESOURCE_PREFIX}elo_history_${id}`, true);
      const points = pointsById.get(id);
      if (!points?.length) continue;
      Cache.set(`elo_history_player_${id}`, {
        playerId: id,
        playerName: byId.get(id)?.name || '',
        points: points.sort((a, b) => a.date.localeCompare(b.date)),
      });
    }
  });
}

/** Drop every cached read so the next route visit reloads fresh data. */
export function invalidateReadCache() {
  for (const prefix of [RESOURCE_PREFIX, 'supabase_route_', 'elo_day_', 'elo_history_player_']) {
    for (const key of Cache.keys(prefix)) Cache.del(key);
  }
  Cache.del('supabase_snapshot_loaded');
}

async function loadLatestDay() {
  await loadTournamentIndex();
  const latest = latestCompletedDate();
  if (latest) await loadDayMatches([latest]);
}

async function loadHomeRoute() {
  await Promise.all([loadPlayers(), loadTournamentIndex(), loadActiveTournament()]);
  if (snapshotLoaded()) return;
  const month = currentYearMonth();
  const previousMonth = yearMonthOffset(month, -1);
  const latest = latestCompletedDate();
  const dates = uniqueSorted([
    ...tournamentDatesIn(month),
    ...tournamentDatesIn(previousMonth),
    latest,
  ]);
  // One matches request + one ELO RPC for every date Home shows; the month
  // projections below then build from cache.
  const [, eloByDate] = await Promise.all([loadDayMatches(dates), loadEloForDates(dates)]);
  await Promise.all([loadMonth(month), loadMonth(previousMonth)]);
  if (snapshotLoaded()) return;

  const dateSet = new Set(dates);
  Cache.set('home_matches', Store.getMatches().filter((match) => dateSet.has(match.date)));
  const byName = new Map((Cache.get('supabase_players_rows') || []).map((p) => [p.name, p]));
  Cache.set('home_players_summary', Object.entries(eloByDate[latest] || {})
    .map(([name, { elo, previousElo }]) => ({ id: byName.get(name)?.id ?? null, name, elo, previousElo }))
    .sort((a, b) => a.name.localeCompare(b.name)));
}

function routeScope(hash) {
  const path = String(hash || '').replace(/^#/, '').split('?')[0] || '/';
  if (path === '/logs' || path === '/settings') return { key: `skip:${path}`, load: null };
  if (path === '/__full__' || path === '/players' || path === '/players/compare') return { key: 'full', load: loadSnapshot };
  const tournamentMatch = path.match(/^\/tournament\/(\d{4}-\d{2}-\d{2})$/);
  if (tournamentMatch) {
    const date = tournamentMatch[1];
    return {
      key: `tournament:${date}`,
      load: () => Promise.all([
        loadTournamentIndex(),
        loadActiveTournament(),
        loadDayMatches([date]),
        loadPlayerSummary(),
      ]),
    };
  }
  const month = currentYearMonth();
  const routes = {
    '/tournaments': () => loadTournamentIndex(),
    '/create-tournament': () => Promise.all([
      loadActiveTournament(),
      loadParticipation([yearMonthOffset(month, -1), month]),
    ]),
    '/statistics': () => Promise.all([loadLatestDay(), loadPlayerSummary(), loadManualAttendance()]),
    '/elo-charts': () => Promise.all([loadLatestDay(), loadPlayerSummary()]),
    '/attendance': () => Promise.all([loadParticipation(), loadManualAttendance()]),
    '/doodle': () => Promise.all([
      loadDoodleMonth(month),
      loadMonth(month),
      loadPlayerSummary(),
      loadManualAttendance(),
    ]),
  };
  if (routes[path]) return { key: path.slice(1), load: routes[path] };
  return { key: 'home', load: loadHomeRoute };
}

export async function pullForRoute(hash, { force = false } = {}) {
  const scope = routeScope(hash);
  if (!scope.load) return false;
  if (!force && (
    snapshotLoaded()
    || Cache.has(`supabase_route_${scope.key}_loaded`)
  )) return false;
  if (snapshotPromises.has(scope.key)) return snapshotPromises.get(scope.key);
  if (force && scope.key !== 'full') invalidateReadCache();

  const done = perfStart(`route ${scope.key}`);
  const promise = Promise.resolve()
    .then(() => scope.load())
    .then(() => {
      Cache.set(`supabase_route_${scope.key}_loaded`, true);
      if (scope.key === 'full') Cache.set('supabase_snapshot_loaded', true);
      done();
      return true;
    })
    .finally(() => {
      snapshotPromises.delete(scope.key);
    });
  snapshotPromises.set(scope.key, promise);
  return promise;
}
