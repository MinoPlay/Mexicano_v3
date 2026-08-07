/**
 * Supabase backend service.
 *
 * Mirrors the public surface of services/github.js but persists RAW
 * source-of-truth to Supabase (Postgres) instead of GitHub JSON files.
 * Everything the GitHub backend pre-computed (ELO, stats, monthly overviews,
 * per-player elo_history, tournaments index) is derived at runtime here via
 * services/derive.js.
 *
 * The Supabase JS client is loaded lazily from an ESM CDN (no build step) and
 * only when a Supabase config is present, so unit tests and the GitHub path are
 * unaffected.
 */
import { Store } from '../store.js';
import { Cache } from '../cache.js';
import {
  buildPlayersSummary,
  buildMonthlyOverview,
  computeTournamentDates,
  buildTournamentsIndex,
  buildEloHistoryFile,
} from './derive.js';

const SUPABASE_ESM = 'https://esm.sh/@supabase/supabase-js@2';

export function getConfig() {
  return Store.getSupabaseConfig();
}

let _clientPromise = null;
async function getClient() {
  const cfg = getConfig();
  if (!cfg?.url || !cfg?.anonKey) return null;
  if (!_clientPromise) {
    _clientPromise = import(/* @vite-ignore */ SUPABASE_ESM)
      .then(({ createClient }) => createClient(cfg.url, cfg.anonKey))
      .catch(err => { _clientPromise = null; throw err; });
  }
  return _clientPromise;
}

// ─── Row ↔ match converters ──────────────────────────────────────────────────
export function rowToMatch(r) {
  const m = {
    date: r.match_date,
    roundNumber: r.round_number,
    scoreTeam1: r.score_team1,
    scoreTeam2: r.score_team2,
    team1Player1Name: r.team1_player1_name,
    team1Player2Name: r.team1_player2_name,
    team2Player1Name: r.team2_player1_name,
    team2Player2Name: r.team2_player2_name,
  };
  if (r.team1_player1_elo != null) m.team1Player1Elo = r.team1_player1_elo;
  if (r.team1_player2_elo != null) m.team1Player2Elo = r.team1_player2_elo;
  if (r.team2_player1_elo != null) m.team2Player1Elo = r.team2_player1_elo;
  if (r.team2_player2_elo != null) m.team2Player2Elo = r.team2_player2_elo;
  return m;
}

export function matchToRow(m) {
  const r = {
    match_date: m.date,
    round_number: m.roundNumber,
    score_team1: m.scoreTeam1 ?? 0,
    score_team2: m.scoreTeam2 ?? 0,
    team1_player1_name: m.team1Player1Name,
    team1_player2_name: m.team1Player2Name,
    team2_player1_name: m.team2Player1Name,
    team2_player2_name: m.team2Player2Name,
  };
  if (m.team1Player1Elo != null) r.team1_player1_elo = m.team1Player1Elo;
  if (m.team1Player2Elo != null) r.team1_player2_elo = m.team1Player2Elo;
  if (m.team2Player1Elo != null) r.team2_player1_elo = m.team2Player1Elo;
  if (m.team2Player2Elo != null) r.team2_player2_elo = m.team2Player2Elo;
  return r;
}

// ─── Derived-cache rebuild (mirrors github.js pull side-effects) ─────────────
function rebuildDerived(matches, registry) {
  Store.setPlayersSummaryCache(buildPlayersSummary(matches, registry));
  Cache.set('tournament_dates', computeTournamentDates(matches));
  Store.setTournamentsIndex(buildTournamentsIndex(matches));

  const names = new Set((registry || []).map(r => r.name));
  for (const m of matches) {
    names.add(m.team1Player1Name); names.add(m.team1Player2Name);
    names.add(m.team2Player1Name); names.add(m.team2Player2Name);
  }
  const members = [...names].filter(Boolean).sort();
  Cache.set('members', members);
  Store.setMembers(members);

  for (const ym of new Set(matches.map(m => (m.date || '').slice(0, 7)).filter(Boolean))) {
    Cache.set(`monthly_${ym}`, buildMonthlyOverview(matches, ym));
  }
}

let _registry = [];

// PostgREST caps every select at 1000 rows by default. Page through with
// .range() so tables larger than one page (e.g. matches) load fully.
const PAGE_SIZE = 1000;
async function selectAll(client, table, columns = '*') {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select(columns)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Supabase ${table} read failed: ${error.message}`);
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

/** Load ALL raw data from Supabase into Store/Cache and rebuild derived caches. */
async function loadAll() {
  const c = await getClient();
  if (!c) return false;

  const matchRows = await selectAll(c, 'matches', '*');
  const matches = matchRows.map(rowToMatch);
  Store.setMatches(matches);
  try { localStorage.setItem('mexicano_matches_fully_loaded', 'true'); } catch { /* ignore */ }

  const { data: playerRows } = await c.from('players').select('name, match_padel_id');
  _registry = (playerRows || []).map(r => ({ name: r.name, matchPadelId: r.match_padel_id }));

  rebuildDerived(matches, _registry);

  const { data: at } = await c.from('active_tournament').select('data').eq('id', true).maybeSingle();
  if (at?.data && !at.data.isCompleted) {
    Store.setActiveTournament(at.data);
  } else if (Store.getActiveTournament()) {
    Store.clearActiveTournament();
  }

  const { data: att } = await c.from('attendance_manual').select('*');
  Store.setManualAttendance((att || []).map(r => ({ date: r.entry_date, players: r.players || [], note: r.note || '' })));

  const { data: cl } = await c.from('changelog').select('entry').order('created_at', { ascending: false });
  Store.setChangelog((cl || []).map(r => r.entry));

  const { data: admins } = await c.from('administrators').select('name');
  Store.setAdministrators((admins || []).map(r => r.name));

  return true;
}

// ─── Read pulls (all funnel to loadAll, then compute-from-Store) ─────────────
export async function pullForRoute(hash) {
  const c = await getClient();
  if (!c) throw new Error('Supabase not configured');
  _isPulling = true;
  try {
    const updated = await loadAll();
    const path = (hash || '').replace(/^#/, '').split('?')[0] || '/';
    if (path === '/doodle') {
      const now = new Date();
      for (const offset of [0, 1]) {
        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        await pullDoodleMonth(ym);
      }
    }
    return { updated };
  } finally {
    _isPulling = false;
  }
}

export async function refreshCurrentPage(hash, onStep) {
  onStep?.('add', 'Loading from Supabase', 'loading');
  const result = await pullForRoute(hash);
  onStep?.('update', 'Loading from Supabase', 'done');
  return result;
}

export async function ensureAllMatchesLoaded() {
  if (Store.getMatches().length && Cache.has('players_summary')) return Store.getMatches();
  await loadAll();
  return Store.getMatches();
}

export async function readDayMatches(date) {
  const c = await getClient();
  if (!c) return [];
  const { data } = await c.from('matches').select('*').eq('match_date', date);
  return (data || []).map(rowToMatch);
}

export async function ensureDayMatchesLoaded(date) {
  const cached = Store.getMatches().filter(m => m.date === date);
  if (cached.length > 0) return cached;
  const fetched = await readDayMatches(date);
  if (fetched.length > 0) {
    const all = [...Store.getMatches(), ...fetched];
    Store.setMatches(all);
    rebuildDerived(all, _registry);
  }
  return fetched;
}

export async function pullMonthlyOverview(yearMonth) {
  await ensureAllMatchesLoaded();
  const had = Cache.has(`monthly_${yearMonth}`);
  Cache.set(`monthly_${yearMonth}`, buildMonthlyOverview(Store.getMatches(), yearMonth));
  return { updated: !had };
}

/** Raw monthly overview with per-player ELO arrays (attendance feature). */
export async function pullMonthlyOverviewRaw(yearMonth) {
  await ensureAllMatchesLoaded();
  const cacheKey = `monthly_raw_${yearMonth}`;
  const matches = Store.getMatches();
  const players = {};
  for (const p of buildPlayersSummary(matches.filter(m => (m.date || '').slice(0, 7) <= yearMonth), _registry)) {
    players[p.name] = p;
  }
  // Shape mirrors players_overview.json entries enough for attendance: Name + ELO array.
  const raw = buildMonthlyOverview(matches, yearMonth).map(o => ({
    Name: o.name,
    Total_Points: o.totalPoints,
    Wins: o.wins,
    Losses: o.losses,
    Average: o.average,
    ELO: [{ Date: `${yearMonth}-01`, ELO: o.elo }],
  }));
  Cache.set(cacheKey, raw);
  return raw;
}

export async function pullAllOverviews() {
  await ensureAllMatchesLoaded();
  const matches = Store.getMatches();
  let updated = false;
  for (const ym of new Set(matches.map(m => (m.date || '').slice(0, 7)).filter(Boolean))) {
    if (!Cache.has(`monthly_${ym}`)) updated = true;
    Cache.set(`monthly_${ym}`, buildMonthlyOverview(matches, ym));
  }
  return { updated };
}

export async function fetchTournamentsIndexPublic() {
  await ensureAllMatchesLoaded();
  return Store.getTournamentsIndex();
}

export async function fetchActiveTournamentJson() {
  const c = await getClient();
  if (!c) return null;
  const { data } = await c.from('active_tournament').select('data').eq('id', true).maybeSingle();
  return data?.data ?? null;
}

// ─── Per-player ELO history (derived) ────────────────────────────────────────
function eloCacheKey(playerId) {
  return `elo_history_player_${String(playerId || '').trim()}`;
}

export async function pullEloHistoryForPlayerIds(playerIds = []) {
  await ensureAllMatchesLoaded();
  const matches = Store.getMatches();
  const ids = [...new Set(playerIds.map(id => String(id || '').trim()).filter(Boolean))];
  const loadedPlayerIds = [];
  const missingPlayerIds = [];
  for (const id of ids) {
    // Runtime id == player name (see derive.buildPlayersSummary).
    const file = buildEloHistoryFile(matches, id);
    if (file.points.length > 0) {
      Cache.set(eloCacheKey(id), file);
      loadedPlayerIds.push(id);
    } else {
      Cache.set(eloCacheKey(id), { missing: true, playerId: id });
      missingPlayerIds.push(id);
    }
  }
  return { loadedPlayerIds, missingPlayerIds };
}

export function getCachedEloHistoryForPlayerIds(playerIds = []) {
  const ids = [...new Set(playerIds.map(id => String(id || '').trim()).filter(Boolean))];
  const out = [];
  for (const id of ids) {
    const item = Cache.get(eloCacheKey(id));
    if (item && !item.missing) out.push(item);
  }
  return out;
}

export async function readPlayerSummary() {
  // GitHub served pre-generated per-player summary files; derived at runtime now.
  return null;
}

// ─── Doodle ──────────────────────────────────────────────────────────────────
export async function pullDoodleMonth(yearMonth) {
  const c = await getClient();
  if (!c) return { content: null, changelog: null, updated: false };
  const { data } = await c.from('doodle').select('entries, changelog').eq('year_month', yearMonth).maybeSingle();
  const content = Array.isArray(data?.entries) ? data.entries : null;
  const changelog = Array.isArray(data?.changelog) ? data.changelog : null;
  let updated = false;
  if (content) {
    const existing = localStorage.getItem(`mexicano_doodle_${yearMonth}`);
    if (existing !== JSON.stringify(content)) updated = true;
  }
  if (changelog) {
    const existing = localStorage.getItem(`mexicano_doodle_changelog_${yearMonth}`);
    if (existing !== JSON.stringify(changelog)) updated = true;
  }
  return { content, changelog, updated };
}

export async function pushDoodleNow(yearMonth) {
  const c = await getClient();
  if (!c) return;
  const entries = Store.getDoodle(yearMonth);
  const changelog = Store.getDoodleChangelog(yearMonth);
  const { error } = await c.from('doodle').upsert(
    { year_month: yearMonth, entries, changelog, updated_at: new Date().toISOString() },
    { onConflict: 'year_month' }
  );
  if (error) throw new Error(`Supabase doodle push failed: ${error.message}`);
}

export function clearSessionTTL() { /* no session TTL for Supabase */ }

// ─── Players registry ────────────────────────────────────────────────────────
export async function addPlayerToPlayersJson(name) {
  const c = await getClient();
  if (!c) throw new Error('Supabase not configured');
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Player name is required.');
  const { error } = await c.from('players').insert({ name: trimmed });
  if (error) {
    if (error.code === '23505') throw new Error(`Player "${trimmed}" already exists.`);
    throw new Error(`Supabase add player failed: ${error.message}`);
  }
  _registry = [..._registry, { name: trimmed, matchPadelId: null }];
  const members = [...new Set([...Store.getMembers(), trimmed])].sort();
  Store.setMembers(members);
  Cache.set('members', members);
}

// ─── Connection test ─────────────────────────────────────────────────────────
export async function testConnection() {
  const cfg = getConfig();
  if (!cfg?.url || !cfg?.anonKey) return { ok: false, message: 'Missing Supabase URL or anon key' };
  try {
    const c = await getClient();
    const { error } = await c.from('players').select('name', { count: 'exact', head: true });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: 'Connected to Supabase' };
  } catch (e) {
    return { ok: false, message: e.message || 'Network error' };
  }
}

// ─── Write helpers (delete-then-insert per date keeps rows in sync) ──────────
async function writeDayMatches(date) {
  const c = await getClient();
  if (!c) return;
  const dayMatches = Store.getMatches().filter(m => m.date === date &&
    !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0));
  const del = await c.from('matches').delete().eq('match_date', date);
  if (del.error) throw new Error(`Supabase delete day failed: ${del.error.message}`);
  if (dayMatches.length > 0) {
    const ins = await c.from('matches').insert(dayMatches.map(matchToRow));
    if (ins.error) throw new Error(`Supabase insert day failed: ${ins.error.message}`);
  }
}

async function writeActiveTournament() {
  const c = await getClient();
  if (!c) return;
  const at = Store.getActiveTournament();
  if (at && !at.isCompleted) {
    const { error } = await c.from('active_tournament').upsert(
      { id: true, data: at, updated_at: new Date().toISOString() }, { onConflict: 'id' }
    );
    if (error) throw new Error(`Supabase active_tournament push failed: ${error.message}`);
  } else {
    await c.from('active_tournament').delete().eq('id', true);
  }
}

async function writeAttendanceManual() {
  const c = await getClient();
  if (!c) return;
  const entries = Store.getManualAttendance();
  await c.from('attendance_manual').delete().neq('entry_date', '0001-01-01');
  if (entries.length > 0) {
    const rows = entries.filter(e => e.date).map(e => ({
      entry_date: e.date, players: e.players || [], note: e.note || '',
    }));
    const { error } = await c.from('attendance_manual').insert(rows);
    if (error) throw new Error(`Supabase attendance push failed: ${error.message}`);
  }
}

async function writeChangelog() {
  const c = await getClient();
  if (!c) return;
  const entries = Store.getChangelog();
  await c.from('changelog').delete().gte('id', 0);
  if (entries.length > 0) {
    const { error } = await c.from('changelog').insert(entries.map(entry => ({ entry })));
    if (error) throw new Error(`Supabase changelog push failed: ${error.message}`);
  }
}

// ─── Push queue (debounced + serialised) — mirrors github.js semantics ───────
let _syncTimer = null;
let _syncStatus = 'idle';
let _isPulling = false;
let _pushInProgress = false;
let _pushPending = false;
const _afterAllPushResolvers = [];
const _listeners = new Set();
const _dirtyMatchDates = new Set();
const _pendingKeys = new Set();

export function markMatchDateDirty(date) {
  if (date) _dirtyMatchDates.add(date);
}

export function onSyncStatus(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function setSyncStatus(s) {
  _syncStatus = s;
  _listeners.forEach(fn => fn(s));
}

export function getSyncStatus() {
  return _syncStatus;
}

async function pushPending() {
  const keys = new Set(_pendingKeys);
  _pendingKeys.clear();
  const dates = new Set(_dirtyMatchDates);

  for (const date of dates) {
    await writeDayMatches(date);
    _dirtyMatchDates.delete(date);
  }
  if (keys.has('matches') || keys.has('active_tournament') || dates.size > 0) {
    await writeActiveTournament();
  }
  if (keys.has('attendance_manual')) await writeAttendanceManual();
  if (keys.has('changelog')) await writeChangelog();
}

async function executePush() {
  if (_pushInProgress) {
    _pushPending = true;
    return new Promise(resolve => { _afterAllPushResolvers.push(resolve); });
  }
  _pushInProgress = true;
  setSyncStatus('syncing');
  try {
    await pushPending();
    setSyncStatus('success');
    setTimeout(() => setSyncStatus('idle'), 3000);
  } catch (e) {
    console.error('Supabase auto-sync failed:', e);
    setSyncStatus('error');
  } finally {
    _pushInProgress = false;
    if (_pushPending) {
      _pushPending = false;
      await executePush();
    }
    const resolvers = _afterAllPushResolvers.splice(0);
    resolvers.forEach(fn => fn());
  }
}

export function schedulePush(key) {
  if (_isPulling) return;
  if (!getConfig()?.url) return;
  if (key.startsWith('doodle_')) return; // pushed explicitly via pushDoodleNow
  const SYNCED = ['matches', 'active_tournament', 'attendance_manual', 'changelog'];
  if (!SYNCED.includes(key)) return;
  if (key === 'matches') {
    // Mark every match date dirty when the whole matches array is written.
    for (const m of Store.getMatches()) if (m.date) _dirtyMatchDates.add(m.date);
  }
  _pendingKeys.add(key);
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => executePush(), 1500);
}

export function cancelPendingSync() {
  clearTimeout(_syncTimer);
  _syncTimer = null;
}

export function flushPush() {
  if (!getConfig()?.url) return Promise.resolve();
  clearTimeout(_syncTimer);
  return executePush();
}

// ─── Tournament-specific writes (called by services/tournament.js) ──────────
export async function pushTournamentDayFile(tournament) {
  const date = tournament?.tournamentDate;
  if (!date) throw new Error('pushTournamentDayFile: missing tournamentDate');
  markMatchDateDirty(date);
  await writeDayMatches(date);
  await writeActiveTournament();
  return true;
}

/** Index is derived at runtime — just keep the local Store index fresh. */
export async function updateTournamentIndexEntry() {
  Store.setTournamentsIndex(buildTournamentsIndex(Store.getMatches()));
}

export async function removeTournamentIndexEntry() {
  Store.setTournamentsIndex(buildTournamentsIndex(Store.getMatches()));
}

export async function deleteTournamentDayFile(date) {
  const c = await getClient();
  if (!c) return;
  const { error } = await c.from('matches').delete().eq('match_date', date);
  if (error) throw new Error(`Supabase delete tournament failed: ${error.message}`);
  const remaining = Store.getMatches().filter(m => m.date !== date);
  Store.setMatches(remaining);
  rebuildDerived(remaining, _registry);
}

export async function listBackupFiles() {
  return [];
}
