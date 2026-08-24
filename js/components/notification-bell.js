/**
 * Notification bell — icon anchored at the top-right of the Home page header.
 * Shows an unread-count badge and, on click, opens a popup listing past push
 * notification history (title, body, date) with a "Clear all" action.
 * Opening the popup marks everything read (clearing the badge).
 */

import { getNotifications, getUnreadCount, markAllRead, clearAll } from '../services/notification-store.js';

let openPopup = null;

function closePopup() {
  if (openPopup) {
    openPopup.remove();
    openPopup = null;
    document.removeEventListener('keydown', onKeydown);
  }
}

function onKeydown(e) {
  if (e.key === 'Escape') closePopup();
}

function formatDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
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
    ${renderList(notifications)}
    ${notifications.length ? '<button type="button" class="notif-clear-all">Clear all</button>' : ''}
  `;

  popup.querySelector('.notif-popup-close').addEventListener('click', closePopup);

  const clearBtn = popup.querySelector('.notif-clear-all');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await clearAll();
      const list = popup.querySelector('.notif-list') || popup.querySelector('.notif-empty');
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
    if (openPopup && openPopup.isConnected) { closePopup(); return; }
    if (openPopup) closePopup();

    const popup = await buildPopup(refreshBadge);
    document.body.appendChild(popup);
    // Anchor under wherever the bell actually is (inline in the home header),
    // computed from its live position instead of a fixed screen offset.
    const rect = btn.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.top = `${rect.bottom + 8}px`;
    popup.style.right = `${window.innerWidth - rect.right}px`;
    openPopup = popup;

    document.addEventListener('keydown', onKeydown);
    // Dismiss when clicking outside the popup or the bell.
    setTimeout(() => {
      document.addEventListener('click', function onDocClick(ev) {
        if (!openPopup) { document.removeEventListener('click', onDocClick); return; }
        if (!openPopup.contains(ev.target) && ev.target !== btn) {
          closePopup();
          document.removeEventListener('click', onDocClick);
        }
      });
    }, 0);
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
