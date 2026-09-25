import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getDeployId, slugifyBranch, nsPrefix, getCacheName, isOwnCache, installStorageNamespace,
} from '../../js/deploy-env.js';
import { shouldHandleRequest } from '../../js/sw-fetch.js';

describe('getDeployId', () => {
  it('main paths → empty id', () => {
    expect(getDeployId('/Mexicano_v3/')).toBe('');
    expect(getDeployId('/Mexicano_v3/index.html')).toBe('');
    expect(getDeployId('/')).toBe('');
  });
  it('preview paths → slug', () => {
    expect(getDeployId('/Mexicano_v3/preview/feature-limits/')).toBe('feature-limits');
    expect(getDeployId('/Mexicano_v3/preview/feature-limits/sw.js')).toBe('feature-limits');
  });
});

describe('slugifyBranch', () => {
  it('lowercases and replaces unsafe chars', () => {
    expect(slugifyBranch('feature/limits')).toBe('feature-limits');
    expect(slugifyBranch('Supabase_POC')).toBe('supabase-poc');
  });
});

describe('nsPrefix / cache names', () => {
  it('nsPrefix', () => {
    expect(nsPrefix('')).toBe('');
    expect(nsPrefix('x')).toBe('preview-x:');
  });
  it('getCacheName', () => {
    expect(getCacheName(97, '')).toBe('mexicano-v97');
    expect(getCacheName(97, 'x')).toBe('mexicano-x-v97');
  });
  it('isOwnCache', () => {
    expect(isOwnCache('mexicano-v96', '')).toBe(true);
    expect(isOwnCache('mexicano-x-v96', '')).toBe(false);
    expect(isOwnCache('mexicano-x-v96', 'x')).toBe(true);
    expect(isOwnCache('mexicano-v96', 'x')).toBe(false);
    expect(isOwnCache('mexicano-xy-v1', 'x')).toBe(false);
  });
});

// Minimal Storage look-alike: methods + length getter on the prototype (like DOM Storage).
class FakeStorage {
  constructor() { this._m = new Map(); }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  setItem(k, v) { this._m.set(k, String(v)); }
  removeItem(k) { this._m.delete(k); }
  key(i) { return [...this._m.keys()][i] ?? null; }
  clear() { this._m.clear(); }
  get length() { return this._m.size; }
}

describe('installStorageNamespace', () => {
  let uninstall = null;
  let localStorage;
  let sessionStorage;
  beforeEach(() => { localStorage = new FakeStorage(); sessionStorage = new FakeStorage(); });
  afterEach(() => { uninstall?.(); uninstall = null; });

  it('no-op for main (empty id)', () => {
    uninstall = installStorageNamespace(FakeStorage.prototype, '');
    localStorage.setItem('a', '1');
    uninstall(); uninstall = null;
    expect(localStorage.getItem('a')).toBe('1');
  });

  it('prefixes keys and hides other namespaces', () => {
    localStorage.setItem('mexicano_theme', 'dark');
    uninstall = installStorageNamespace(FakeStorage.prototype, 'x');
    localStorage.setItem('a', '1');
    expect(localStorage.getItem('a')).toBe('1');
    expect(localStorage.getItem('mexicano_theme')).toBe(null);
    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toBe('a');
    expect(localStorage.key(1)).toBe(null);
    localStorage.clear();
    expect(localStorage.length).toBe(0);
    uninstall(); uninstall = null;
    expect(localStorage.getItem('mexicano_theme')).toBe('dark');
    expect(localStorage.getItem('preview-x:a')).toBe(null);
  });

  it('stores under raw prefixed key and removeItem works', () => {
    uninstall = installStorageNamespace(FakeStorage.prototype, 'x');
    sessionStorage.setItem('s', '2');
    localStorage.setItem('b', '3');
    localStorage.removeItem('b');
    uninstall(); uninstall = null;
    expect(sessionStorage.getItem('preview-x:s')).toBe('2');
    expect(localStorage.getItem('preview-x:b')).toBe(null);
  });
});

describe('shouldHandleRequest scope isolation', () => {
  const req = (url) => ({ method: 'GET', url });
  it('main SW skips preview requests', () => {
    expect(shouldHandleRequest(req('https://o/Mexicano_v3/preview/x/app.js'), 'https://o', '/Mexicano_v3/')).toBe(false);
  });
  it('preview SW handles own requests', () => {
    expect(shouldHandleRequest(req('https://o/Mexicano_v3/preview/x/app.js'), 'https://o', '/Mexicano_v3/preview/x/')).toBe(true);
  });
  it('main SW handles main requests', () => {
    expect(shouldHandleRequest(req('https://o/Mexicano_v3/js/app.js'), 'https://o', '/Mexicano_v3/')).toBe(true);
  });
});

describe('refreshApp only clears own-deploy caches', () => {
  it('main (jsdom path /) keeps preview caches', async () => {
    const { refreshApp } = await import('../../js/version.js');
    const deleted = [];
    globalThis.caches = {
      keys: async () => ['mexicano-v96', 'mexicano-x-v96', 'other'],
      delete: async (k) => { deleted.push(k); return true; },
    };
    const reload = vi.fn();
    const origLocation = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...origLocation, pathname: '/', reload } });
    try {
      await refreshApp();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: origLocation });
      delete globalThis.caches;
    }
    expect(deleted).toEqual(['mexicano-v96']);
    expect(reload).toHaveBeenCalled();
  });
});
