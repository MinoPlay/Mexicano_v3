import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../js/store.js', () => ({
  Store: {
    getGitHubConfig: () => ({ owner: 'MinoPlay', repo: 'DataHub_Mexicano', pat: 'p' }),
    getCurrentUser: () => 'Tester',
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
  buildPushMessagesPayload,
  buildPlayerResultPush,
  buildTournamentCompletedMessages,
  computeTournamentEloChanges,
} from '../../js/services/push.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    expect(buildPushAlertPayload('Title', 'Body', './tournament/2026-07-15')).toEqual({
      event_type: 'web_push',
      client_payload: { title: 'Title', body: 'Body', url: './tournament/2026-07-15' },
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
  it('POSTs a web_push_subscribe repository_dispatch to the data repo', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } };
    await dispatchSubscription(sub);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/MinoPlay/DataHub_Mexicano/dispatches');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('token p');
    const body = JSON.parse(opts.body);
    expect(body.event_type).toBe('web_push_subscribe');
    expect(body.client_payload.subscription).toEqual(sub);
    expect(body.client_payload.user).toBe('Tester');
  });

  it('rejects with the GitHub error message on failure', async () => {
    global.fetch = vi.fn(async () => ({
      status: 403,
      json: async () => ({ message: 'Resource not accessible by personal access token' }),
    }));
    await expect(dispatchSubscription({ endpoint: 'x' })).rejects.toThrow(/Resource not accessible/);
  });
});

describe('sendPushNotification', () => {
  it('POSTs a web_push repository_dispatch with title/body/url', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendPushNotification('New tournament', '2026-07-15', './tournament/2026-07-15');

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/MinoPlay/DataHub_Mexicano/dispatches');
    const body = JSON.parse(opts.body);
    expect(body.event_type).toBe('web_push');
    expect(body.client_payload).toEqual({
      title: 'New tournament',
      body: '2026-07-15',
      url: './tournament/2026-07-15',
    });
  });

  it('forwards a users recipient list into the dispatch', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendPushNotification('T', 'B', './', ['Alice', 'Bob']);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.client_payload.users).toEqual(['Alice', 'Bob']);
  });
});

describe('buildTournamentCreatedPush', () => {
  it('builds title/body/url deep-linking to the tournament', () => {
    expect(buildTournamentCreatedPush('2026-07-15')).toEqual({
      title: '🎾 New tournament',
      body: 'Tournament on 2026-07-15',
      url: './tournament/2026-07-15',
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
      url: './tournament/2026-07-15',
    });
  });

  it('omits the winner when there are no ranked players', () => {
    expect(buildTournamentCompletedPush('2026-07-15', [])).toEqual({
      title: '🏆 Tournament complete',
      body: 'Tournament on 2026-07-15',
      url: './tournament/2026-07-15',
    });
  });
});

describe('sendTournamentCreatedPush', () => {
  it('dispatches a web_push for the created tournament', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendTournamentCreatedPush({ tournamentDate: '2026-07-15' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.event_type).toBe('web_push');
    expect(body.client_payload).toEqual({
      title: '🎾 New tournament',
      body: 'Tournament on 2026-07-15',
      url: './tournament/2026-07-15',
    });
  });

  it('targets only the tournament players when they are present', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendTournamentCreatedPush({
      tournamentDate: '2026-07-15',
      players: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.client_payload.users).toEqual(['Alice', 'Bob']);
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
      url: './tournament/2026-07-15',
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
        url: './tournament/2026-07-15',
      },
      {
        users: ['Bob'],
        title: '🏆 Tournament complete — 2026-07-15',
        body: 'Rank 2/2 · 18 pts · 4.5 avg\nELO 984 (-16)',
        url: './tournament/2026-07-15',
      },
    ]);
  });

  it('returns an empty list when there are no players', () => {
    expect(buildTournamentCompletedMessages('2026-07-15', [], {})).toEqual([]);
  });
});

describe('sendTournamentCompletedPush', () => {
  it('dispatches one personalised message per participant only', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

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

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.event_type).toBe('web_push');
    expect(body.client_payload).toEqual({
      messages: [
        {
          users: ['Alice'],
          title: '🏆 Tournament complete — 2026-07-15',
          body: 'Rank 1/2 · 24 pts · 6.0 avg\nELO 1016 (+16)',
          url: './tournament/2026-07-15',
        },
        {
          users: ['Bob'],
          title: '🏆 Tournament complete — 2026-07-15',
          body: 'Rank 2/2 · 18 pts · 4.5 avg\nELO 1016 (+16)',
          url: './tournament/2026-07-15',
        },
      ],
    });
  });

  it('falls back to a broadcast summary when the tournament has no players', async () => {
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    global.fetch = fetchMock;

    await sendTournamentCompletedPush({ tournamentDate: '2026-07-15', players: [] }, []);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.client_payload).toEqual({
      title: '🏆 Tournament complete',
      body: 'Tournament on 2026-07-15',
      url: './tournament/2026-07-15',
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
    const fetchMock = vi.fn(async () => ({ status: 204, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await resyncPushSubscription();

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.event_type).toBe('web_push_subscribe');
    expect(body.client_payload.subscription).toEqual(sub);
    expect(body.client_payload.user).toBe('Tester');
  });

  it('does nothing when notification permission is not granted', async () => {
    stubPushEnv({ permission: 'default', subscription: { endpoint: 'x' } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await resyncPushSubscription()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when there is no existing subscription on this device', async () => {
    stubPushEnv({ subscription: undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await resyncPushSubscription()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
