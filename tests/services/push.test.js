import { describe, it, expect, vi, beforeEach } from 'vitest';

const relayMocks = vi.hoisted(() => ({
  enqueueNotification: vi.fn(),
  savePushSubscription: vi.fn(),
}));

vi.mock('../../js/services/backend.js', () => ({
  enqueueNotification: relayMocks.enqueueNotification,
}));

vi.mock('../../js/services/supabase.js', () => ({
  savePushSubscription: relayMocks.savePushSubscription,
}));

vi.mock('../../js/store.js', () => ({
  Store: {
    getCurrentUser: () => 'Tester',
    getCurrentPlayerId: () => 'player-1',
    getPlayersSummary: vi.fn(() => []),
  },
}));

import {
  urlBase64ToUint8Array,
  isPushSupported,
  isPushEnabled,
  buildSubscribePayload,
  buildPushAlertPayload,
  buildTournamentCreatedPush,
  buildTournamentCompletedPush,
  dispatchSubscription,
  sendPushNotification,
  sendTournamentCreatedPush,
  sendTournamentCompletedPush,
  resyncPushSubscription,
  subscribeToPush,
  buildPushMessagesPayload,
  buildPlayerResultPush,
  buildTournamentCompletedMessages,
  computeTournamentEloChanges,
} from '../../js/services/push.js';
import { Store } from '../../js/store.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  relayMocks.enqueueNotification.mockReset();
  relayMocks.enqueueNotification.mockResolvedValue(undefined);
  relayMocks.savePushSubscription.mockReset();
  relayMocks.savePushSubscription.mockResolvedValue(undefined);
  Store.getPlayersSummary.mockReturnValue([]);
});

function lastPushPayload() {
  return relayMocks.enqueueNotification.mock.calls.at(-1)?.[2];
}

describe('urlBase64ToUint8Array', () => {
  it('decodes a padded-length base64url string', () => {
    const out = urlBase64ToUint8Array('AAAA');
    expect(out).toBeInstanceOf(Uint8Array);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it('pads a non-multiple-of-4 base64url string', () => {
    expect(Array.from(urlBase64ToUint8Array('AAA'))).toEqual([0, 0]);
  });

  it('maps url-safe chars (- _) back to (+ /)', () => {
    expect(Array.from(urlBase64ToUint8Array('_-'))).toEqual([255]);
  });
});

describe('isPushSupported', () => {
  it('is false when Notification API is missing', () => {
    const orig = global.Notification;
    delete global.Notification;
    expect(isPushSupported()).toBe(false);
    if (orig !== undefined) global.Notification = orig;
  });
});

describe('isPushEnabled', () => {
  it('is true when notification permission is granted', () => {
    const orig = global.Notification;
    global.Notification = { permission: 'granted' };
    expect(isPushEnabled()).toBe(true);
    global.Notification = orig;
  });

  it('is false when permission is default or denied', () => {
    const orig = global.Notification;
    global.Notification = { permission: 'default' };
    expect(isPushEnabled()).toBe(false);
    global.Notification = { permission: 'denied' };
    expect(isPushEnabled()).toBe(false);
    global.Notification = orig;
  });

  it('is false when the Notification API is missing', () => {
    const orig = global.Notification;
    delete global.Notification;
    expect(isPushEnabled()).toBe(false);
    if (orig !== undefined) global.Notification = orig;
  });
});

describe('buildSubscribePayload', () => {
  it('wraps a subscription and user for the subscribe dispatch', () => {
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } };
    expect(buildSubscribePayload(sub, 'Alice')).toEqual({
      event_type: 'web_push_subscribe',
      client_payload: { subscription: sub, user: 'Alice' },
    });
  });
});

describe('buildPushAlertPayload', () => {
  it('builds a web_push dispatch payload', () => {
    expect(buildPushAlertPayload('Title', 'Body', './#/tournament/2026-07-15')).toEqual({
      event_type: 'web_push',
      client_payload: { title: 'Title', body: 'Body', url: './#/tournament/2026-07-15' },
    });
  });

  it('defaults url to ./ when omitted', () => {
    expect(buildPushAlertPayload('T', 'B').client_payload.url).toBe('./');
  });

  it('includes a users array when recipients are provided', () => {
    expect(buildPushAlertPayload('T', 'B', './', ['Alice', 'Bob'])).toEqual({
      event_type: 'web_push',
      client_payload: { title: 'T', body: 'B', url: './', users: ['Alice', 'Bob'] },
    });
  });

  it('omits users when the recipient list is empty or missing', () => {
    expect(buildPushAlertPayload('T', 'B', './', []).client_payload).not.toHaveProperty('users');
    expect(buildPushAlertPayload('T', 'B', './').client_payload).not.toHaveProperty('users');
  });
});

describe('dispatchSubscription', () => {
  it('stores the subscription in Supabase for the selected player', async () => {
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } };
    await dispatchSubscription(sub);

    expect(relayMocks.savePushSubscription).toHaveBeenCalledWith(sub, 'player-1');
  });

  it('surfaces Supabase subscription failures', async () => {
    relayMocks.savePushSubscription.mockRejectedValueOnce(new Error('Subscription rejected'));
    await expect(dispatchSubscription({ endpoint: 'x' })).rejects.toThrow('Subscription rejected');
  });
});

describe('sendPushNotification', () => {
  it('enqueues a web_push outbox item with title/body/url', async () => {
    await sendPushNotification('New tournament', '2026-07-15', './#/tournament/2026-07-15');

    expect(relayMocks.enqueueNotification).toHaveBeenCalledWith(
      'push',
      'web_push',
      {
      title: 'New tournament',
      body: '2026-07-15',
      url: './#/tournament/2026-07-15',
      },
      expect.any(String),
    );
  });

  it('forwards a users recipient list into the outbox payload', async () => {
    await sendPushNotification('T', 'B', './', ['Alice', 'Bob']);

    expect(lastPushPayload().users).toEqual(['Alice', 'Bob']);
  });
});

describe('buildTournamentCreatedPush', () => {
  it('builds title/body/url deep-linking to the tournament', () => {
    expect(buildTournamentCreatedPush('2026-07-15')).toEqual({
      title: '🎾 New tournament',
      body: 'Tournament on 2026-07-15',
      url: './#/tournament/2026-07-15',
    });
  });
});

describe('buildTournamentCompletedPush', () => {
  it('names the winner (rank 1) in the body', () => {
    const ranked = [
      { rank: 1, name: 'Alice', totalPoints: 24 },
      { rank: 2, name: 'Bob', totalPoints: 18 },
    ];
    expect(buildTournamentCompletedPush('2026-07-15', ranked)).toEqual({
      title: '🏆 Tournament complete',
      body: '2026-07-15 — Winner: Alice',
      url: './#/tournament/2026-07-15',
    });
  });

  it('omits the winner when there are no ranked players', () => {
    expect(buildTournamentCompletedPush('2026-07-15', [])).toEqual({
      title: '🏆 Tournament complete',
      body: 'Tournament on 2026-07-15',
      url: './#/tournament/2026-07-15',
    });
  });
});

describe('sendTournamentCreatedPush', () => {
  it('enqueues a web_push for the created tournament', async () => {
    await sendTournamentCreatedPush({ tournamentDate: '2026-07-15' });

    expect(lastPushPayload()).toEqual({
      title: '🎾 New tournament',
      body: 'Tournament on 2026-07-15',
      url: './#/tournament/2026-07-15',
    });
  });

  it('targets only the tournament players when they are present', async () => {
    await sendTournamentCreatedPush({
      tournamentDate: '2026-07-15',
      players: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    });

    expect(lastPushPayload().users).toEqual(['Alice', 'Bob']);
  });
});

describe('buildPushMessagesPayload', () => {
  it('wraps per-recipient messages in a web_push dispatch', () => {
    const messages = [{ users: ['Alice'], title: 'T', body: 'B', url: './x' }];
    expect(buildPushMessagesPayload(messages)).toEqual({
      event_type: 'web_push',
      client_payload: { messages },
    });
  });
});

describe('buildPlayerResultPush', () => {
  it('builds a personal result message with rank, points, average, ELO and ELO change', () => {
    expect(buildPlayerResultPush('2026-07-15', {
      rank: 1,
      name: 'Alice',
      totalPoints: 24,
      gamesPlayed: 4,
      elo: 1016,
      eloChange: 16,
    }, 4)).toEqual({
      users: ['Alice'],
      title: '🏆 Tournament complete — 2026-07-15',
      body: 'Rank 1/4 · 24 pts · 6.0 avg\nELO 1016 (+16)',
      url: './#/tournament/2026-07-15',
    });
  });

  it('renders a negative ELO change with its sign', () => {
    expect(buildPlayerResultPush('2026-07-15', {
      rank: 4,
      name: 'Dave',
      totalPoints: 9,
      gamesPlayed: 4,
      elo: 984,
      eloChange: -16,
    }, 4).body).toBe('Rank 4/4 · 9 pts · 2.3 avg\nELO 984 (-16)');
  });

  it('omits the ELO line when no ELO is known', () => {
    expect(buildPlayerResultPush('2026-07-15', {
      rank: 2,
      name: 'Bob',
      totalPoints: 18,
      gamesPlayed: 0,
    }, 2).body).toBe('Rank 2/2 · 18 pts · 0.0 avg');
  });
});

describe('computeTournamentEloChanges', () => {
  it('returns per-player ELO after the tournament and the change it caused', () => {
    const matches = [{
      date: '2026-07-15',
      roundNumber: 1,
      team1Player1Name: 'Alice',
      team1Player2Name: 'Bob',
      team2Player1Name: 'Carl',
      team2Player2Name: 'Dave',
      scoreTeam1: 6,
      scoreTeam2: 2,
    }];
    expect(computeTournamentEloChanges(matches, '2026-07-15')).toEqual({
      Alice: { elo: 1016, eloChange: 16 },
      Bob: { elo: 1016, eloChange: 16 },
      Carl: { elo: 985, eloChange: -15 },
      Dave: { elo: 985, eloChange: -15 },
    });
  });

  it('returns an empty map when there are no matches', () => {
    expect(computeTournamentEloChanges([], '2026-07-15')).toEqual({});
  });
});

describe('buildTournamentCompletedMessages', () => {
  it('builds one targeted message per participant', () => {
    const ranked = [
      { rank: 1, name: 'Alice', totalPoints: 24, gamesPlayed: 4 },
      { rank: 2, name: 'Bob', totalPoints: 18, gamesPlayed: 4 },
    ];
    const elo = { Alice: { elo: 1016, eloChange: 16 }, Bob: { elo: 984, eloChange: -16 } };
    expect(buildTournamentCompletedMessages('2026-07-15', ranked, elo)).toEqual([
      {
        users: ['Alice'],
        title: '🏆 Tournament complete — 2026-07-15',
        body: 'Rank 1/2 · 24 pts · 6.0 avg\nELO 1016 (+16)',
        url: './#/tournament/2026-07-15',
      },
      {
        users: ['Bob'],
        title: '🏆 Tournament complete — 2026-07-15',
        body: 'Rank 2/2 · 18 pts · 4.5 avg\nELO 984 (-16)',
        url: './#/tournament/2026-07-15',
      },
    ]);
  });

  it('returns an empty list when there are no players', () => {
    expect(buildTournamentCompletedMessages('2026-07-15', [], {})).toEqual([]);
  });
});

describe('sendTournamentCompletedPush', () => {
  it('enqueues one personalised message per participant only', async () => {
    const matches = [{
      date: '2026-07-15',
      roundNumber: 1,
      team1Player1Name: 'Alice',
      team1Player2Name: 'Bob',
      team2Player1Name: 'Carl',
      team2Player2Name: 'Dave',
      scoreTeam1: 6,
      scoreTeam2: 2,
    }];

    await sendTournamentCompletedPush({
      tournamentDate: '2026-07-15',
      players: [
        { name: 'Bob', totalPoints: 18, wins: 2, gamesPlayed: 4 },
        { name: 'Alice', totalPoints: 24, wins: 3, gamesPlayed: 4 },
      ],
    }, matches);

    expect(lastPushPayload()).toEqual({
      messages: [
        {
          users: ['Alice'],
          title: '🏆 Tournament complete — 2026-07-15',
          body: 'Rank 1/2 · 24 pts · 6.0 avg\nELO 1016 (+16)',
          url: './#/tournament/2026-07-15',
        },
        {
          users: ['Bob'],
          title: '🏆 Tournament complete — 2026-07-15',
          body: 'Rank 2/2 · 18 pts · 4.5 avg\nELO 1016 (+16)',
          url: './#/tournament/2026-07-15',
        },
      ],
    });
  });

  it('uses the authoritative players_summary ELO instead of a from-scratch replay', async () => {
    // Players already have real ELO history (e.g. from a prior tournament) that a
    // from-scratch replay of just today's matches would not know about.
    Store.getPlayersSummary.mockReturnValue([
      { name: 'Alice', elo: 1050, previousElo: 1030 },
      { name: 'Bob', elo: 980, previousElo: 1000 },
    ]);

    const matches = [{
      date: '2026-07-15',
      roundNumber: 1,
      team1Player1Name: 'Alice',
      team1Player2Name: 'Bob',
      team2Player1Name: 'Carl',
      team2Player2Name: 'Dave',
      scoreTeam1: 6,
      scoreTeam2: 2,
    }];

    await sendTournamentCompletedPush({
      tournamentDate: '2026-07-15',
      players: [
        { name: 'Alice', totalPoints: 24, wins: 3, gamesPlayed: 4 },
        { name: 'Bob', totalPoints: 18, wins: 2, gamesPlayed: 4 },
      ],
    }, matches);

    const aliceMsg = lastPushPayload().messages.find(m => m.users[0] === 'Alice');
    const bobMsg = lastPushPayload().messages.find(m => m.users[0] === 'Bob');
    expect(aliceMsg.body).toBe('Rank 1/2 · 24 pts · 6.0 avg\nELO 1050 (+20)');
    expect(bobMsg.body).toBe('Rank 2/2 · 18 pts · 4.5 avg\nELO 980 (-20)');
  });

  it('falls back to a broadcast summary when the tournament has no players', async () => {
    await sendTournamentCompletedPush({ tournamentDate: '2026-07-15', players: [] }, []);

    expect(lastPushPayload()).toEqual({
      title: '🏆 Tournament complete',
      body: 'Tournament on 2026-07-15',
      url: './#/tournament/2026-07-15',
    });
  });
});

describe('resyncPushSubscription', () => {
  function stubPushEnv({ permission = 'granted', subscription } = {}) {
    const getSubscription = vi.fn(async () =>
      subscription ? { toJSON: () => subscription } : null,
    );
    vi.stubGlobal('Notification', { permission });
    vi.stubGlobal('PushManager', function PushManager() {});
    vi.stubGlobal('navigator', {
      serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription } }) },
    });
    return { getSubscription };
  }

  it('silently re-dispatches the existing subscription tagged with the current user', async () => {
    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } };
    stubPushEnv({ subscription: sub });
    const result = await resyncPushSubscription();

    expect(result).toBe(true);
    expect(relayMocks.savePushSubscription).toHaveBeenCalledWith(sub, 'player-1');
  });

  it('does nothing when notification permission is not granted', async () => {
    stubPushEnv({ permission: 'default', subscription: { endpoint: 'x' } });
    expect(await resyncPushSubscription()).toBe(false);
    expect(relayMocks.savePushSubscription).not.toHaveBeenCalled();
  });

  it('does nothing when there is no existing subscription on this device', async () => {
    stubPushEnv({ subscription: undefined });
    expect(await resyncPushSubscription()).toBe(false);
    expect(relayMocks.savePushSubscription).not.toHaveBeenCalled();
  });
});

describe('subscribeToPush', () => {
  // Regression: browsers hand back the SAME (possibly dead) subscription from
  // pushManager.subscribe() when one already exists client-side, even if the
  // push service has invalidated it server-side (410 Gone). Re-clicking
  // "Enable push notifications" must first unsubscribe any existing
  // subscription so the browser is forced to negotiate a brand-new endpoint.
  it('unsubscribes any existing subscription before subscribing again', async () => {
    const requestPermission = vi.fn(async () => 'granted');
    vi.stubGlobal('Notification', { requestPermission });
    vi.stubGlobal('PushManager', function PushManager() {});

    const staleUnsubscribe = vi.fn(async () => true);
    const staleSub = { endpoint: 'https://push.example/stale', unsubscribe: staleUnsubscribe };
    const getSubscription = vi.fn(async () => staleSub);

    const freshSub = {
      endpoint: 'https://push.example/fresh',
      toJSON: () => ({ endpoint: 'https://push.example/fresh', keys: { p256dh: 'k', auth: 'a' } }),
    };
    const subscribe = vi.fn(async () => freshSub);

    vi.stubGlobal('navigator', {
      serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) },
    });

    const result = await subscribeToPush();

    expect(getSubscription).toHaveBeenCalledTimes(1);
    expect(staleUnsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    // unsubscribe must happen before the new subscribe() call.
    expect(staleUnsubscribe.mock.invocationCallOrder[0])
      .toBeLessThan(subscribe.mock.invocationCallOrder[0]);
    expect(result).toBe(freshSub);

    expect(relayMocks.savePushSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example/fresh' }),
      'player-1',
    );
  });

  it('subscribes directly when there is no existing subscription', async () => {
    const requestPermission = vi.fn(async () => 'granted');
    vi.stubGlobal('Notification', { requestPermission });
    vi.stubGlobal('PushManager', function PushManager() {});

    const getSubscription = vi.fn(async () => null);
    const freshSub = {
      endpoint: 'https://push.example/fresh',
      toJSON: () => ({ endpoint: 'https://push.example/fresh', keys: { p256dh: 'k', auth: 'a' } }),
    };
    const subscribe = vi.fn(async () => freshSub);

    vi.stubGlobal('navigator', {
      serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription, subscribe } }) },
    });

    await subscribeToPush();

    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
