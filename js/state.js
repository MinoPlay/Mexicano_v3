/**
 * Simple pub/sub state management.
 * Components subscribe to events and get notified on changes.
 */
export const State = {
  _listeners: {},
  _routeBlockers: [], // Functions that can block route changes

  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return () => {
      this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    };
  },

  emit(event, data) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(cb => cb(data));
    }
  },

  off(event, callback) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    }
  },

  /**
   * Register a function that can block route changes.
   * The blocker should return a Promise<boolean>: true to allow route change, false to block it.
   */
  addRouteBlocker(fn) {
    this._routeBlockers.push(fn);
    return () => {
      this._routeBlockers = this._routeBlockers.filter(f => f !== fn);
    };
  },

  /**
   * Check if any blockers want to prevent route change.
   * Returns Promise<boolean>: true if route change is allowed, false if blocked.
   */
  async canChangeRoute() {
    for (const blocker of this._routeBlockers) {
      try {
        const allowed = await blocker();
        if (!allowed) return false;
      } catch (e) {
        console.error('Route blocker error:', e);
      }
    }
    return true;
  }
};
