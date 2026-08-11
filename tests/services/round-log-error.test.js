/**
 * round-log error reporting — logError captures failures so they surface
 * in the Logs tab (needed to diagnose mobile-only finish failures).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

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

import { Store } from '../../js/store.js';
import { logError, getRoundLog, clearRoundLog } from '../../js/services/round-log.js';
import ADMINISTRATORS from '../../data/administrators.json';

beforeEach(() => {
  localStorageStub.clear();
  Store.setAdministrators([]);
  Store.setCurrentUser('');
});

describe('logError', () => {
  beforeEach(() => {
    Store.setAdministrators(ADMINISTRATORS);
    Store.setCurrentUser('Mino');
    clearRoundLog();
  });

  it('records an error entry for admins regardless of logs toggle', () => {
    Store.setLogsEnabled(false);
    logError('complete-tournament', new Error('push failed'));

    const log = getRoundLog();
    expect(log.length).toBe(1);
    expect(log[0].type).toBe('error');
    expect(log[0].context).toBe('complete-tournament');
    expect(log[0].message).toContain('push failed');
    expect(typeof log[0].ts).toBe('string');
  });

  it('accepts a string message', () => {
    logError('telegram', 'relay dispatch failed: HTTP 422');
    expect(getRoundLog()[0].message).toContain('HTTP 422');
  });

  it('does not record for non-admins', () => {
    Store.setCurrentUser('');
    logError('complete-tournament', new Error('nope'));
    expect(getRoundLog().length).toBe(0);
  });

  it('prepends errors newest-first alongside round entries', () => {
    logError('a', new Error('first'));
    logError('b', new Error('second'));
    const log = getRoundLog();
    expect(log[0].context).toBe('b');
    expect(log[1].context).toBe('a');
  });
});
