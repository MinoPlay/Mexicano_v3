/**
 * Notification history store — IndexedDB-backed list of received push
 * notifications, shared by sw.js (writer) and the notification bell (reader).
 */
import 'fake-indexeddb/auto';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import {
  addNotification,
  getNotifications,
  getUnreadCount,
  markAllRead,
  clearAll,
} from '../../js/services/notification-store.js';

beforeEach(async () => {
  await clearAll();
});

describe('notification-store', () => {
  it('stores a notification with id, receivedAt and read:false', async () => {
    await addNotification({ title: 'Hello', body: 'World', url: './' });
    const all = await getNotifications();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ title: 'Hello', body: 'World', url: './', read: false });
    expect(all[0].id).toBeDefined();
    expect(typeof all[0].receivedAt).toBe('number');
  });

  it('returns notifications newest-first', async () => {
    await addNotification({ title: 'First', body: '', url: './' });
    await addNotification({ title: 'Second', body: '', url: './' });
    const all = await getNotifications();
    expect(all.map(n => n.title)).toEqual(['Second', 'First']);
  });

  it('prunes history down to the newest 30 entries', async () => {
    for (let i = 0; i < 35; i++) {
      await addNotification({ title: `n${i}`, body: '', url: './' });
    }
    const all = await getNotifications();
    expect(all).toHaveLength(30);
    // Newest (n34) kept, oldest (n0..n4) pruned.
    expect(all[0].title).toBe('n34');
    expect(all.map(n => n.title)).not.toContain('n0');
  });

  it('getUnreadCount reflects unread notifications, markAllRead clears it', async () => {
    await addNotification({ title: 'A', body: '', url: './' });
    await addNotification({ title: 'B', body: '', url: './' });
    expect(await getUnreadCount()).toBe(2);

    await markAllRead();
    expect(await getUnreadCount()).toBe(0);

    const all = await getNotifications();
    expect(all.every(n => n.read === true)).toBe(true);
  });

  it('clearAll empties the history', async () => {
    await addNotification({ title: 'A', body: '', url: './' });
    await clearAll();
    expect(await getNotifications()).toEqual([]);
    expect(await getUnreadCount()).toBe(0);
  });

  it('degrades gracefully (no throw, empty history) when indexedDB is unavailable', async () => {
    const original = globalThis.indexedDB;
    vi.stubGlobal('indexedDB', undefined);
    try {
      await expect(addNotification({ title: 'A', body: '', url: './' })).resolves.not.toThrow();
      expect(await getNotifications()).toEqual([]);
      expect(await getUnreadCount()).toBe(0);
      await expect(markAllRead()).resolves.not.toThrow();
      await expect(clearAll()).resolves.not.toThrow();
    } finally {
      vi.stubGlobal('indexedDB', original);
    }
  });
});
