/**
 * Device type setting — Android/iPhone toggle that adds top padding for
 * iPhone status bar/notch via a body class.
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

import { Store } from '../../js/store.js';

beforeEach(() => {
  localStorageStub.clear();
  document.body.classList.remove('device-iphone');
});

describe('Store device-type setting', () => {
  it('defaults to android when nothing stored', () => {
    expect(Store.getDeviceType()).toBe('android');
  });

  it('persists iphone selection', () => {
    Store.setDeviceType('iphone');
    expect(Store.getDeviceType()).toBe('iphone');
  });

  it('persists android selection', () => {
    Store.setDeviceType('iphone');
    Store.setDeviceType('android');
    expect(Store.getDeviceType()).toBe('android');
  });
});

describe('Store.applyDeviceType — body padding class', () => {
  it('adds device-iphone class when device type is iphone', () => {
    Store.setDeviceType('iphone');
    expect(document.body.classList.contains('device-iphone')).toBe(true);
  });

  it('removes device-iphone class when device type is android', () => {
    Store.setDeviceType('iphone');
    Store.setDeviceType('android');
    expect(document.body.classList.contains('device-iphone')).toBe(false);
  });

  it('applyDeviceType() with no stored value leaves body without device-iphone class', () => {
    Store.applyDeviceType();
    expect(document.body.classList.contains('device-iphone')).toBe(false);
  });
});
