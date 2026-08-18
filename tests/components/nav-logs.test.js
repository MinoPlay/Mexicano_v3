/**
 * Bottom nav — Logs tab visibility for administrators.
 * The 📝 Logs tab must appear for admins. Because admin list + current user
 * load async AFTER the nav first renders, the nav must re-render itself when
 * the current user / administrator list changes.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── In-memory localStorage stub ───
function makeLocalStorage() {
  let store = {};
  return {
    getItem: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}
const localStorageStub = makeLocalStorage();
vi.stubGlobal('localStorage', localStorageStub);

import { renderNav } from '../../js/components/nav.js';
import { Store } from '../../js/store.js';
import ADMINISTRATORS from '../../data/administrators.json';

beforeEach(() => {
  localStorageStub.clear();
  Store.setAdministrators([]);
  Store.setCurrentUser('');
  // Logs default to disabled; these tests cover the admin gate, so opt in.
  Store.setLogsEnabled(true);
});

const hasLogs = (nav) => !!nav.querySelector('.nav-item[data-path="/logs"]');

describe('Bottom nav — Logs tab visibility', () => {
  it('hides Logs when no admin/user loaded yet', () => {
    const nav = renderNav();
    expect(hasLogs(nav)).toBe(false);
  });

  it('shows Logs when admin user already set at render time', () => {
    Store.setAdministrators(ADMINISTRATORS);
    Store.setCurrentUser('Mino');
    const nav = renderNav();
    expect(hasLogs(nav)).toBe(true);
  });

  it('re-renders to show Logs when admin list + user load AFTER first render', () => {
    // Nav rendered first (mirrors app.js mounting before async load completes)
    const nav = renderNav();
    expect(hasLogs(nav)).toBe(false);

    // Admin data loads later
    Store.setAdministrators(ADMINISTRATORS);
    Store.setCurrentUser('Mino');

    expect(hasLogs(nav)).toBe(true);
  });

  it('hides Logs again when switching to a non-admin user', () => {
    Store.setAdministrators(ADMINISTRATORS);
    Store.setCurrentUser('Mino');
    const nav = renderNav();
    expect(hasLogs(nav)).toBe(true);

    Store.setCurrentUser('SomeGuest');
    expect(hasLogs(nav)).toBe(false);
  });

  it('hides Logs for an admin when the logs toggle is disabled', () => {
    Store.setAdministrators(ADMINISTRATORS);
    Store.setCurrentUser('Mino');
    const nav = renderNav();
    expect(hasLogs(nav)).toBe(true);

    Store.setLogsEnabled(false);
    expect(hasLogs(nav)).toBe(false);
  });
});
