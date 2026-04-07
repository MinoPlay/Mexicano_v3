/**
 * Simple hash-based SPA router.
 * Routes map hash paths to page render functions.
 */
export class Router {
  constructor(routes, container) {
    this.routes = routes;
    this.container = container;
    this._currentCleanup = null;

    window.addEventListener('hashchange', () => this.resolve());
    window.addEventListener('load', () => this.resolve());
  }

  resolve() {
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

    // Cleanup previous page
    if (this._currentCleanup && typeof this._currentCleanup === 'function') {
      this._currentCleanup();
    }

    // Render
    this.container.innerHTML = '';
    this._currentCleanup = handler(this.container, { ...params, ...routeParams });
  }

  navigate(path) {
    window.location.hash = '#' + path;
  }
}
