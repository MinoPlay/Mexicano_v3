import { Store } from '../store.js';
import { Cache } from '../cache.js';
import { calculatePlayerStatistics } from './statistics.js';

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

export async function ensureAnonymousSession() {
  const session = Store.getSupabaseSession();
  if (sessionIsUsable(session)) return session;
  if (session?.refresh_token) return refreshSession(session);
  return createAnonymousSession();
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
  const response = await authenticatedFetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, `${name} failed (${response.status})`));
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
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

function buildPlayerSummary(dataset, appMatches, playersById, tournamentsById) {
  const latestElo = new Map();
  for (const snapshot of dataset.elo_snapshots || []) {
    const date = tournamentsById.get(snapshot.tournament_id)?.tournament_date || '';
    const current = latestElo.get(snapshot.player_id);
    if (!current || date > current.date) latestElo.set(snapshot.player_id, { ...snapshot, date });
  }

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
    const elo = latestElo.get(player.id);
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
      isComplete: tournament.is_complete === true || tournament.status === 'completed',
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
    .filter((record) => record.kind === 'manual')
    .map((record) => ({
      date: record.attendance_date,
      players: (playersByAttendance.get(record.id) || []).sort(),
      note: record.note || '',
    }))
    .sort((a, b) => a.date.localeCompare(b.date)));
}

function hydrateEloHistory(dataset, playersById, tournamentsById) {
  const byPlayer = new Map();
  for (const snapshot of dataset.elo_snapshots || []) {
    const player = playersById.get(snapshot.player_id);
    const date = tournamentsById.get(snapshot.tournament_id)?.tournament_date;
    if (!player || !date) continue;
    const points = byPlayer.get(player.id) || [];
    points.push({
      date,
      elo: Number(snapshot.elo),
      delta: Math.round((Number(snapshot.elo) - Number(snapshot.previous_elo)) * 10) / 10,
    });
    byPlayer.set(player.id, points);
  }
  for (const [playerId, points] of byPlayer) {
    const player = playersById.get(playerId);
    Cache.set(`elo_history_player_${playerId}`, {
      playerId,
      playerName: player.name,
      points: points.sort((a, b) => a.date.localeCompare(b.date)),
    });
  }
}

function hydrateMonthlyProjections(dataset, appMatches, playersById, tournamentsById) {
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
  for (const snapshot of dataset.elo_snapshots || []) {
    const date = tournamentsById.get(snapshot.tournament_id)?.tournament_date;
    const player = playersById.get(snapshot.player_id);
    if (!date || !player) continue;
    const month = date.slice(0, 7);
    const eloByPlayer = monthlyElo.get(month) || new Map();
    const current = eloByPlayer.get(player.name);
    if (!current || date > current.date) {
      eloByPlayer.set(player.name, { date, elo: Number(snapshot.elo) });
    }
    monthlyElo.set(month, eloByPlayer);
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

    const rawAttendance = [...(attendanceByMonth.get(month) || new Map()).entries()]
      .map(([name, dates]) => ({
        Name: name,
        ELO: [...dates].sort().map((date) => ({ Date: date })),
      }))
      .sort((a, b) => a.Name.localeCompare(b.Name));
    Cache.set(`monthly_raw_${month}`, rawAttendance);
  }
}

export function hydrateSupabaseDataset(dataset) {
  const playersById = new Map((dataset.players || []).map((player) => [player.id, player]));
  const tournamentsById = new Map((dataset.tournaments || []).map((tournament) => [tournament.id, tournament]));
  const appMatches = buildAppMatches(dataset, playersById, tournamentsById);
  const summary = buildPlayerSummary(dataset, appMatches, playersById, tournamentsById);

  Store.setMatches(appMatches);
  Store.setMembers(summary.map((player) => player.name).sort());
  Store.setPlayersSummaryCache(summary);
  Store.setTournamentsIndex(buildTournamentIndex(dataset, appMatches, playersById));
  hydrateDoodles(dataset, playersById);
  hydrateAttendance(dataset, playersById);
  hydrateEloHistory(dataset, playersById, tournamentsById);
  hydrateMonthlyProjections(dataset, appMatches, playersById, tournamentsById);
  localStorage.setItem('mexicano_matches_fully_loaded', JSON.stringify(true));
  Cache.set('supabase_snapshot_loaded', true);
  return { matches: appMatches, players: summary };
}

async function selectAll(table, query = 'select=*') {
  const config = getConfig();
  const pageSize = 1000;
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    const response = await authenticatedFetch(`${config.url}/rest/v1/${table}?${query}`, {
      headers: { Range: `${start}-${start + pageSize - 1}` },
    });
    if (!response.ok) {
      throw new Error(await parseError(response, `${table} load failed (${response.status})`));
    }
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function loadSnapshot() {
  const [
    players,
    tournaments,
    matches,
    eloSnapshots,
    doodleAvailability,
    attendanceRecords,
  ] = await Promise.all([
    selectAll('players', 'select=id,name,email,match_padel_id&active=eq.true&order=name.asc,id.asc'),
    selectAll('tournaments', 'select=id,tournament_date,status,is_complete,current_round_number,completed_at,tournament_players(player_id,seed_position,confirmed)&order=tournament_date.asc,id.asc'),
    selectAll('matches', 'select=id,tournament_id,round_number,match_order,score_team_1,score_team_2,match_players(player_id,team,position)&order=tournament_id.asc,round_number.asc,match_order.asc,id.asc'),
    selectAll('elo_snapshots', 'select=tournament_id,player_id,elo,previous_elo&calculation_version=eq.mexicano-v1&order=tournament_id.asc,player_id.asc'),
    selectAll('doodle_availability', 'select=availability_date,player_id&order=availability_date.asc,player_id.asc'),
    selectAll('attendance_records', 'select=id,attendance_date,kind,note,attendance_players(player_id,confirmed)&order=attendance_date.asc,id.asc'),
  ]);

  const tournamentPlayers = tournaments.flatMap((tournament) =>
    (tournament.tournament_players || []).map((row) => ({
      ...row,
      tournament_id: tournament.id,
    })));
  const matchPlayers = matches.flatMap((match) =>
    (match.match_players || []).map((row) => ({
      ...row,
      match_id: match.id,
    })));
  const attendancePlayers = attendanceRecords.flatMap((record) =>
    (record.attendance_players || []).map((row) => ({
      ...row,
      attendance_id: record.id,
    })));

  hydrateSupabaseDataset({
    players,
    tournaments,
    tournament_players: tournamentPlayers,
    matches,
    match_players: matchPlayers,
    elo_snapshots: eloSnapshots,
    doodle_availability: doodleAvailability,
    attendance_records: attendanceRecords,
    attendance_players: attendancePlayers,
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

function previousYearMonth(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
}

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function buildHomeTournamentIndex(tournaments) {
  return tournaments.map((tournament) => {
    const matches = tournament.matches || [];
    return {
      date: tournament.tournament_date,
      playerCount: (tournament.tournament_players || []).length,
      roundCount: new Set(matches.map((match) => match.round_number)).size,
      matchCount: matches.length,
      completedCount: matches.filter(
        (match) => match.score_team_1 !== 0 || match.score_team_2 !== 0,
      ).length,
      isComplete: tournament.is_complete === true || tournament.status === 'completed',
    };
  }).sort((a, b) => a.date.localeCompare(b.date));
}

async function loadHomeSnapshot() {
  const [players, tournaments] = await Promise.all([
    selectAll('players', 'select=id,name,email,match_padel_id&active=eq.true&order=name.asc,id.asc'),
    selectAll('tournaments', 'select=id,tournament_date,status,is_complete,current_round_number,completed_at,tournament_players(player_id,seed_position,confirmed)&order=tournament_date.asc,id.asc'),
  ]);
  const month = currentYearMonth();
  const previousMonth = previousYearMonth(month);
  const latestCompleted = [...tournaments]
    .filter((tournament) => tournament.is_complete === true || tournament.status === 'completed')
    .sort((a, b) => b.tournament_date.localeCompare(a.tournament_date))[0];
  const relevantTournaments = tournaments.filter((tournament) =>
    tournament.tournament_date.startsWith(month)
    || tournament.tournament_date.startsWith(previousMonth)
    || tournament.id === latestCompleted?.id);
  const relevantIds = relevantTournaments.map((tournament) => tournament.id);
  const idFilter = `in.(${relevantIds.join(',')})`;
  const [matches, eloSnapshots] = relevantIds.length
    ? await Promise.all([
      selectAll(
        'matches',
        `select=id,tournament_id,round_number,match_order,score_team_1,score_team_2,match_players(player_id,team,position)&tournament_id=${idFilter}&order=tournament_id.asc,round_number.asc,match_order.asc,id.asc`,
      ),
      selectAll(
        'elo_snapshots',
        `select=tournament_id,player_id,elo,previous_elo&calculation_version=eq.mexicano-v1&tournament_id=${idFilter}&order=tournament_id.asc,player_id.asc`,
      ),
    ])
    : [[], []];

  const dataset = {
    players,
    tournaments: relevantTournaments,
    tournament_players: flattenEmbeddedRows(
      relevantTournaments,
      'tournament_players',
      'tournament_id',
    ),
    matches,
    match_players: flattenEmbeddedRows(matches, 'match_players', 'match_id'),
    elo_snapshots: eloSnapshots,
  };
  const playersById = new Map(players.map((player) => [player.id, player]));
  const tournamentsById = new Map(
    relevantTournaments.map((tournament) => [tournament.id, tournament]),
  );
  const appMatches = buildAppMatches(dataset, playersById, tournamentsById);
  const summary = buildPlayerSummary(dataset, appMatches, playersById, tournamentsById);

  Cache.set('home_matches', appMatches);
  Cache.set('home_players_summary', summary);
  Store.setMembers(players.map((player) => player.name).sort());
  Store.setTournamentsIndex(buildHomeTournamentIndex(tournaments));
  hydrateMonthlyProjections(dataset, appMatches, playersById, tournamentsById);
  Cache.set(`home_month_${month}_loaded`, true);
  Cache.set(`home_month_${previousMonth}_loaded`, true);
  return true;
}

async function loadTournamentSnapshot(date) {
  const encodedDate = encodeURIComponent(date);
  const [players, tournaments, matches] = await Promise.all([
    selectAll('players', 'select=id,name,email,match_padel_id&active=eq.true&order=name.asc,id.asc'),
    selectAll('tournaments', 'select=id,tournament_date,status,is_complete,current_round_number,completed_at,tournament_players(player_id,seed_position,confirmed)&order=tournament_date.asc,id.asc'),
    selectAll(
      'matches',
      `select=id,tournament_id,round_number,match_order,score_team_1,score_team_2,match_players(player_id,team,position),tournaments!inner(tournament_date)&tournaments.tournament_date=eq.${encodedDate}&order=tournament_id.asc,round_number.asc,match_order.asc,id.asc`,
    ),
  ]);

  const dataset = {
    players,
    tournaments,
    tournament_players: flattenEmbeddedRows(tournaments, 'tournament_players', 'tournament_id'),
    matches,
    match_players: flattenEmbeddedRows(matches, 'match_players', 'match_id'),
  };
  const playersById = new Map(players.map((player) => [player.id, player]));
  const tournamentsById = new Map(tournaments.map((tournament) => [tournament.id, tournament]));
  const dayMatches = buildAppMatches(dataset, playersById, tournamentsById);
  const retainedMatches = Store.getMatches().filter((match) => match.date !== date);

  Store.setMatches([...retainedMatches, ...dayMatches]);
  Store.setMembers(players.map((player) => player.name).sort());
  Store.setTournamentsIndex(buildTournamentIndex(dataset, dayMatches, playersById));
  return true;
}

function routeScope(hash) {
  const path = String(hash || '').replace(/^#/, '').split('?')[0] || '/';
  if (path === '/logs' || path === '/settings') return { key: `skip:${path}`, load: null };
  if (path === '/') return { key: 'home', load: loadHomeSnapshot };
  const tournamentMatch = path.match(/^\/tournament\/(\d{4}-\d{2}-\d{2})$/);
  if (tournamentMatch) {
    const date = tournamentMatch[1];
    return { key: `tournament:${date}`, load: () => loadTournamentSnapshot(date) };
  }
  return { key: 'full', load: loadSnapshot };
}

export async function pullForRoute(hash, { force = false } = {}) {
  const scope = routeScope(hash);
  if (!scope.load) return false;
  if (!force && (
    Cache.has('supabase_snapshot_loaded')
    || Cache.has(`supabase_route_${scope.key}_loaded`)
  )) return false;
  if (snapshotPromises.has(scope.key)) return snapshotPromises.get(scope.key);

  const promise = scope.load()
    .then((result) => {
      Cache.set(`supabase_route_${scope.key}_loaded`, true);
      return result;
    })
    .finally(() => {
      snapshotPromises.delete(scope.key);
    });
  snapshotPromises.set(scope.key, promise);
  return promise;
}
