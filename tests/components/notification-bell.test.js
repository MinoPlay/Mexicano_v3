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

  it('always shows a pinned "The fine jar is open!" announcement, even with no history', async () => {
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);
    bell.click();
    await flush();

    const pinned = document.querySelector('.notif-item-pinned');
    expect(pinned).not.toBeNull();
    expect(pinned.textContent).toContain('The fine jar is open!');
    // Only the title shows in the list, not the extended body.
    expect(pinned.textContent).not.toContain('MobilePay');
  });

  it('opens a detail popup with the full fine jar info when the pinned item is clicked', async () => {
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);
    bell.click();
    await flush();

    document.querySelector('.notif-item-pinned').click();
    await flush();

    const detail = document.querySelector('.notif-detail-popup');
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain('75 kr');
    expect(detail.textContent).toContain('MobilePay');
    expect(detail.textContent).toContain('6:00 SHARP');
  });

  it('always shows a pinned "Practical info" announcement, even with no history', async () => {
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);
    bell.click();
    await flush();

    const pinned = document.querySelectorAll('.notif-item-pinned');
    const titles = Array.from(pinned).map(el => el.textContent);
    expect(titles.some(t => t.includes('Practical info'))).toBe(true);
    // Only the title shows in the list, not the extended body.
    expect(titles.join('')).not.toContain('MobilePay');
  });

  it('opens a detail popup with the full practical info when that pinned item is clicked', async () => {
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);
    bell.click();
    await flush();

    const pinned = Array.from(document.querySelectorAll('.notif-item-pinned'))
      .find(el => el.textContent.includes('Practical info'));
    pinned.click();
    await flush();

    const detail = document.querySelector('.notif-detail-popup');
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain('Match Padel Ballerup');
    expect(detail.textContent).toContain('MobilePay');
    expect(detail.textContent).toContain('06:00 sharp');
  });

  it('"Clear all" removes history but never removes the pinned announcement', async () => {
    mockNotifications = [{ id: '1', title: 'Hi', body: '', url: './', receivedAt: Date.now(), read: false }];
    mockUnread = 1;
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);

    bell.click();
    await flush();
    document.querySelector('.notif-clear-all').click();
    await flush();

    expect(clearAll).toHaveBeenCalled();
    expect(document.querySelector('.notif-item-pinned')).not.toBeNull();
  });

  it('closing the detail popup via its "×" leaves the notifications list open', async () => {
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);

    bell.click();
    await flush();
    document.querySelector('.notif-item-pinned').click();
    await flush();
    expect(document.querySelector('.notif-detail-popup')).not.toBeNull();

    document.querySelectorAll('.notif-detail-popup .notif-popup-close')[0].click();
    expect(document.querySelector('.notif-detail-popup')).toBeNull();
    expect(document.querySelector('.notif-popup')).not.toBeNull();
  });

  it('closing the notifications list via its "×" leaves an open detail popup untouched', async () => {
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);

    bell.click();
    await flush();
    document.querySelector('.notif-item-pinned').click();
    await flush();
    expect(document.querySelector('.notif-detail-popup')).not.toBeNull();

    document.querySelector('.notif-popup .notif-popup-close').click();
    expect(document.querySelector('.notif-popup')).toBeNull();
    expect(document.querySelector('.notif-detail-popup')).not.toBeNull();
  });

  it('closes one layer at a time on outside click: detail first, then the list', async () => {
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);

    bell.click();
    await flush();
    document.querySelector('.notif-item-pinned').click();
    await flush();
    expect(document.querySelector('.notif-detail-popup')).not.toBeNull();
    expect(document.querySelector('.notif-popup')).not.toBeNull();

    document.body.click();
    await flush();
    expect(document.querySelector('.notif-detail-popup')).toBeNull();
    expect(document.querySelector('.notif-popup')).not.toBeNull();

    document.body.click();
    await flush();
    expect(document.querySelector('.notif-popup')).toBeNull();
  });

  it('an outside click closes the list when no detail popup is open', async () => {
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);

    bell.click();
    await flush();
    expect(document.querySelector('.notif-popup')).not.toBeNull();

    document.body.click();
    await flush();
    expect(document.querySelector('.notif-popup')).toBeNull();
  });

  it('a click inside the popup does not close it', async () => {
    const bell = await renderNotificationBell();
    document.body.appendChild(bell);

    bell.click();
    await flush();
    document.querySelector('.notif-popup-title').click();
    await flush();
    expect(document.querySelector('.notif-popup')).not.toBeNull();
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
