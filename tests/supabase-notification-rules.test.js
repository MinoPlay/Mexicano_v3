import { describe, expect, it } from 'vitest';
import { authorizeNotification } from '../supabase/functions/_shared/notifications.ts';

const member = { role: 'member', playerName: 'Alice', userId: 'u1' };
const admin = { role: 'admin', playerName: 'Boss', userId: 'u2' };

const doodle = (overrides = {}) => ({
  channel: 'telegram',
  event_type: 'telegram_alert',
  idempotency_key: 'telegram:doodle:2026-10:Alice:x',
  payload: {
    kind: 'doodle',
    text: 'forged text',
    yearMonth: '2026-10',
    selectedAdded: ['2026-10-06'],
    selectedRemoved: [],
  },
  ...overrides,
});

describe('authorizeNotification', () => {
  it('rebuilds member doodle text server-side from the bound player', () => {
    const result = authorizeNotification(member, doodle());
    expect(result.payload).toEqual({
      kind: 'doodle',
      text: '🎾 Doodle update — Alice (2026-10)\n✅ Added: 2026-10-06\n❌ Removed: none',
    });
    expect(result.channel).toBe('telegram');
    expect(result.event_type).toBe('telegram_alert');
  });

  it('rebuilds member confirmation text server-side', () => {
    const result = authorizeNotification(member, {
      channel: 'telegram',
      event_type: 'telegram_alert',
      idempotency_key: 'k',
      payload: { kind: 'tournament-confirmation', text: 'x', tournamentDate: '2026-10-06' },
    });
    expect(result.payload.text).toBe('🎾 Alice confirmed attendance for tournament on 2026-10-06');
  });

  it('namespaces idempotency keys per user so others cannot pre-claim them', () => {
    expect(authorizeNotification(member, doodle()).idempotency_key)
      .toBe('u1:telegram:doodle:2026-10:Alice:x');
  });

  it('rejects member-only kinds without a bound player', () => {
    expect(() => authorizeNotification({ ...member, playerName: null }, doodle()))
      .toThrow(/player/i);
  });

  it('rejects malformed member payloads', () => {
    expect(() => authorizeNotification(member, doodle({
      payload: { kind: 'doodle', yearMonth: 'nope', selectedAdded: [], selectedRemoved: [] },
    }))).toThrow(/invalid/i);
    expect(() => authorizeNotification(member, doodle({
      payload: { kind: 'doodle', yearMonth: '2026-10', selectedAdded: ['<b>'], selectedRemoved: [] },
    }))).toThrow(/invalid/i);
  });

  it('denies members admin-only Telegram kinds and targets', () => {
    for (const kind of ['test', 'tournament-test', 'tournament-created', 'tournament-completed']) {
      expect(() => authorizeNotification(member, doodle({ payload: { kind, text: 'x' } })))
        .toThrow(/admin/i);
    }
    expect(() => authorizeNotification(member, doodle({
      payload: { ...doodle().payload, target: 'tournaments' },
    }))).toThrow(/admin/i);
  });

  it('denies members any push notification', () => {
    expect(() => authorizeNotification(member, {
      channel: 'push',
      event_type: 'web_push',
      idempotency_key: 'k',
      payload: { title: 'phish', body: 'x', url: 'https://evil' },
    })).toThrow(/admin/i);
  });

  it('rejects unknown channels and event types for everyone', () => {
    expect(() => authorizeNotification(admin, { channel: 'telegram', event_type: 'deploy', idempotency_key: 'k', payload: {} }))
      .toThrow(/unsupported/i);
    expect(() => authorizeNotification(admin, { channel: 'email', event_type: 'telegram_alert', idempotency_key: 'k', payload: {} }))
      .toThrow(/unsupported/i);
    expect(() => authorizeNotification(admin, { channel: 'push', event_type: 'web_push_subscribe', idempotency_key: 'k', payload: {} }))
      .toThrow(/unsupported/i);
  });

  it('lets admins send tournament/test Telegram alerts and push as provided', () => {
    const tg = authorizeNotification(admin, {
      channel: 'telegram',
      event_type: 'telegram_alert',
      idempotency_key: 'telegram:tournament-created:2026-10-06:',
      payload: { kind: 'tournament-created', text: 'hello', target: 'tournaments' },
    });
    expect(tg.payload).toEqual({ kind: 'tournament-created', text: 'hello', target: 'tournaments' });

    const push = authorizeNotification(admin, {
      channel: 'push',
      event_type: 'web_push',
      idempotency_key: 'push:x',
      payload: { title: 't', body: 'b', url: './' },
    });
    expect(push.payload).toEqual({ title: 't', body: 'b', url: './' });
  });

  it('rejects unknown Telegram targets even for admins', () => {
    expect(() => authorizeNotification(admin, {
      channel: 'telegram',
      event_type: 'telegram_alert',
      idempotency_key: 'k',
      payload: { kind: 'test', text: 'x', target: 'everyone' },
    })).toThrow(/target/i);
  });

  it('requires an idempotency key', () => {
    expect(() => authorizeNotification(member, doodle({ idempotency_key: '' }))).toThrow(/idempotency/i);
  });
});
