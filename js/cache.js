/**
 * In-memory cache for Supabase-owned data.
 * Ephemeral: cleared automatically on every page refresh, which guarantees the
 * UI always renders what the backend currently holds.
 * Use this instead of localStorage for anything pulled from Supabase.
 */

const _data = {};

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
};
