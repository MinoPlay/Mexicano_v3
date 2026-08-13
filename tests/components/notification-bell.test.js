/**
 * Notification bell — a bell icon shown at the top-right of the page.
 * Clicking it opens a popup telling the user they can enable push
 * notifications from the Settings page.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

function makeLocalStorage() {
  let store = {};
  return {
    getItem: (key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
}
vi.stubGlobal('localStorage', makeLocalStorage());

vi.mock('../../js/services/push.js', () => ({
  isPushEnabled: () => mockPushEnabled,
}));
let mockPushEnabled = false;

import { renderNotificationBell } from '../../js/components/notification-bell.js';

beforeEach(() => {
  document.body.innerHTML = '';
  mockPushEnabled = false;
});

describe('Notification bell', () => {
  it('renders a button labelled Notifications at the top-right', () => {
    const bell = renderNotificationBell();
    expect(bell.tagName).toBe('BUTTON');
    expect(bell.getAttribute('aria-label')).toBe('Notifications');
  });

  it('returns null (no bell) when push notifications are already enabled', () => {
    mockPushEnabled = true;
    expect(renderNotificationBell()).toBeNull();
  });

  it('opens a popup mentioning Settings + push notifications on click', () => {
    const bell = renderNotificationBell();
    document.body.appendChild(bell);

    expect(document.querySelector('.notif-popup')).toBeNull();
    bell.click();

    const popup = document.querySelector('.notif-popup');
    expect(popup).not.toBeNull();
    expect(popup.textContent.toLowerCase()).toContain('settings');
    expect(popup.textContent.toLowerCase()).toContain('push notifications');
  });

  it('closes the popup when the close button is clicked', () => {
    const bell = renderNotificationBell();
    document.body.appendChild(bell);

    bell.click();
    expect(document.querySelector('.notif-popup')).not.toBeNull();

    document.querySelector('.notif-popup-close').click();
    expect(document.querySelector('.notif-popup')).toBeNull();
  });
});
