/**
 * Notification bell — icon anchored at the top-right of the Home page header.
 * Shows an unread-count badge and, on click, opens a popup listing past push
 * notification history (title, body, date) with a "Clear all" action, plus
 * any pinned announcements (e.g. the fine jar rules) that "Clear all" never
 * removes. Opening the popup marks everything read (clearing the badge).
 * Pinned entries show only their title in the list; clicking one opens a
 * separate detail popup with the full, mobile-friendly body text.
 *
 * Each popup closes via its own "×" button or a click outside it. The
 * document click listener is registered exactly once (module load) and is
 * a no-op while nothing is open, so it never leaks across multiple opens.
 * It closes one layer at a time: the detail popup first (if open), then
 * the notifications list on a following outside click.
 */

import { getNotifications, getUnreadCount, markAllRead, clearAll } from '../services/notification-store.js';
import { PINNED_ANNOUNCEMENTS } from '../services/pinned-announcements.js';

let openPopup = null;
let openDetailPopup = null;

function closePopup() {
  if (openPopup) {
    openPopup.remove();
    openPopup = null;
  }
}

function closeDetailPopup() {
  if (openDetailPopup) {
    openDetailPopup.remove();
    openDetailPopup = null;
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (ev) => {
    if (!openPopup) return;
    if (openDetailPopup) {
      if (!openDetailPopup.contains(ev.target)) closeDetailPopup();
      return;
    }
    if (!openPopup.contains(ev.target)) closePopup();
  });
}

function openAnnouncementDetail(announcement) {
  closeDetailPopup();
  const detail = document.createElement('div');
  detail.className = 'notif-detail-popup';
  detail.setAttribute('role', 'dialog');
  detail.innerHTML = `
    <button class="notif-popup-close" aria-label="Close">&times;</button>
    <h3 class="notif-popup-title">${announcement.title}</h3>
    <div class="notif-detail-body">${announcement.body}</div>
  `;
  detail.querySelector('.notif-popup-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeDetailPopup();
  });
  document.body.appendChild(detail);
  openDetailPopup = detail;
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
}

function renderPinnedItems() {
  if (!PINNED_ANNOUNCEMENTS.length) return '';
  return `
    <ul class="notif-list notif-list-pinned">
      ${PINNED_ANNOUNCEMENTS.map(a => `
        <li class="notif-item notif-item-pinned" data-pinned-id="${a.id}" tabindex="0" role="button">
          <span class="notif-item-pin-icon" aria-hidden="true">📌</span>
          <span class="notif-item-title">${a.title}</span>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderList(notifications) {
  if (!notifications.length) {
    return '<p class="notif-empty">No notifications yet.</p>';
  }
  return `
    <ul class="notif-list">
      ${notifications.map(n => `
        <li class="notif-item">
          <div class="notif-item-title">${n.title}</div>
          ${n.body ? `<div class="notif-item-body">${n.body}</div>` : ''}
          <div class="notif-item-date">${formatDate(n.receivedAt)}</div>
        </li>
      `).join('')}
    </ul>
  `;
}

async function buildPopup(refreshBadge) {
  const popup = document.createElement('div');
  popup.className = 'notif-popup';
  popup.setAttribute('role', 'dialog');

  const notifications = await getNotifications();

  popup.innerHTML = `
    <button class="notif-popup-close" aria-label="Close">&times;</button>
    <h3 class="notif-popup-title">Notifications</h3>
    ${renderPinnedItems()}
    ${renderList(notifications)}
    ${notifications.length ? '<button type="button" class="notif-clear-all">Clear all</button>' : ''}
  `;

  popup.querySelector('.notif-popup-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closePopup();
  });

  popup.querySelectorAll('.notif-item-pinned').forEach((el) => {
    const announcement = PINNED_ANNOUNCEMENTS.find(a => a.id === el.dataset.pinnedId);
    if (!announcement) return;
    el.addEventListener('click', (e) => {
      // Stop this click from bubbling to the document — otherwise the
      // always-on outside-click listener sees it as "outside" the detail
      // popup that was *just* created and closes it in the same tick.
      e.stopPropagation();
      openAnnouncementDetail(announcement);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        openAnnouncementDetail(announcement);
      }
    });
  });

  const clearBtn = popup.querySelector('.notif-clear-all');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await clearAll();
      const list = popup.querySelector('.notif-list:not(.notif-list-pinned)') || popup.querySelector('.notif-empty');
      list.outerHTML = renderList([]);
      clearBtn.remove();
      refreshBadge();
    });
  }

  // Opening the popup means the user has seen these notifications.
  await markAllRead();
  refreshBadge();

  return popup;
}

export async function renderNotificationBell() {
  const btn = document.createElement('button');
  btn.className = 'notif-bell';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Notifications');
  btn.innerHTML = '<span class="notif-bell-icon">🔔</span>';

  async function refreshBadge() {
    const unread = await getUnreadCount();
    const existing = btn.querySelector('.notif-bell-badge');
    if (unread > 0) {
      if (existing) {
        existing.textContent = String(unread);
      } else {
        const badge = document.createElement('span');
        badge.className = 'notif-bell-badge';
        badge.textContent = String(unread);
        btn.appendChild(badge);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  await refreshBadge();

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (openPopup && openPopup.isConnected) return;

    const popup = await buildPopup(refreshBadge);
    document.body.appendChild(popup);
    // Anchor under wherever the bell actually is (inline in the home header),
    // computed from its live position instead of a fixed screen offset.
    const rect = btn.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = `${rect.bottom + 8}px`;
    popup.style.right = `${window.innerWidth - rect.right}px`;
    openPopup = popup;
  });

  // Live-refresh the badge while mounted, if the service worker reports a
  // new push arriving (best-effort; no-op outside a browser SW context).
  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'mexicano-notification-added') refreshBadge();
    });
  }

  return btn;
}
