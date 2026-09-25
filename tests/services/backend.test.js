import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cache } from '../../js/cache.js';
import { Store } from '../../js/store.js';

describe('backend selection', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const key of Cache.keys()) Cache.del(key);
    vi.restoreAllMocks();
  });

  it('does not import the legacy GitHub service', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    const source = await readFile(resolve('js/services/backend.js'), 'utf8');
    expect(source).not.toContain("from './github.js'");
  });

  it('uses Supabase whenever public project configuration exists', async () => {
    const specifier = '../../js/services/' + 'backend.js';
    const backend = await import(specifier).catch(() => null);
    expect(backend).not.toBeNull();

    expect(backend.getBackendKind()).toBe('unconfigured');
    Store.setSupabaseConfig({ url: 'https://example.supabase.co', anonKey: 'anon' });
    expect(backend.getBackendKind()).toBe('supabase');
  });

  it('does not force a full Supabase reload when the snapshot is already cached', async () => {
    Cache.set('supabase_snapshot_loaded', true);
    const backend = await import('../../js/services/backend.js');
    const supabase = await import('../../js/services/supabase.js');
    const pullSpy = vi.spyOn(supabase, 'pullForRoute').mockResolvedValue(true);

    await backend.pullMonthlyOverview('2026-09');

    expect(pullSpy).not.toHaveBeenCalledWith('', { force: true });
    expect(pullSpy).not.toHaveBeenCalled();
  });

  it('keeps explicit full-history helpers separate from the Home route', async () => {
    const backend = await import('../../js/services/backend.js');
    const supabase = await import('../../js/services/supabase.js');
    const pullSpy = vi.spyOn(supabase, 'pullForRoute').mockResolvedValue(true);

    await backend.ensureAllMatchesLoaded();

    expect(pullSpy).toHaveBeenCalledWith('#/__full__', { force: true });
  });

  it('does not start full hydration for a Home monthly refresh', async () => {
    Cache.del('supabase_snapshot_loaded');
    const backend = await import('../../js/services/backend.js');
    const supabase = await import('../../js/services/supabase.js');
    const pullSpy = vi.spyOn(supabase, 'pullForRoute').mockResolvedValue(true);

    await backend.pullMonthlyOverview('2099-12', { route: '#/' });

    expect(pullSpy).toHaveBeenCalledWith('#/', { force: false });
    expect(pullSpy).not.toHaveBeenCalledWith('#/__full__', { force: false });
  });
});
