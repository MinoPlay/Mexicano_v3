import { Store } from '../store.js';

const NAV_ITEMS = [
  { path: '/', icon: '🏠', label: 'Home' },
  { path: '/tournaments', icon: '📋', label: 'Tournaments' },
  { path: '/statistics', icon: '📊', label: 'Stats' },
  { path: '/doodle', icon: '🗓️', label: 'Doodle' },
  { path: '/settings', icon: '⚙️', label: 'Settings' }
];

export function renderNav() {
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.setAttribute('aria-label', 'Main navigation');

  nav.innerHTML = NAV_ITEMS.map(item => `
    <a href="#${item.path}" class="nav-item" data-path="${item.path}" aria-label="${item.label}">
      <span class="nav-item-icon">${item.icon}</span>
      <span>${item.label}</span>
    </a>
  `).join('');

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
