/**
 * Application state store.
 *
 * Storage policy (deliberate — do not widen without a good reason):
 *
 *  - localStorage holds ONLY three categories of state, all of which are owned
 *    by this device and have no representation in Supabase:
 *      1. backend configuration and authentication state
 *      2. user and device preferences
 *      3. page-specific preferences (owned by the individual page modules)
 *
 *  - Everything that lives in Supabase (matches, members, tournaments, doodle
 *    availability and its changelog, manual attendance, player summaries, ELO
 *    history, monthly projections) is held in the ephemeral in-memory `Cache`.
 *    It is therefore re-pulled on every page load and can never drift out of
 *    sync with the backend.
 *
 * Network persistence stays explicit through the backend service: writing here
 * only updates local state, it never starts an implicit remote write.
 */

import { Cache } from './cache.js';

const PREFIX = 'mexicano_';

/**
 * The complete set of keys this module is allowed to persist. Anything not
 * listed here is Supabase-owned and belongs in `Cache`.
 *
 * Page-specific preferences (`stats_*`, `elo-charts-prefs`, …) are written
 * directly by their page modules and are intentionally unprefixed, so they are
 * not listed and not touched here.
 */
const PERSISTED_KEYS = new Set([
  // 1. Backend configuration + authentication state
  'github_config',
  'supabase_config',
  'supabase_session',
  'access_role',
  'access_expires_at',
  'current_player_id',
  // 2. User + device preferences
  'current_user',
  'device_type',
  'logs_enabled',
  'theme',
  'round_log',
]);

// Administrator names, loaded from data/administrators.json at app init.
let administrators = [];

// Notify UI (e.g. bottom nav) that current user or admin list changed,
// so admin-gated items can re-render. Guarded for non-browser (test) envs.
function notifyUserChanged() {
  try {
    window.dispatchEvent(new Event('mexicano:user-changed'));
  } catch { /* no window (SSR/test) */ }
}

function assertPersistable(key) {
  if (PERSISTED_KEYS.has(key)) return true;
  console.warn(`[store] refusing to persist "${key}" — Supabase-owned state belongs in Cache`);
  return false;
}

export const Store = {
  /** Read a persisted preference / backend setting. */
  get(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  /** Write a persisted preference / backend setting. */
  set(key, value) {
    if (!assertPersistable(key)) return;
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) {
      console.error('Store.set error:', e);
    }
  },

  remove(key) {
    localStorage.removeItem(PREFIX + key);
  },

  /** Get all persisted keys that match a pattern (without prefix) */
  keys(pattern) {
    const results = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) {
        const stripped = k.slice(PREFIX.length);
        if (!pattern || stripped.startsWith(pattern)) {
          results.push(stripped);
        }
      }
    }
    return results;
  },

  /**
   * One-time cleanup for devices upgrading from the build that persisted
   * Supabase-owned data. Drops every `mexicano_` key outside the allowlist so
   * stale tournaments, matches and doodles can no longer shadow live data.
   */
  purgeNonPersistedKeys() {
    const stale = this.keys().filter(key => !PERSISTED_KEYS.has(key));
    stale.forEach(key => this.remove(key));
    return stale;
  },

  // ─── Supabase-owned domain data (in-memory only) ───

  getMatches() {
    return Cache.get('matches') || [];
  },

  setMatches(matches) {
    Cache.set('matches', matches);
  },

  getMembers() {
    return Cache.get('members') || [];
  },

  setMembers(members) {
    Cache.set('members', members);
  },

  getActiveTournament() {
    return Cache.get('active_tournament') || null;
  },

  setActiveTournament(tournament) {
    Cache.set('active_tournament', tournament);
  },

  clearActiveTournament() {
    Cache.del('active_tournament');
  },

  getDoodle(yearMonth) {
    return Cache.get(`doodle_${yearMonth}`) || [];
  },

  setDoodle(yearMonth, entries) {
    Cache.set(`doodle_${yearMonth}`, entries);
  },

  getDoodleChangelog(yearMonth) {
    return Cache.get(`doodle_changelog_${yearMonth}`) || [];
  },

  setDoodleChangelog(yearMonth, entries) {
    Cache.set(`doodle_changelog_${yearMonth}`, entries);
  },

  // Manual (no-tournament) attendance entries.
  // Shape: [{ date: 'YYYY-MM-DD', players: ['Name', ...], note: '' }]

  getManualAttendance() {
    return Cache.get('attendance_manual') || [];
  },

  setManualAttendance(entries) {
    Cache.set('attendance_manual', entries);
  },

  // ─── User identity ───

  getCurrentUser() {
    return this.get('current_user') || '';
  },

  setCurrentUser(name) {
    this.set('current_user', name);
    notifyUserChanged();
  },

  setAdministrators(list) {
    administrators = (list || []).map(name => String(name).toLowerCase());
    notifyUserChanged();
  },

  getAdministrators() {
    return administrators;
  },

  isAdministrator() {
    if (this.getSupabaseConfig()) {
      return this.getAccessRole() === 'admin';
    }
    const user = this.getCurrentUser().toLowerCase();
    return administrators.includes(user);
  },

  // ─── Logs feature toggle ───
  // Default disabled when nothing stored.

  isLogsEnabled() {
    const v = this.get('logs_enabled');
    return v === null ? false : !!v;
  },

  setLogsEnabled(enabled) {
    this.set('logs_enabled', !!enabled);
    notifyUserChanged();
  },

  // ─── Device type (Android/iPhone) — iPhone gets extra top padding ───
  // Default 'android' when nothing stored (no extra padding, prior behavior).

  getDeviceType() {
    const v = this.get('device_type');
    return v === 'iphone' ? 'iphone' : 'android';
  },

  setDeviceType(type) {
    this.set('device_type', type === 'iphone' ? 'iphone' : 'android');
    this.applyDeviceType();
  },

  /** Toggle `device-iphone` body class from the currently stored device type. */
  applyDeviceType() {
    try {
      document.body.classList.toggle('device-iphone', this.getDeviceType() === 'iphone');
    } catch { /* no document (SSR/test without DOM) */ }
  },

  // ─── GitHub Backend config ───

  getGitHubConfig() {
    return this.get('github_config') || null;
  },

  setGitHubConfig(cfg) {
    // cfg: { owner, repo, pat }  — stored as-is in localStorage
    this.set('github_config', cfg);
  },

  clearGitHubConfig() {
    this.remove('github_config');
  },

  // ─── Supabase Backend config/session ───

  getSupabaseConfig() {
    return this.get('supabase_config') || null;
  },

  setSupabaseConfig(cfg) {
    const url = String(cfg?.url || '').replace(/\/$/, '');
    const anonKey = String(cfg?.anonKey || '');
    if (!url || !anonKey) throw new Error('Supabase URL and public anon key are required');
    this.set('supabase_config', { url, anonKey });
  },

  clearSupabaseConfig() {
    this.remove('supabase_config');
  },

  getSupabaseSession() {
    return this.get('supabase_session');
  },

  setSupabaseSession(session) {
    this.set('supabase_session', session);
  },

  clearSupabaseSession() {
    this.remove('supabase_session');
    this.remove('access_role');
    this.remove('access_expires_at');
    this.remove('current_player_id');
  },

  getCurrentPlayerId() {
    return this.get('current_player_id');
  },

  setCurrentPlayerId(playerId) {
    this.set('current_player_id', playerId);
  },

  setAccessGrant({ role = 'member', expires_at: expiresAt = null } = {}) {
    this.set('access_role', role);
    this.set('access_expires_at', expiresAt);
    notifyUserChanged();
  },

  getAccessRole() {
    return this.get('access_role') || '';
  },

  getAccessExpiry() {
    return this.get('access_expires_at');
  },

  // ─── Derived / pre-computed Supabase data (in-memory only) ───

  getPlayersSummary() {
    return Cache.get('players_summary') || [];
  },

  setPlayersSummaryCache(data) {
    Cache.set('players_summary', data);
  },

  getTournamentDates() {
    const cached = Cache.get('tournament_dates');
    if (Array.isArray(cached) && cached.length) return cached;
    return this.getTournamentsIndex()
      .map(entry => entry.date || entry.tournament_date)
      .filter(Boolean)
      .sort();
  },

  getMonthlyOverview(yearMonth) {
    return Cache.get(`monthly_${yearMonth}`) || [];
  },

  /** Loaded tournament participation: [{ date, players: [names] }], by date. */
  getParticipation() {
    return Cache.keys('participation_')
      .filter(k => /^participation_\d{4}-\d{2}$/.test(k))
      .sort()
      .flatMap(k => Cache.get(k) || []);
  },

  /** True once participation for all history is loaded (not just some months). */
  isParticipationComplete() {
    return Cache.has('supabase_res_participation_all') || Cache.has('supabase_snapshot_loaded');
  },

  getMonthlyOverviewMonths() {
    return Cache.keys('monthly_')
      .map(k => k.replace('monthly_', ''))
      .filter(k => /^\d{4}-\d{2}$/.test(k))
      .sort();
  },

  isMatchesFullyLoaded() {
    return Cache.get('matches_fully_loaded') === true;
  },

  setMatchesFullyLoaded(loaded) {
    Cache.set('matches_fully_loaded', !!loaded);
  },

  getTournamentsIndex() {
    return Cache.get('tournaments_index') || [];
  },

  setTournamentsIndex(entries) {
    Cache.set('tournaments_index', entries);
  },

  // ─── Export ───

  /** Snapshot of everything this device persists — diagnostics only. */
  exportAll() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) {
        try {
          data[k.slice(PREFIX.length)] = JSON.parse(localStorage.getItem(k));
        } catch {
          data[k.slice(PREFIX.length)] = localStorage.getItem(k);
        }
      }
    }
    return data;
  },
};
