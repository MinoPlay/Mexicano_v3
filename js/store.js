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
      import('./services/github.js').then(({ schedulePush }) => schedulePush(key)).catch(() => {});
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
  },

  isMino() {
    return this.getCurrentUser().toLowerCase() === 'mino';
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

  // ─── Summary data (pre-computed from Python scripts, read-only) ───

  getPlayersSummary() {
    return Cache.get('players_summary') || [];
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
