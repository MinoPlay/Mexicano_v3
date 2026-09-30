import { beforeEach, describe, expect, it, vi } from 'vitest';
import { perfStart, getPerfEntries, clearPerfEntries, isPerfEnabled } from '../../js/services/perf.js';

describe('perf instrumentation', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPerfEntries();
    vi.restoreAllMocks();
  });

  it('is a no-op unless enabled', () => {
    expect(isPerfEnabled()).toBe(false);
    const end = perfStart('fetch:players');
    end({ rows: 3 });
    expect(getPerfEntries()).toEqual([]);
  });

  it('records label, duration and details when enabled via localStorage', () => {
    localStorage.setItem('perf-log', '1');
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const end = perfStart('fetch:players');
    end({ rows: 3 });

    const [entry] = getPerfEntries();
    expect(entry).toMatchObject({ label: 'fetch:players', rows: 3 });
    expect(typeof entry.ms).toBe('number');
    expect(entry.ms).toBeGreaterThanOrEqual(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[perf] fetch:players'), expect.anything());
  });
});
