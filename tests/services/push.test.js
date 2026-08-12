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
  buildSubscribePayload,
  buildPushAlertPayload,
  dispatchSubscription,
  sendPushNotification,
} from '../../js/services/push.js';

beforeEach(() => {
  vi.restoreAllMocks();
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
});
