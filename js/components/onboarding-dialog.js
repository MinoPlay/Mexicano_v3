/**
 * Onboarding dialog — shown on first launch when PAT or current_user is missing.
 * Step 1: Enter GitHub PAT → test connection → save config.
 * Step 2: Pick player from members list → save current_user.
 * Returns a Promise that resolves when onboarding is complete.
 */

import { Store } from '../store.js';
import { testConnection } from '../services/backend.js';

const FIXED_CONFIG = {
  owner:    'MinoPlay',
  repo:     'DataHub_Mexicano',
  basePath: 'mexicano_v3/backup-data',
};

/**
 * Fetch members from players.json using the saved config.
 * Returns sorted array of name strings, or [] on failure.
 */
async function fetchMembers(pat) {
  try {
    const { owner, repo, basePath } = FIXED_CONFIG;
    const path = `${basePath}/players.json`;
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return [];
    const file = await res.json();
    const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0));
    const decoded = JSON.parse(new TextDecoder().decode(bytes));
    if (!Array.isArray(decoded)) return [];
    return decoded.map(p => p.Name).filter(Boolean).sort();
  } catch {
    return [];
  }
}

function createOverlay() {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position:       'fixed',
    inset:          '0',
    zIndex:         '10000',
    background:     'rgba(0,0,0,0.7)',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    padding:        '16px',
  });
  return overlay;
}

function createCard() {
  const card = document.createElement('div');
  Object.assign(card.style, {
    background:   'var(--bg-card, #1e1e2e)',
    color:        'var(--text-primary, #cdd6f4)',
    border:       '1px solid var(--border, #313244)',
    borderRadius: '16px',
    padding:      '28px 24px',
    minWidth:     '280px',
    maxWidth:     '380px',
    width:        '100%',
    boxShadow:    '0 8px 40px rgba(0,0,0,0.4)',
  });
  return card;
}

function stepDots(current, total) {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    display:        'flex',
    gap:            '6px',
    justifyContent: 'center',
    marginBottom:   '20px',
  });
  for (let i = 1; i <= total; i++) {
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      width:        '8px',
      height:       '8px',
      borderRadius: '50%',
      background:   i === current
        ? 'var(--color-primary, #3b82f6)'
        : 'var(--border, #313244)',
      display:      'inline-block',
      transition:   'background 0.2s',
    });
    wrap.appendChild(dot);
  }
  return wrap;
}

/** Step 1: PAT entry. Resolves with the validated PAT string. */
function renderStep1(card, totalSteps) {
  return new Promise((resolve) => {
    card.innerHTML = '';
    card.appendChild(stepDots(1, totalSteps));

    const title = document.createElement('h2');
    Object.assign(title.style, { margin: '0 0 6px', fontSize: '20px', fontWeight: '700' });
    title.textContent = '🔑 Connect GitHub';

    const sub = document.createElement('p');
    Object.assign(sub.style, { margin: '0 0 20px', fontSize: '14px', color: 'var(--text-secondary, #a6adc8)', lineHeight: '1.5' });
    sub.textContent = 'Enter your Personal Access Token with repo scope to connect the data backend.';

    const input = document.createElement('input');
    input.type          = 'password';
    input.placeholder   = 'ghp_…';
    input.autocomplete  = 'off';
    input.maxLength     = 255;
    Object.assign(input.style, { width: '100%', boxSizing: 'border-box', marginBottom: '10px' });
    input.className = 'form-input';

    const errorEl = document.createElement('div');
    Object.assign(errorEl.style, {
      color:        'var(--color-danger, #f38ba8)',
      fontSize:     '13px',
      marginBottom: '10px',
      minHeight:    '18px',
      display:      'none',
    });

    const btn = document.createElement('button');
    btn.textContent = 'Connect';
    btn.className   = 'btn btn-primary btn-block';

    async function attempt() {
      const pat = input.value.trim();
      if (!pat) { errorEl.textContent = 'PAT is required.'; errorEl.style.display = 'block'; return; }

      btn.disabled     = true;
      btn.textContent  = 'Connecting…';
      errorEl.style.display = 'none';

      Store.setGitHubConfig({ ...FIXED_CONFIG, pat });
      const result = await testConnection();

      if (result.ok) {
        btn.textContent = '✓ Connected';
        setTimeout(() => resolve(pat), 400);
      } else {
        Store.clearGitHubConfig();
        errorEl.textContent   = result.message;
        errorEl.style.display = 'block';
        btn.disabled          = false;
        btn.textContent       = 'Connect';
      }
    }

    btn.addEventListener('click', attempt);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });

    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(input);
    card.appendChild(errorEl);
    card.appendChild(btn);

    input.focus();
  });
}

/** Step 2: Player selection. Resolves when user picks a name. */
function renderStep2(card, totalSteps, pat) {
  return new Promise(async (resolve) => {
    card.innerHTML = '';
    card.appendChild(stepDots(2, totalSteps));

    const title = document.createElement('h2');
    Object.assign(title.style, { margin: '0 0 6px', fontSize: '20px', fontWeight: '700' });
    title.textContent = '👤 Who are you?';

    const sub = document.createElement('p');
    Object.assign(sub.style, { margin: '0 0 16px', fontSize: '14px', color: 'var(--text-secondary, #a6adc8)' });
    sub.textContent = 'Select your player profile.';

    const loadingEl = document.createElement('div');
    Object.assign(loadingEl.style, { textAlign: 'center', padding: '12px 0', fontSize: '14px', color: 'var(--text-secondary, #a6adc8)' });
    loadingEl.textContent = 'Loading players…';

    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(loadingEl);

    const members = await fetchMembers(pat);
    loadingEl.remove();

    function pickName(name) {
      Store.setCurrentUser(name);
      resolve();
    }

    if (members.length > 0) {
      const list = document.createElement('div');
      Object.assign(list.style, {
        display:       'flex',
        flexDirection: 'column',
        gap:           '8px',
        maxHeight:     '260px',
        overflowY:     'auto',
        marginBottom:  '0',
      });

      members.forEach(name => {
        const btn = document.createElement('button');
        btn.textContent = name;
        btn.className   = 'btn btn-secondary btn-block';
        Object.assign(btn.style, { justifyContent: 'flex-start', fontWeight: '500' });
        btn.addEventListener('click', () => pickName(name));
        list.appendChild(btn);
      });

      card.appendChild(list);
    } else {
      // Fallback: text input
      sub.textContent = 'Could not load player list. Enter your name manually.';

      const input = document.createElement('input');
      input.type        = 'text';
      input.placeholder = 'Your name';
      input.maxLength   = 50;
      Object.assign(input.style, { width: '100%', boxSizing: 'border-box', marginBottom: '10px' });
      input.className = 'form-input';

      const errorEl = document.createElement('div');
      Object.assign(errorEl.style, {
        color:        'var(--color-danger, #f38ba8)',
        fontSize:     '13px',
        marginBottom: '10px',
        minHeight:    '18px',
        display:      'none',
      });

      const btn = document.createElement('button');
      btn.textContent = 'Continue';
      btn.className   = 'btn btn-primary btn-block';
      btn.addEventListener('click', () => {
        const name = input.value.trim();
        if (!name) { errorEl.textContent = 'Name required.'; errorEl.style.display = 'block'; return; }
        pickName(name);
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });

      card.appendChild(input);
      card.appendChild(errorEl);
      card.appendChild(btn);
      input.focus();
    }
  });
}

/**
 * Show the onboarding dialog if PAT or current_user is missing.
 * Resolves when onboarding is complete (or skipped entirely).
 */
export async function showOnboardingDialog() {
  const hasPat  = !!Store.getGitHubConfig()?.pat;
  const hasUser = !!Store.getCurrentUser();

  if (hasPat && hasUser) return;

  // Full onboarding (no PAT) always includes player selection,
  // even if seed-data.js already wrote a default current_user.
  const needsUser = !hasUser || !hasPat;
  const totalSteps = (!hasPat && needsUser) ? 2 : 1;

  const overlay = createOverlay();
  const card    = createCard();
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  let pat = Store.getGitHubConfig()?.pat;

  if (!hasPat) {
    pat = await renderStep1(card, totalSteps);
  }

  if (needsUser) {
    await renderStep2(card, totalSteps, pat);
  }

  overlay.remove();
}
