let _btn = null;
let _busy = false;

export function mountSyncIndicator(onSync) {
  const btn = document.createElement('button');
  btn.className = 'sync-indicator';
  btn.setAttribute('aria-label', 'Sync with GitHub');
  btn.innerHTML = '<span class="sync-icon">↻</span>';
  document.body.appendChild(btn);
  _btn = btn;

  btn.addEventListener('click', () => {
    if (_busy) return;
    onSync?.();
  });
  return btn;
}

export function setSyncBusy(busy) {
  _busy = busy;
  _btn?.classList.toggle('syncing', busy);
}
