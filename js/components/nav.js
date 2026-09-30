import { Store } from '../store.js';

const NAV_ITEMS = [
  { path: '/', icon: '🏠', label: 'Home' },
  { path: '/tournaments', icon: '📋', label: 'Tournaments' },
  { path: '/players', icon: '👥', label: 'Players' },
  { path: '/statistics', icon: '📊', label: 'Statistics' },
  { path: '/elo-charts', icon: '📈', label: 'ELO Charts' },
  { path: '/attendance', icon: '📅', label: 'Attendance' },
  { path: '/doodle', icon: '🗓️', label: 'Doodle' },
  { path: '/logs', icon: '📝', label: 'Logs' },
  { path: '/settings', icon: '⚙️', label: 'Settings' }
];

export function renderNav() {
  const nav = document.createElement('nav');
  nav.className = 'side-nav';
  nav.setAttribute('aria-label', 'Main navigation');
  const COLLAPSE_KEY = 'mexicano_sidebar_collapsed';
  const applyCollapsed = (on) => document.documentElement.classList.toggle('sidebar-collapsed', on);
  applyCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');

  function renderItems() {
    const visibleItems = NAV_ITEMS.filter(item =>
      item.path !== '/logs' || (Store.isAdministrator() && Store.isLogsEnabled())
    );

    nav.innerHTML = `
      <a href="#/" class="side-nav-brand" aria-label="Mexicano home">
        <span class="side-nav-logo">🎾</span><span class="side-nav-label">Mexicano</span>
      </a>
      <div class="side-nav-items">
        ${visibleItems.map(item => `
          <a href="#${item.path}" class="nav-item" data-path="${item.path}" aria-label="${item.label}" title="${item.label}">
            <span class="nav-item-icon">${item.icon}</span>
            <span class="side-nav-label">${item.label}</span>
          </a>
        `).join('')}
      </div>
      <button type="button" class="side-nav-collapse" aria-label="Toggle sidebar" title="Toggle sidebar">⇤</button>
    `;
    nav.querySelector('.side-nav-collapse').addEventListener('click', () => {
      const on = !document.documentElement.classList.contains('sidebar-collapsed');
      localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0');
      applyCollapsed(on);
    });

    updateActive();
  }

  // Update active state
  function updateActive() {
    const hash = window.location.hash.slice(1) || '/';
    const currentPath = hash.split('?')[0];
    nav.querySelectorAll('.nav-item').forEach(el => {
      const path = el.dataset.path;
      const isActive = path === '/'
        ? currentPath === '/'
        : currentPath.startsWith(path);
      el.classList.toggle('active', isActive);
    });
  }

  updateActive();
  window.addEventListener('hashchange', updateActive);

  renderItems();
  window.addEventListener('mexicano:user-changed', renderItems);

  return nav;
}

export function renderHeader(title, rightContent = '') {
  return `
    <header class="page-header">
      <h1>${title}</h1>
      <div class="flex items-center gap-sm">${rightContent}</div>
    </header>
  `;
}
