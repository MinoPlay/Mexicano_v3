import { Store } from '../store.js';
import {
  bindCurrentPlayer,
  claimAccess,
  listPlayers,
} from '../services/supabase.js';

export function getOnboardingStep(now = Date.now()) {
  const expiry = Store.getAccessExpiry();
  const hasActiveGrant = Store.getAccessRole()
    && (!expiry || Date.parse(expiry) > now);
  if (!hasActiveGrant) return 'access';
  if (!Store.getCurrentPlayerId() || !Store.getCurrentUser()) return 'player';
  return null;
}

export async function ensurePublicConfig() {
  const response = await fetch('./data/supabase-config.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('Supabase project configuration could not be loaded');
  const config = await response.json();
  if (!config?.url || !config?.anonKey) {
    throw new Error('Supabase project configuration is incomplete');
  }
  const current = Store.getSupabaseConfig();
  const nextUrl = String(config.url).replace(/\/$/, '');
  if (current && (current.url !== nextUrl || current.anonKey !== config.anonKey)) {
    Store.clearSupabaseSession();
    Store.setCurrentUser('');
  }
  Store.setSupabaseConfig(config);
}

function createOverlay() {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '10000',
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
  });
  return overlay;
}

function createCard() {
  const card = document.createElement('div');
  Object.assign(card.style, {
    background: 'var(--bg-card, #1e1e2e)',
    color: 'var(--text-primary, #cdd6f4)',
    border: '1px solid var(--border, #313244)',
    borderRadius: '16px',
    padding: '28px 24px',
    minWidth: '280px',
    maxWidth: '380px',
    width: '100%',
    boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
  });
  return card;
}

function addHeading(card, titleText, description) {
  const title = document.createElement('h2');
  title.textContent = titleText;
  Object.assign(title.style, { margin: '0 0 6px', fontSize: '20px', fontWeight: '700' });
  const text = document.createElement('p');
  text.textContent = description;
  Object.assign(text.style, {
    margin: '0 0 20px',
    fontSize: '14px',
    color: 'var(--text-secondary, #a6adc8)',
    lineHeight: '1.5',
  });
  card.append(title, text);
}

function errorElement() {
  const error = document.createElement('div');
  Object.assign(error.style, {
    color: 'var(--color-danger, #f38ba8)',
    fontSize: '13px',
    marginBottom: '10px',
    minHeight: '18px',
    display: 'none',
  });
  return error;
}

function showError(element, error) {
  element.textContent = error.message || String(error);
  element.style.display = 'block';
}

function renderAccessStep(card) {
  return new Promise((resolve) => {
    card.innerHTML = '';
    addHeading(card, '🔑 Connect Mexicano', 'Enter the shared app access code.');

    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = 'Access code';
    input.autocomplete = 'off';
    input.maxLength = 255;
    input.className = 'form-input';
    Object.assign(input.style, { width: '100%', boxSizing: 'border-box', marginBottom: '10px' });

    const error = errorElement();
    const button = document.createElement('button');
    button.textContent = 'Connect';
    button.className = 'btn btn-primary btn-block';

    const attempt = async () => {
      const code = input.value.trim();
      if (!code) {
        showError(error, new Error('Access code is required.'));
        return;
      }
      error.style.display = 'none';
      button.disabled = true;
      button.textContent = 'Connecting…';
      try {
        await claimAccess(code);
        input.value = '';
        resolve();
      } catch (claimError) {
        showError(error, claimError);
        button.disabled = false;
        button.textContent = 'Connect';
      }
    };

    button.addEventListener('click', attempt);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') attempt();
    });
    card.append(input, error, button);
    input.focus();
  });
}

async function renderPlayerStep(card) {
  card.innerHTML = '';
  addHeading(card, '👤 Who are you?', 'Select your player profile.');
  const loading = document.createElement('div');
  loading.textContent = 'Loading players…';
  Object.assign(loading.style, {
    textAlign: 'center',
    padding: '12px 0',
    color: 'var(--text-secondary, #a6adc8)',
  });
  card.appendChild(loading);

  const players = await listPlayers();
  loading.remove();
  if (!players.length) throw new Error('No active players are available');

  return new Promise((resolve) => {
    const error = errorElement();
    const list = document.createElement('div');
    Object.assign(list.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      maxHeight: '300px',
      overflowY: 'auto',
    });

    for (const player of players) {
      const button = document.createElement('button');
      button.textContent = player.name;
      button.className = 'btn btn-secondary btn-block';
      Object.assign(button.style, { justifyContent: 'flex-start', fontWeight: '500' });
      button.addEventListener('click', async () => {
        error.style.display = 'none';
        button.disabled = true;
        try {
          await bindCurrentPlayer(player.id, player.name);
          resolve();
        } catch (bindError) {
          showError(error, bindError);
          button.disabled = false;
        }
      });
      list.appendChild(button);
    }
    card.append(error, list);
  });
}

export async function showOnboardingDialog() {
  await ensurePublicConfig();
  if (!getOnboardingStep()) return;

  const overlay = createOverlay();
  const card = createCard();
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  try {
    if (getOnboardingStep() === 'access') await renderAccessStep(card);
    if (getOnboardingStep() === 'player') await renderPlayerStep(card);
  } catch (error) {
    card.innerHTML = '';
    addHeading(card, 'Connection unavailable', error.message || 'Supabase onboarding failed');
    throw error;
  } finally {
    if (!getOnboardingStep()) overlay.remove();
  }
}
