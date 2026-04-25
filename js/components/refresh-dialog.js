/**
 * Modal progress dialog shown while refreshing page data from GitHub.
 */

const STATUS_ICON = {
  pending: '○',
  loading: '⏳',
  done: '✓',
  error: '✗',
};

export function showRefreshDialog(title) {
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

  const header = document.createElement('div');
  Object.assign(header.style, { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' });

  const spinner = document.createElement('span');
  spinner.textContent = '🔄';
  spinner.style.fontSize = '20px';

  const titleEl = document.createElement('span');
  titleEl.style.fontWeight = '600';
  titleEl.style.fontSize = '16px';
  titleEl.textContent = `Refreshing ${title}…`;

  header.appendChild(spinner);
  header.appendChild(titleEl);

  const stepsList = document.createElement('ul');
  Object.assign(stepsList.style, { listStyle: 'none', margin: '0', padding: '0', display: 'flex', flexDirection: 'column', gap: '8px' });

  const errorEl = document.createElement('div');
  Object.assign(errorEl.style, {
    display: 'none', marginTop: '14px', color: 'var(--color-error, #c0392b)',
    fontSize: '13px', wordBreak: 'break-word',
  });

  const closeBtn = document.createElement('button');
  Object.assign(closeBtn.style, {
    display: 'none', marginTop: '14px', width: '100%',
    padding: '8px', borderRadius: '8px', border: '1px solid var(--border, #e0e0e0)',
    background: 'var(--bg-card, #fff)', color: 'var(--text-primary, #111)',
    cursor: 'pointer', fontSize: '14px', fontWeight: '500',
  });
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => { window.removeEventListener('hashchange', _navCleanup); overlay.remove(); });

  card.appendChild(header);
  card.appendChild(stepsList);
  card.appendChild(errorEl);
  card.appendChild(closeBtn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const stepEls = new Map();

  function addStep(label, status = 'pending') {
    if (stepEls.has(label)) return;
    const li = document.createElement('li');
    Object.assign(li.style, { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' });

    const icon = document.createElement('span');
    icon.style.width = '18px';
    icon.style.textAlign = 'center';
    icon.textContent = STATUS_ICON[status] || STATUS_ICON.pending;

    const text = document.createElement('span');
    text.textContent = label;

    li.appendChild(icon);
    li.appendChild(text);
    stepsList.appendChild(li);
    stepEls.set(label, { li, icon });
  }

  function markStep(label, status) {
    const el = stepEls.get(label);
    if (!el) return;
    el.icon.textContent = STATUS_ICON[status] || STATUS_ICON.pending;
  }

  let _closed = false;
  function _navCleanup() { overlay.remove(); }
  window.addEventListener('hashchange', _navCleanup, { once: true });

  function close() {
    if (_closed) return;
    _closed = true;
    window.removeEventListener('hashchange', _navCleanup);
    setTimeout(() => overlay.remove(), 1500);
  }

  function setError(msg) {
    spinner.textContent = '⚠️';
    titleEl.textContent = `Refresh failed`;
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    closeBtn.style.display = 'block';
    stepEls.forEach(({ icon }, label) => {
      if (icon.textContent === STATUS_ICON.loading) icon.textContent = STATUS_ICON.error;
    });
  }

  return { addStep, markStep, close, setError };
}
