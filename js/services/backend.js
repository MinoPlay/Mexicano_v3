import { Cache } from '../cache.js';
import { Store } from '../store.js';
import * as supabase from './supabase.js';
import { FAST_TIMEOUTS } from './http.js';

export { FAST_TIMEOUTS };

const FULL_SNAPSHOT_ROUTE = '#/__full__';
let syncStatus = 'idle';
const listeners = new Set();

function setSyncStatus(status) {
  syncStatus = status;
  for (const listener of listeners) listener(status);
}

function requireOnline() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You are offline. Reconnect before saving changes.');
  }
}

async function mutate(operation, payload) {
  requireOnline();
  setSyncStatus('syncing');
  try {
    const result = await supabase.invokeFunction('domain-mutation', { operation, payload });
    // Cached route data may now be stale; the next visit reloads only its own slice.
    supabase.invalidateReadCache();
    setSyncStatus('success');
    setTimeout(() => setSyncStatus('idle'), 3000);
    return result;
  } catch (error) {
    setSyncStatus('error');
    throw error;
  }
}

const isScored = (match) => match.team1Score + match.team2Score === 25;

// Every generated match is persisted (unplayed ones as 0-0, which reads skip),
// so a reload mid-round keeps the round's pairings.
function roundMatches(tournament) {
  return (tournament?.rounds || []).flatMap((round) => round.matches.map((match) => ({
    roundNumber: round.roundNumber,
    team1Player1Name: match.player1?.name,
    team1Player2Name: match.player2?.name,
    team2Player1Name: match.player3?.name,
    team2Player2Name: match.player4?.name,
    scoreTeam1: isScored(match) ? match.team1Score : 0,
    scoreTeam2: isScored(match) ? match.team2Score : 0,
  })));
}

function tournamentDataset(tournament, dayMatches = null) {
  const date = tournament?.tournamentDate;
  const matches = dayMatches || (Array.isArray(tournament?.rounds)
    ? roundMatches(tournament)
    : Store.getMatches().filter((match) => match.date === date));
  const canonicalMatches = [];
  const matchPlayers = [];
  matches.forEach((match, index) => {
    const key = {
      match_date: date,
      round_number: match.roundNumber,
      match_order: index + 1,
    };
    canonicalMatches.push({
      ...key,
      score_team_1: match.scoreTeam1,
      score_team_2: match.scoreTeam2,
    });
    [
      [1, 1, match.team1Player1Name],
      [1, 2, match.team1Player2Name],
      [2, 1, match.team2Player1Name],
      [2, 2, match.team2Player2Name],
    ].forEach(([team, position, playerName]) => {
      matchPlayers.push({
        ...key,
        team,
        position,
        player_name: playerName,
      });
    });
  });
  return {
    tournaments: [{
      tournament_date: date,
      status: tournament?.isCompleted ? 'completed' : 'active',
      current_round_number: tournament?.currentRoundNumber ?? null,
      completed_at: tournament?.completedAt
        ? new Date(tournament.completedAt).toISOString()
        : null,
      access_code: tournament?.accessCode ?? null,
      courts: Array.isArray(tournament?.courts) ? tournament.courts : null,
    }],
    tournament_players: (tournament?.players || []).map((player, index) => ({
      tournament_date: date,
      player_name: player.name,
      seed_position: player.id ?? index + 1,
      confirmed: player.confirmed === true,
    })),
    matches: canonicalMatches,
    match_players: matchPlayers,
  };
}

export function getBackendKind() {
  return Store.getSupabaseConfig() ? 'supabase' : 'unconfigured';
}

export const testConnection = supabase.testConnection;

export const fetchAuditEvents = supabase.listAuditEvents;

export async function pullForRoute(hash, options) {
  return supabase.pullForRoute(hash, options);
}

export async function pullDoodleMonth(yearMonth) {
  await supabase.loadDoodleMonth(yearMonth || undefined);
  return true;
}

export async function pullMonthlyOverview(yearMonth = null) {
  if (!yearMonth) return true;
  await supabase.loadMonth(yearMonth);
  return Store.getMonthlyOverview(yearMonth);
}

export async function ensureDayMatchesLoaded(date) {
  return supabase.loadDayMatches([date]);
}

/** Who played on which date: all history, or only the given months. */
export async function ensureParticipationLoaded(months = null) {
  await Promise.all([supabase.loadParticipation(months), supabase.loadManualAttendance()]);
  return Store.getParticipation();
}

export async function readDayMatches(date) {
  return ensureDayMatchesLoaded(date);
}

export async function pullAllMatches(onProgress) {
  await supabase.pullForRoute(FULL_SNAPSHOT_ROUTE, { force: true });
  const matches = Store.getMatches();
  onProgress?.('Supabase matches', matches.length, matches.length);
  return matches;
}

export const ensureAllMatchesLoaded = pullAllMatches;

const tournamentWrites = new Map();

/**
 * Each save replaces the whole tournament, so writes for one date run one at a
 * time and states queued behind a running write collapse into the latest one.
 * An older request can therefore never land after a newer one.
 */
function queueTournamentWrite(date, dataset) {
  let slot = tournamentWrites.get(date);
  if (!slot) {
    slot = { tail: Promise.resolve(), pending: null };
    tournamentWrites.set(date, slot);
  }
  if (slot.pending) {
    slot.pending.dataset = dataset;
    return slot.pending.promise;
  }
  const pending = { dataset };
  pending.promise = slot.tail.catch(() => {}).then(() => {
    slot.pending = null;
    return mutate('save_tournament', pending.dataset);
  });
  slot.pending = pending;
  slot.tail = pending.promise;
  pending.promise.finally(() => {
    if (slot.tail === pending.promise) tournamentWrites.delete(date);
  }).catch(() => {});
  return pending.promise;
}

export async function pushTournamentDayFile(tournament) {
  return queueTournamentWrite(tournament?.tournamentDate, tournamentDataset(tournament));
}

export async function pushCompletedTournament(date, dayMatches, indexEntry, { onStep } = {}) {
  onStep?.('push', 'running');
  const tournament = Store.getActiveTournament() || {
    tournamentDate: date,
    players: [...new Set(dayMatches.flatMap((match) => [
      match.team1Player1Name,
      match.team1Player2Name,
      match.team2Player1Name,
      match.team2Player2Name,
    ]))].map((name, index) => ({ id: index + 1, name })),
    isCompleted: indexEntry?.isComplete === true,
    completedAt: Date.now(),
  };
  await queueTournamentWrite(date, tournamentDataset(tournament, dayMatches));
  onStep?.('push', 'success');
  onStep?.('index', 'success');
}

export async function dispatchConfirmAttendance(date, playerName) {
  return mutate('confirm_attendance', { date, player_name: playerName });
}

/**
 * Persist a month of doodle availability.
 *
 * @param {string} yearMonth
 * @param {Array}  changes - only the changelog entries produced by this save.
 *   The changelog is a shared history owned by Supabase, so the client appends
 *   to it instead of replaying its own accumulated list.
 *
 * Only the changed players' entries are sent: members may write only their own
 * availability, so sending the whole shared month would be rejected.
 */
export async function pushDoodleNow(yearMonth, changes = []) {
  const changed = [...new Set(changes.map((change) => change.playerName))];
  const entries = Store.getDoodle(yearMonth);
  return mutate('save_doodle', {
    year_month: yearMonth,
    entries: changed.map((name) => entries.find((entry) => entry.name === name)
      || { name, selectedDates: [] }),
    changes,
  });
}

export async function addPlayerToPlayersJson(name) {
  await mutate('add_player', { name });
  await supabase.loadPlayers();
}

/**
 * Everything the manual-attendance editor needs. The save replaces the whole
 * list server-side, so existing entries must be loaded before editing.
 */
export async function ensureAttendanceEditData() {
  await Promise.all([
    supabase.loadPlayers(),
    supabase.loadManualAttendance(),
    supabase.loadTournamentIndex(),
  ]);
}

export async function saveManualAttendance(entries) {
  await mutate('save_manual_attendance', { entries });
  Store.setManualAttendance(entries);
}

export async function enqueueNotification(channel, eventType, payload, idempotencyKey) {
  return mutate('enqueue_notification', {
    channel,
    event_type: eventType,
    payload,
    idempotency_key: idempotencyKey,
  });
}

export function cancelPendingSync() {}
export function clearSessionTTL() {}
export function markMatchDateDirty() {}

export function getSyncStatus() {
  return syncStatus;
}

export function onSyncStatus(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function flushPush() {
  return Promise.resolve();
}

export async function updateTournamentIndexEntry() {
  supabase.invalidateReadCache();
  await supabase.loadTournamentIndex();
}

export async function removeTournamentIndexEntry(date) {
  return mutate('delete_tournament', { date });
}

export async function deleteTournamentDayFile(date) {
  return mutate('delete_tournament', { date });
}

export async function readPlayerSummary() {
  return null;
}

export async function pullMonthlyOverviewRaw(yearMonth) {
  const cached = Cache.get(`monthly_raw_${yearMonth}`);
  if (cached) return cached;
  await supabase.loadParticipation([yearMonth]);
  return Cache.get(`monthly_raw_${yearMonth}`) || [];
}

export async function fetchTournamentsIndexPublic() {
  await supabase.loadTournamentIndex();
  return Store.getTournamentsIndex();
}

/** Always re-reads the in-progress tournament (one small request). */
export async function fetchActiveTournamentJson() {
  await supabase.loadActiveTournament({ force: true });
  return Store.getActiveTournament();
}

function eloHistoryCacheKey(playerId) {
  return `elo_history_player_${String(playerId || '').trim()}`;
}

export async function pullEloHistoryForPlayerIds(playerIds = []) {
  await supabase.loadEloHistory(playerIds);
  const loadedPlayerIds = [];
  const missingPlayerIds = [];
  for (const playerId of playerIds) {
    if (Cache.has(eloHistoryCacheKey(playerId))) loadedPlayerIds.push(playerId);
    else missingPlayerIds.push(playerId);
  }
  return { loadedPlayerIds, missingPlayerIds };
}

export function getCachedEloHistoryForPlayerIds(playerIds = []) {
  return playerIds
    .map((playerId) => Cache.get(eloHistoryCacheKey(playerId)))
    .filter(Boolean);
}
