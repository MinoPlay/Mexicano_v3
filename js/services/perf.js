/**
 * Opt-in load timing. Enable with `?perf=1` (URL or hash query) or
 * `localStorage['perf-log'] = '1'`; `?perf=0` disables. Logs `[perf]` lines
 * to the console and keeps entries for inspection via `getPerfEntries()`.
 */
const STORAGE_KEY = 'perf-log';
const entries = [];

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function urlFlag() {
  try {
    const match = `${location.search}${location.hash}`.match(/[?&]perf=([01])/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function isPerfEnabled() {
  try {
    const flag = urlFlag();
    if (flag === '1') localStorage.setItem(STORAGE_KEY, '1');
    if (flag === '0') localStorage.removeItem(STORAGE_KEY);
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Start a timer; call the returned function (optionally with details) to record it. */
export function perfStart(label) {
  if (!isPerfEnabled()) return () => {};
  const start = now();
  return (details = {}) => {
    const entry = { label, ms: Math.round(now() - start), at: Math.round(start), ...details };
    entries.push(entry);
    console.info(`[perf] ${label} ${entry.ms}ms`, details);
  };
}

export function getPerfEntries() {
  return [...entries];
}

export function clearPerfEntries() {
  entries.length = 0;
}

if (typeof window !== 'undefined') {
  window.__mexicanoPerf = { entries: getPerfEntries, clear: clearPerfEntries };
}
