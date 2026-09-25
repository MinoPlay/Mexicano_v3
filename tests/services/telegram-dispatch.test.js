import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueueNotification: vi.fn().mockResolvedValue({ id: 'outbox-1' }),
}));

vi.mock('../../js/store.js', () => ({
  Store: { getCurrentUser: () => 'Tester' },
}));
vi.mock('../../js/services/backend.js', () => ({
  enqueueNotification: mocks.enqueueNotification,
}));

import {
  sendDoodleAlert,
  sendTelegramTestAlert,
  sendTournamentCompletedAlert,
  sendTournamentConfirmationAlert,
  sendTournamentCreatedAlert,
  sendTournamentTestAlert,
} from '../../js/services/telegram.js';

beforeEach(() => {
  mocks.enqueueNotification.mockReset();
  mocks.enqueueNotification.mockResolvedValue({ id: 'outbox-1' });
});

function payload() {
  return mocks.enqueueNotification.mock.calls[0][2];
}

describe('Telegram Supabase outbox', () => {
  it('enqueues a test alert with an idempotency key', async () => {
    await sendTelegramTestAlert();
    expect(mocks.enqueueNotification).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueNotification.mock.calls[0][0]).toBe('telegram');
    expect(mocks.enqueueNotification.mock.calls[0][1]).toBe('telegram_alert');
    expect(payload().text).toContain('Mexicano test alert');
    expect(payload().text).toContain('Tester');
    expect(mocks.enqueueNotification.mock.calls[0][3]).toMatch(/^telegram:test:/);
  });

  it('surfaces an outbox insertion failure', async () => {
    mocks.enqueueNotification.mockRejectedValueOnce(new Error('outbox unavailable'));
    await expect(sendTelegramTestAlert()).rejects.toThrow('outbox unavailable');
  });

  it('enqueues doodle text built from added and removed dates', async () => {
    await sendDoodleAlert('Alice', '2026-07', ['2026-07-01'], []);
    expect(payload().text).toContain('Doodle update — Alice (2026-07)');
    expect(payload().text).toContain('✅ Added: 2026-07-01');
  });

  it('skips empty doodle changes', async () => {
    await sendDoodleAlert('Alice', '2026-07', [], []);
    expect(mocks.enqueueNotification).not.toHaveBeenCalled();
  });

  it('enqueues confirmation text', async () => {
    await sendTournamentConfirmationAlert('Alice', '2024-06-22');
    expect(payload().text).toBe('🎾 Alice confirmed attendance for tournament on 2024-06-22');
  });

  it('routes tournament created alerts to the tournament group', async () => {
    await sendTournamentCreatedAlert({
      tournamentDate: '2026-07-15',
      accessCode: 'PADEL',
      rounds: [{ roundNumber: 1, matches: [
        { player1: { name: 'Alice' }, player2: { name: 'Bob' }, player3: { name: 'Carol' }, player4: { name: 'Dave' } },
      ] }],
    });
    expect(payload().target).toBe('tournaments');
    expect(payload().text).toContain('🔑 Code: PADEL');
  });

  it('routes tournament completed alerts to the tournament group', async () => {
    await sendTournamentCompletedAlert({ tournamentDate: '2026-07-15', players: [] });
    expect(payload().target).toBe('tournaments');
  });

  it('uses the default group for doodle alerts', async () => {
    await sendDoodleAlert('Alice', '2026-07', ['2026-07-01'], []);
    expect(payload().target).toBeUndefined();
  });

  it('routes the tournament test alert to the tournament group', async () => {
    await sendTournamentTestAlert();
    expect(payload().target).toBe('tournaments');
    expect(payload().kind).toBe('tournament-test');
  });
});
