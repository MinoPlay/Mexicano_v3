/**
 * In-memory cache for read-only GitHub data.
 * Ephemeral: cleared automatically on every page refresh.
 * Use this instead of localStorage for data pulled from GitHub.
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

  /** Return all keys that start with the given prefix. */
  keys(prefix = '') {
    return Object.keys(_data).filter(k => k.startsWith(prefix));
  },
};
