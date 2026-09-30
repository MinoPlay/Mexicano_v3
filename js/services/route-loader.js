import { perfStart } from './perf.js';

const routeOf = (hash) => (hash || '').replace(/^#/, '').split('?')[0] || '/';

/**
 * Loads a route's data and re-renders it once, only if new data arrived and the
 * user is still on that route (navigating away mid-load must not repaint).
 */
export function createRouteLoader({ pull, render, currentHash, onError = () => {} }) {
  return async function loadRoute(hash) {
    const done = perfStart(`route ${routeOf(hash)}`);
    try {
      const updated = await pull(hash);
      if (updated && routeOf(currentHash()) === routeOf(hash)) render();
      done({ updated: !!updated });
      return !!updated;
    } catch (error) {
      done({ error: error?.message });
      onError(error);
      return false;
    }
  };
}
