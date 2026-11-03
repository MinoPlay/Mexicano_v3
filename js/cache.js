/**
 * In-memory cache for Supabase-owned data.
 * Ephemeral: cleared automatically on every page refresh, which guarantees the
 * UI always renders what the backend currently holds.
 * Use this instead of localStorage for anything pulled from Supabase.
 */

const _data = {};

// Outside the `mexicano_` prefix so Store.purgeNonPersistedKeys() keeps it.
export const OFFLINE_SNAPSHOT_KEY = 'mexicano-offline-cache';

export const Cache = {
  get(key) {
    return _data[key] ?? null;
  },

  set(key, value) {
    _data[key] = value;
  },

  has(key) {
    return _data[key] != null;
  },

  del(key) {
    delete _data[key];
  },

  /** Drop everything. Used when resetting state (e.g. between tests). */
  clear() {
    for (const key of Object.keys(_data)) delete _data[key];
  },

  /** Return all keys that start with the given prefix. */
  keys(prefix = '') {
    return Object.keys(_data).filter(k => k.startsWith(prefix));
  },

  /**
   * Offline fallback only: the last successfully loaded data is saved so an
   * offline reload can still render. Online starts never read it.
   */
  persistSnapshot() {
    try {
      localStorage.setItem(OFFLINE_SNAPSHOT_KEY, JSON.stringify(_data));
      return true;
    } catch {
      return false;
    }
  },

  hydrateSnapshot() {
    try {
      const snapshot = JSON.parse(localStorage.getItem(OFFLINE_SNAPSHOT_KEY));
      if (!snapshot || typeof snapshot !== 'object') return false;
      Object.assign(_data, snapshot);
      return true;
    } catch {
      return false;
    }
  },

  clearSnapshot() {
    try { localStorage.removeItem(OFFLINE_SNAPSHOT_KEY); } catch { /* ignore */ }
  },
};
