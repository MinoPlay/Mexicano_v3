/**
 * Notification bell — a bell icon anchored at the top-right of the page.
 * Clicking it opens a small popup informing the user that push notifications
 * can now be enabled from the Settings page.
 */

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

function buildPopup(anchor) {
  const popup = document.createElement('div');
  popup.className = 'notif-popup';
  popup.setAttribute('role', 'dialog');
  popup.innerHTML = `
    <button class="notif-popup-close" aria-label="Close">&times;</button>
    <div class="notif-popup-icon">🔔</div>
    <h3 class="notif-popup-title">Push notifications</h3>
    <p class="notif-popup-text">
      You can now enable push notifications! Head to
      <a href="#/settings">Settings</a> and turn on push notifications to get
      alerts on this device.
    </p>
  `;

  popup.querySelector('.notif-popup-close').addEventListener('click', closePopup);
  popup.querySelector('a').addEventListener('click', closePopup);

  return popup;
}

export function renderNotificationBell() {
  const btn = document.createElement('button');
  btn.className = 'notif-bell';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Notifications');
  btn.innerHTML = '<span class="notif-bell-icon">🔔</span>';

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openPopup && openPopup.isConnected) { closePopup(); return; }
    if (openPopup) closePopup();

    const popup = buildPopup(btn);
    document.body.appendChild(popup);
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

  return btn;
}
