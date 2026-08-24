/**
 * Notification bell — shows an unread-count badge and, on click, a popup
 * listing past push notifications (title/body/date) with a "Clear all"
 * action. Always renders (no longer hidden once push is enabled).
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

let mockNotifications = [];
let mockUnread = 0;
const markAllRead = vi.fn(async () => { mockNotifications = mockNotifications.map(n => ({ ...n, read: true })); mockUnread = 0; });
const clearAll = vi.fn(async () => { mockNotifications = []; mockUnread = 0; });

vi.mock('../../js/services/notification-store.js', () => ({
  getNotifications: async () => mockNotifications,
  getUnreadCount: async () => mockUnread,
  markAllRead: (...args) => markAllRead(...args),
  clearAll: (...args) => clearAll(...args),
}));

import { renderNotificationBell } from '../../js/components/notification-bell.js';

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '';
  mockNotifications = [];
  mockUnread = 0;
  markAllRead.mockClear();
  clearAll.mockClear();
});

describe('Notification bell', () => {
  it('renders a button labelled Notifications', async () => {
    const bell = await renderNotificationBell();
    expect(bell.tagName).toBe('BUTTON');
    expect(bell.getAttribute('aria-label')).toBe('Notifications');
  });

  it('still renders even when there is history / push is enabled (no longer hides)', async () => {
    mockNotifications = [{ id: '1', title: 'Hi', body: 'there', url: './', receivedAt: Date.now(), read: false }];
    mockUnread = 1;
    const bell = await renderNotificationBell();
    expect(bell).not.toBeNull();
  });

  it('shows an unread-count badge matching getUnreadCount', async () => {
    mockUnread = 3;
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);
    const badge = bell.querySelector('.notif-bell-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('3');
  });

  it('hides the badge when there are no unread notifications', async () => {
    mockUnread = 0;
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);
    const badge = bell.querySelector('.notif-bell-badge');
    expect(badge).toBeNull();
  });

  it('opens a popup listing notification history with title, body and date', async () => {
    mockNotifications = [
      { id: '1', title: 'Tournament complete', body: 'Rank 1/8', url: './', receivedAt: new Date('2024-05-01T10:00:00Z').getTime(), read: false },
    ];
    mockUnread = 1;
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);

    expect(document.querySelector('.notif-popup')).toBeNull();
    bell.click();
    await flush();

    const popup = document.querySelector('.notif-popup');
    expect(popup).not.toBeNull();
    expect(popup.textContent).toContain('Tournament complete');
    expect(popup.textContent).toContain('Rank 1/8');
  });

  it('shows an empty state message when there is no history', async () => {
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);
    bell.click();
    await flush();
    expect(document.querySelector('.notif-popup').textContent.toLowerCase()).toContain('no notifications');
  });

  it('marks all as read (and clears the badge) when the popup is opened', async () => {
    mockNotifications = [{ id: '1', title: 'Hi', body: '', url: './', receivedAt: Date.now(), read: false }];
    mockUnread = 1;
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);

    bell.click();
    await flush();

    expect(markAllRead).toHaveBeenCalled();
    expect(bell.querySelector('.notif-bell-badge')).toBeNull();
  });

  it('clears history when "Clear all" is clicked', async () => {
    mockNotifications = [{ id: '1', title: 'Hi', body: '', url: './', receivedAt: Date.now(), read: false }];
    mockUnread = 1;
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);

    bell.click();
    await flush();

    document.querySelector('.notif-clear-all').click();
    await flush();

    expect(clearAll).toHaveBeenCalled();
    expect(document.querySelector('.notif-popup').textContent.toLowerCase()).toContain('no notifications');
  });

  it('closes the popup when the close button is clicked', async () => {
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);

    bell.click();
    await flush();
    expect(document.querySelector('.notif-popup')).not.toBeNull();

    document.querySelector('.notif-popup-close').click();
    expect(document.querySelector('.notif-popup')).toBeNull();
  });
});
