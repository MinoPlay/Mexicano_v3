/**
 * Simple hash-based SPA router.
 * Routes map hash paths to page render functions.
 */
import { State } from './state.js';

export class Router {
  constructor(routes, container) {
    this.routes = routes;
    this.container = container;
    this._currentCleanup = null;
    this._isResolving = false;
    this._pendingHash = null;

    window.addEventListener('hashchange', () => this.resolve());
    window.addEventListener('load', () => this.resolve());
  }

  async resolve() {
    // Prevent multiple simultaneous resolutions
    if (this._isResolving) {
      this._pendingHash = window.location.hash;
      return;
    }

    this._isResolving = true;

    try {
      const hash = window.location.hash.slice(1) || '/';
      const [path, queryString] = hash.split('?');
      const params = Object.fromEntries(new URLSearchParams(queryString || ''));

      // Find matching route (exact or with param)
      let handler = null;
      let routeParams = {};

      for (const [pattern, fn] of Object.entries(this.routes)) {
        if (pattern === path) {
          handler = fn;
          break;
        }
        // Simple :param matching
        const patternParts = pattern.split('/');
        const pathParts = path.split('/');
        if (patternParts.length === pathParts.length) {
          let match = true;
          const extracted = {};
          for (let i = 0; i < patternParts.length; i++) {
            if (patternParts[i].startsWith(':')) {
              extracted[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
            } else if (patternParts[i] !== pathParts[i]) {
              match = false;
              break;
            }
          }
          if (match) {
            handler = fn;
            routeParams = extracted;
            break;
          }
        }
      }

      if (!handler) {
        handler = this.routes['*'] || this.routes['/'];
      }

      // Check if route change is allowed (by registered blockers, e.g., unsaved changes)
      const canChange = await State.canChangeRoute();
      if (!canChange) {
        // Route change blocked - revert hash to previous value
        const previousHash = this._previousHash || '#/';
        window.location.hash = previousHash;
        this._isResolving = false;
        return;
      }

      // Cleanup previous page
      if (this._currentCleanup && typeof this._currentCleanup === 'function') {
        this._currentCleanup();
      }

      // Render new page
      this.container.innerHTML = '';
      this._currentCleanup = handler(this.container, { ...params, ...routeParams });
      this._previousHash = hash;
    } finally {
      this._isResolving = false;
      
      // If another hash change happened while we were resolving, process it
      if (this._pendingHash && this._pendingHash !== window.location.hash) {
        const pending = this._pendingHash;
        this._pendingHash = null;
        window.location.hash = pending;
      }
    }
  }

  navigate(path) {
    window.location.hash = '#' + path;
  }
}
