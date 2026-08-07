/**
 * localStorage wrapper for persistent data.
 * All data keyed with 'mexicano_' prefix.
 *
 * Read-only GitHub data (players_summary, tournament_dates, monthly_*,
 * elo_history, tournaments_index) is stored in the ephemeral in-memory Cache
 * instead of localStorage so it is always pulled fresh on every page refresh.
 *
 * When a GitHub config is present, every set() call schedules a debounced
 * push via the GitHub service (imported lazily to avoid circular deps).
 */

import { Cache } from './cache.js';

const PREFIX = 'mexicano_';

// Administrator names, loaded from data/administrators.json at app init.
let administrators = [];

// Notify UI (e.g. bottom nav) that current user or admin list changed,
// so admin-gated items can re-render. Guarded for non-browser (test) envs.
function notifyUserChanged() {
  try {
    window.dispatchEvent(new Event('mexicano:user-changed'));
  } catch { /* no window (SSR/test) */ }
}

export const Store = {
  get(key) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      // Trigger debounced auto-push (lazy import to avoid circular deps)
      import('./services/backend.js').then(({ schedulePush }) => schedulePush(key)).catch(() => {});
    } catch (e) {
      console.error('Store.set error:', e);
    }
  },

  remove(key) {
    localStorage.removeItem(PREFIX + key);
  },

  /** Get all keys that match a pattern (without prefix) */
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

  // ─── Domain-specific helpers ───

  getMatches() {
    return this.get('matches') || [];
  },

  setMatches(matches) {
    this.set('matches', matches);
  },

  getMembers() {
    return Cache.get('members') || this.get('members') || [];
  },

  setMembers(members) {
    this.set('members', members);
    Cache.set('members', members);
  },

  getActiveTournament() {
    return this.get('active_tournament');
  },

  setActiveTournament(tournament) {
    this.set('active_tournament', tournament);
  },

  clearActiveTournament() {
    this.remove('active_tournament');
  },

  getDoodle(yearMonth) {
    return this.get(`doodle_${yearMonth}`) || [];
  },

  setDoodle(yearMonth, entries) {
    this.set(`doodle_${yearMonth}`, entries);
  },

  // ─── Manual (no-tournament) attendance entries ───
  // Single global synced file: data/attendance_manual.json
  // Shape: [{ date: 'YYYY-MM-DD', players: ['Name', ...], note: '' }]

  getManualAttendance() {
    return this.get('attendance_manual') || [];
  },

  setManualAttendance(entries) {
    this.set('attendance_manual', entries);
  },

  getDoodleChangelog(yearMonth) {
    return this.get(`doodle_changelog_${yearMonth}`) || [];
  },

  setDoodleChangelog(yearMonth, entries) {
    this.set(`doodle_changelog_${yearMonth}`, entries);
  },

  getChangelog() {
    return this.get('changelog') || [];
  },

  setChangelog(entries) {
    this.set('changelog', entries.slice(0, 20));
  },

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

  // ─── Supabase Backend config ───

  getSupabaseConfig() {
    return this.get('supabase_config') || null;
  },

  setSupabaseConfig(cfg) {
    // cfg: { url, anonKey } — stored as-is in localStorage
    this.set('supabase_config', cfg);
  },

  clearSupabaseConfig() {
    this.remove('supabase_config');
  },

  /** True when either backend (Supabase preferred, GitHub fallback) is configured. */
  isBackendConfigured() {
    const sb = this.getSupabaseConfig();
    if (sb?.url && sb?.anonKey) return true;
    return !!this.getGitHubConfig()?.pat;
  },

  /** Which backend is active: 'supabase' | 'github' | null. */
  activeBackend() {
    const sb = this.getSupabaseConfig();
    if (sb?.url && sb?.anonKey) return 'supabase';
    if (this.getGitHubConfig()?.pat) return 'github';
    return null;
  },

  // ─── Summary data (pre-computed from Python scripts, read-only) ───

  getPlayersSummary() {
    return Cache.get('players_summary') || this.get('players_summary_cache') || [];
  },

  /** Persist players_summary to both in-memory Cache and localStorage warm-start cache. */
  setPlayersSummaryCache(data) {
    Cache.set('players_summary', data);
    try { localStorage.setItem(PREFIX + 'players_summary_cache', JSON.stringify(data)); } catch { /* storage full */ }
  },

  getTournamentDates() {
    return Cache.get('tournament_dates') || [];
  },

  getMonthlyOverview(yearMonth) {
    return Cache.get(`monthly_${yearMonth}`) || [];
  },

  getMonthlyOverviewMonths() {
    return Cache.keys('monthly_')
      .map(k => k.replace('monthly_', ''))
      .filter(k => /^\d{4}-\d{2}$/.test(k))
      .sort();
  },

  isMatchesFullyLoaded() {
    return this.get('matches_fully_loaded') === true;
  },

  getTournamentsIndex() {
    return Cache.get('tournaments_index') || [];
  },

  /** Write tournaments index to in-memory cache only (managed explicitly via
   *  updateTournamentIndexEntry in github.js). */
  setTournamentsIndex(entries) {
    Cache.set('tournaments_index', entries);
  },

  // ─── Import / Export ───

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

  importAll(data) {
    // Clear existing mexicano data
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    // Import new data
    for (const [key, value] of Object.entries(data)) {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    }
  }
};
