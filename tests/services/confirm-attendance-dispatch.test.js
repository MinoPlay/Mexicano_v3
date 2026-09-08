import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../js/store.js', () => ({
  Store: {
    getGitHubConfig: () => ({ owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'p' }),
  },
}));

vi.mock('../../js/cache.js', () => ({
  Cache: { get: vi.fn(), set: vi.fn() },
}));

import { dispatchConfirmAttendance } from '../../js/services/github.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('dispatchConfirmAttendance (repository_dispatch: confirm_attendance)', () => {
  it('POSTs a repository_dispatch with the date and player name', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    const result = await dispatchConfirmAttendance('2026-09-10', 'Mino');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/MinoPlay/DataHub_Mexicano/dispatches');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.event_type).toBe('confirm_attendance');
    expect(body.client_payload).toEqual({ date: '2026-09-10', name: 'Mino' });
  });

  it('rejects with the GitHub error message when dispatch fails', async () => {
    global.fetch = vi.fn(async () => ({
      status: 403,
      json: async () => ({ message: 'Resource not accessible by personal access token' }),
    }));

    await expect(dispatchConfirmAttendance('2026-09-10', 'Mino')).rejects.toThrow(/Resource not accessible/);
  });

  it('rejects when the GitHub backend is not configured', async () => {
    const { Store } = await import('../../js/store.js');
    const original = Store.getGitHubConfig;
    Store.getGitHubConfig = () => null;
    try {
      await expect(dispatchConfirmAttendance('2026-09-10', 'Mino')).rejects.toThrow(/not configured/);
    } finally {
      Store.getGitHubConfig = original;
    }
  });
});
