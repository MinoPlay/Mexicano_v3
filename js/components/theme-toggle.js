import { Store } from '../store.js';

export function renderThemeToggle() {
  const btn = document.createElement('button');
  btn.className = 'btn btn-ghost btn-sm';
  btn.setAttribute('aria-label', 'Toggle theme');
  btn.id = 'theme-toggle';

  function update() {
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  btn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    Store.setTheme(next);
    update();
  });

  update();
  return btn;
}

export function initTheme() {
  const saved = Store.getTheme();
  document.documentElement.setAttribute('data-theme', saved);
}
