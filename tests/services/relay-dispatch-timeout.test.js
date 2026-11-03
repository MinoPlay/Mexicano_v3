import { beforeEach, describe, expect, it, vi } from 'vitest';

const relayMocks = vi.hoisted(() => ({
  enqueueNotification: vi.fn(),
}));

vi.mock('../../js/services/backend.js', () => ({
  enqueueNotification: relayMocks.enqueueNotification,
}));

vi.mock('../../js/store.js', () => ({
  Store: {
    getCurrentUser: () => 'Mino',
    getPlayersSummary: () => [],
  },
}));

import { sendTournamentCompletedAlert } from '../../js/services/telegram.js';
import { sendPushNotification } from '../../js/services/push.js';

const TOURNAMENT = {
  tournamentDate: '2025-06-08',
  players: [{ name: 'Alice', totalPoints: 21, rank: 1 }],
};

beforeEach(() => {
  relayMocks.enqueueNotification.mockReset();
  relayMocks.enqueueNotification.mockResolvedValue(undefined);
});

describe('notification outbox failures', () => {
  it('surfaces a Telegram outbox failure', async () => {
    relayMocks.enqueueNotification.mockRejectedValueOnce(new Error('Outbox unavailable'));
    await expect(sendTournamentCompletedAlert(TOURNAMENT))
      .rejects.toThrow('Outbox unavailable');
  });

  it('surfaces a Web Push outbox failure', async () => {
    relayMocks.enqueueNotification.mockRejectedValueOnce(new Error('Outbox unavailable'));
    await expect(sendPushNotification('t', 'b'))
      .rejects.toThrow('Outbox unavailable');
  });

  it('does not call GitHub directly from the browser', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await sendTournamentCompletedAlert(TOURNAMENT);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(relayMocks.enqueueNotification).toHaveBeenCalledWith(
      'telegram',
      'telegram_alert',
      expect.objectContaining({ kind: 'tournament-completed' }),
      expect.any(String),
    );
  });
});
