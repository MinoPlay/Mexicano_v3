/**
 * Simple modal error dialog. Used where a toast/inline message is not
 * detailed enough (e.g. a failed attendance confirmation dispatch) — shows
 * the actual error message so the user knows what went wrong and can retry.
 */
export function showErrorDialog(title, message) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '9999',
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '16px',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: 'var(--bg-card, #fff)',
    color: 'var(--text-primary, #111)',
    border: '1px solid var(--border, #e0e0e0)',
    borderRadius: '12px',
    padding: '20px 24px',
    minWidth: '260px',
    maxWidth: '360px',
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
  });

  const titleEl = document.createElement('div');
  Object.assign(titleEl.style, { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px', fontWeight: '600', fontSize: '16px' });
  titleEl.textContent = `⚠️ ${title}`;

  const bodyEl = document.createElement('div');
  Object.assign(bodyEl.style, { fontSize: '14px', color: 'var(--text-secondary, #555)', wordBreak: 'break-word', marginBottom: '18px' });
  bodyEl.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn btn-primary';
  Object.assign(closeBtn.style, { width: '100%' });
  closeBtn.textContent = 'OK';

  function close() {
    window.removeEventListener('hashchange', close);
    overlay.remove();
  }
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  window.addEventListener('hashchange', close, { once: true });

  card.appendChild(titleEl);
  card.appendChild(bodyEl);
  card.appendChild(closeBtn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  return { close };
}
