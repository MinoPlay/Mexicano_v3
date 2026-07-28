import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../js/store.js', () => ({
  Store: {
    getGitHubConfig: () => ({ owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'p' }),
    getCurrentUser: () => 'Tester',
  },
}));

import {
  sendTelegramTestAlert,
  sendTournamentTestAlert,
  sendDoodleAlert,
  sendTournamentConfirmationAlert,
  sendTournamentCreatedAlert,
  sendTournamentCompletedAlert,
} from '../../js/services/telegram.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('telegram relay via GitHub repository_dispatch', () => {
  it('POSTs a repository_dispatch to the configured data repo with the message text', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendTelegramTestAlert();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/MinoPlay/DataHub_Mexicano/dispatches');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer p');
    const body = JSON.parse(opts.body);
    expect(body.event_type).toBe('telegram_alert');
    expect(body.client_payload.text).toContain('Mexicano test alert');
    expect(body.client_payload.text).toContain('Tester');
  });

  it('rejects with the GitHub error message when dispatch fails', async () => {
    global.fetch = vi.fn(async () => ({
      status: 403,
      json: async () => ({ message: 'Resource not accessible by personal access token' }),
    }));

    await expect(sendTelegramTestAlert()).rejects.toThrow(/Resource not accessible/);
  });

  it('dispatches doodle text built from added/removed dates', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendDoodleAlert('Alice', '2026-07', ['2026-07-01'], []);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.client_payload.text).toContain('Doodle update — Alice (2026-07)');
    expect(body.client_payload.text).toContain('✅ Added: 2026-07-01');
  });

  it('skips dispatch when a doodle change has no added/removed dates', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendDoodleAlert('Alice', '2026-07', [], []);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dispatches confirmation text', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendTournamentConfirmationAlert('Alice', '2024-06-22');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.client_payload.text).toBe('🎾 Alice confirmed attendance for tournament on 2024-06-22');
  });

  it('routes tournament created alerts to the tournament group chat', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendTournamentCreatedAlert({
      tournamentDate: '2026-07-15',
      accessCode: 'PADEL',
      rounds: [{ roundNumber: 1, matches: [
        { player1: { name: 'Alice' }, player2: { name: 'Bob' }, player3: { name: 'Carol' }, player4: { name: 'Dave' } },
      ] }],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.client_payload.target).toBe('tournaments');
    expect(body.client_payload.text).toContain('🔑 Code: PADEL');
  });

  it('routes tournament completed alerts to the tournament group chat', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendTournamentCompletedAlert({ tournamentDate: '2026-07-15', players: [] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.client_payload.target).toBe('tournaments');
  });

  it('does not set target for doodle alerts (uses default group)', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendDoodleAlert('Alice', '2026-07', ['2026-07-01'], []);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.client_payload.target).toBeUndefined();
  });

  it('routes the tournament test alert to the tournament group chat', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendTournamentTestAlert();

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.client_payload.target).toBe('tournaments');
    expect(body.client_payload.kind).toBe('tournament-test');
    expect(body.client_payload.text).toContain('test');
  });
});
