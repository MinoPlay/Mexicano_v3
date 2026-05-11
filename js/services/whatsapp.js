import { Store } from '../store.js';

let cached = { phone: '', apiKey: '' };
let cachedAt = 0;
let cachedKey = '';
const CACHE_MS = 30000;

function decodeBase64Json(content) {
  const bytes = Uint8Array.from(atob(content.replace(/\n/g, '')), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function getConfigPath(basePath = '') {
  const normalized = String(basePath).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return 'config.json';
  const slash = normalized.lastIndexOf('/');
  return slash === -1 ? 'config.json' : `${normalized.slice(0, slash)}/config.json`;
}

function getConfigIdentity(gh) {
  return `${gh?.owner || ''}|${gh?.repo || ''}|${gh?.basePath || ''}|${gh?.pat || ''}`;
}

async function readWhatsAppConfigFromGitHub(gh) {
  if (!gh?.owner || !gh?.repo || !gh?.pat) return { phone: '', apiKey: '' };

  const path = getConfigPath(gh.basePath);
  const safePath = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}/contents/${safePath}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${gh.pat}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (res.status === 404) return { phone: '', apiKey: '' };
  if (!res.ok) throw new Error(`GitHub config read failed (${res.status}): ${path}`);

  const file = await res.json();
  const cfg = decodeBase64Json(file.content || '');
  const wa = cfg?.whatsapp_alerts || {};
  return {
    phone: typeof wa.phone_number === 'string' ? wa.phone_number.trim() : '',
    apiKey: typeof wa.api_key === 'string' ? wa.api_key.trim() : '',
  };
}

export async function getWhatsAppConfig({ force = false } = {}) {
  const gh = Store.getGitHubConfig();
  const key = getConfigIdentity(gh);
  if (!force && key === cachedKey && Date.now() - cachedAt < CACHE_MS) return cached;
  cached = await readWhatsAppConfigFromGitHub(gh);
  cachedAt = Date.now();
  cachedKey = key;
  return cached;
}

export async function sendDoodleAlert(playerName, yearMonth, selectedAdded = [], selectedRemoved = []) {
  const { phone, apiKey } = await getWhatsAppConfig();
  if (!phone || !apiKey) return;
  if (!selectedAdded.length && !selectedRemoved.length) return;

  const added   = selectedAdded.length   ? selectedAdded.join(', ')   : 'none';
  const removed = selectedRemoved.length ? selectedRemoved.join(', ') : 'none';
  const text    = `🎾 Doodle update — ${playerName} (${yearMonth})\n✅ Added: ${added}\n❌ Removed: ${removed}`;

  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apiKey)}`;

  try {
    await fetch(url, { mode: 'no-cors' });
  } catch (err) {
    console.warn('[whatsapp] alert error:', err);
  }
}
