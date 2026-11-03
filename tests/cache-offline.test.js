import { beforeEach, describe, expect, it } from 'vitest';
import { Cache, OFFLINE_SNAPSHOT_KEY } from '../js/cache.js';
import { Store } from '../js/store.js';

describe('offline Cache snapshot', () => {
  beforeEach(() => {
    localStorage.clear();
    Cache.clear();
  });

  it('persists loaded route data and restores it after a reload', () => {
    Cache.set('matches', [{ date: '2026-10-06' }]);
    Cache.set('supabase_route_home_loaded', true);
    expect(Cache.persistSnapshot()).toBe(true);

    Cache.clear();
    expect(Cache.hydrateSnapshot()).toBe(true);

    expect(Cache.get('matches')).toEqual([{ date: '2026-10-06' }]);
    expect(Cache.get('supabase_route_home_loaded')).toBe(true);
  });

  it('survives the startup purge of non-persisted keys', () => {
    Cache.set('matches', [{ date: '2026-10-06' }]);
    Cache.persistSnapshot();

    Store.purgeNonPersistedKeys();

    expect(localStorage.getItem(OFFLINE_SNAPSHOT_KEY)).not.toBeNull();
  });

  it('returns false when no snapshot exists or it is corrupt', () => {
    expect(Cache.hydrateSnapshot()).toBe(false);
    localStorage.setItem(OFFLINE_SNAPSHOT_KEY, '{oops');
    expect(Cache.hydrateSnapshot()).toBe(false);
  });

  it('does not throw when storage quota is exceeded', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
    try {
      Cache.set('matches', []);
      expect(Cache.persistSnapshot()).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it('clearSnapshot removes the stored snapshot', () => {
    Cache.set('matches', []);
    Cache.persistSnapshot();
    Cache.clearSnapshot();
    expect(localStorage.getItem(OFFLINE_SNAPSHOT_KEY)).toBeNull();
  });

  it('drops the snapshot when the Supabase session is cleared (sign-out / revoked access)', () => {
    Cache.set('matches', []);
    Cache.persistSnapshot();
    Store.clearSupabaseSession();
    expect(localStorage.getItem(OFFLINE_SNAPSHOT_KEY)).toBeNull();
  });
});

describe('reconnect after offline hydrate', () => {
  it('invalidateReadCache drops snapshot participation months so they are refetched', async () => {
    const { invalidateReadCache } = await import('../js/services/supabase.js');
    Cache.clear();
    Cache.set('participation_2026-09', { Ana: ['2026-09-01'] });
    Cache.set('supabase_res_participation_2026-09', true);
    invalidateReadCache();
    expect(Cache.has('participation_2026-09')).toBe(false);
  });
});
