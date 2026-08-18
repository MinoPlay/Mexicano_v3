/**
 * Shared HTTP helpers.
 *
 * Every outbound request in this app talks to api.github.com. Without a hard
 * timeout a stalled connection (common on mobile, even when "online") leaves a
 * fetch pending forever — which is exactly what made the End Tournament
 * progress dialog hang with nothing happening.
 *
 * `fetchWithTimeout` bounds a single attempt. `fetchWithRetry` walks a short
 * escalating timeout ladder so the fast path fails fast (2s) while a
 * slow-but-alive link still lands on one more, slightly more patient attempt.
 * The whole ladder is capped at 5s so no click can block longer than that per
 * request.
 */

/** Default ladder for user-blocking flows: 2s then 3s, 5s total. */
export const FAST_TIMEOUTS = [2000, 3000];

/** Ladder for background work; still capped at a single 5s attempt. */
export const BACKGROUND_TIMEOUTS = [5000];

/**
 * fetch() with a hard timeout. Aborts the underlying request and rejects with a
 * clear "timed out" error once timeoutMs elapses, even if the network never
 * responds.
 */
export function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([
    fetch(url, { ...options, signal: controller.signal }),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

/**
 * fetch() with an escalating timeout ladder. Only *stalled* attempts are
 * retried — a server that answered (even with 4xx/5xx) is returned as-is so
 * callers keep their existing status handling (e.g. 409 SHA conflicts).
 *
 * @param {string} url
 * @param {object} [options]  - fetch options
 * @param {object} [cfg]
 * @param {number[]} [cfg.timeouts=FAST_TIMEOUTS] - per-attempt timeouts
 */
export async function fetchWithRetry(url, options = {}, { timeouts = FAST_TIMEOUTS } = {}) {
  let lastErr;
  for (const timeoutMs of timeouts) {
    try {
      return await fetchWithTimeout(url, options, timeoutMs);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Request failed');
}
