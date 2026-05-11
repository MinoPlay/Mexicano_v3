import { Store } from '../store.js';

const EMPTY = Object.freeze({ phone: '', apiKey: '' });
const GH_API = 'https://api.github.com';
const GH_ACCEPT = 'application/vnd.github+json';
const GH_API_VERSION = '2022-11-28';
const CACHE_MS = 30000;
const MIN_SEND_GAP_MS = 6500;

let cached = EMPTY;
let cachedAt = 0;
let cachedKey = '';
let configLoadPromise = null;
let configLoadKey = '';
let sendQueue = Promise.resolve();
let lastSentAt = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

function getHeaders(pat) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: GH_ACCEPT,
    'X-GitHub-Api-Version': GH_API_VERSION,
  };
}

function parseWaConfig(cfg) {
  const wa = cfg?.whatsapp_alerts || {};
  return {
    phone: typeof wa.phone_number === 'string' ? wa.phone_number.trim() : '',
    apiKey: typeof wa.api_key === 'string' ? wa.api_key.trim() : '',
  };
}

async function readWhatsAppConfigFromGitHub(gh) {
  if (!gh?.owner || !gh?.repo || !gh?.pat) return EMPTY;

  const path = getConfigPath(gh.basePath);
  const safePath = path.split('/').map(encodeURIComponent).join('/');
  const owner = encodeURIComponent(gh.owner);
  const repo = encodeURIComponent(gh.repo);
  const url = `${GH_API}/repos/${owner}/${repo}/contents/${safePath}`;
  const res = await fetch(url, { headers: getHeaders(gh.pat) });

  if (res.status === 404) return EMPTY;
  if (!res.ok) throw new Error(`GitHub config read failed (${res.status}): ${path}`);

  const file = await res.json();
  const cfg = decodeBase64Json(file.content || '');
  return parseWaConfig(cfg);
}

export async function getWhatsAppConfig({ force = false } = {}) {
  const gh = Store.getGitHubConfig();
  const key = getConfigIdentity(gh);
  if (!force && key === cachedKey && Date.now() - cachedAt < CACHE_MS) return cached;

  if (!force && key === configLoadKey && configLoadPromise) return configLoadPromise;

  configLoadKey = key;
  configLoadPromise = readWhatsAppConfigFromGitHub(gh)
    .then(result => {
      cached = result;
      cachedAt = Date.now();
      cachedKey = key;
      return cached;
    })
    .finally(() => {
      configLoadPromise = null;
      configLoadKey = '';
    });

  const result = await configLoadPromise;
  cachedAt = Date.now();
  return result;
}

async function dispatchAlert(url) {
  const elapsed = Date.now() - lastSentAt;
  const waitMs = Math.max(0, MIN_SEND_GAP_MS - elapsed);
  if (waitMs > 0) await sleep(waitMs);
  await fetch(url, { mode: 'no-cors' });
  lastSentAt = Date.now();
}

export async function sendDoodleAlert(playerName, yearMonth, selectedAdded = [], selectedRemoved = []) {
  const { phone, apiKey } = await getWhatsAppConfig();
  if (!phone || !apiKey) return;
  if (!selectedAdded.length && !selectedRemoved.length) return;

  const added   = selectedAdded.length   ? selectedAdded.join(', ')   : 'none';
  const removed = selectedRemoved.length ? selectedRemoved.join(', ') : 'none';
  const text    = `🎾 Doodle update — ${playerName} (${yearMonth})\n✅ Added: ${added}\n❌ Removed: ${removed}`;

  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apiKey)}`;

  sendQueue = sendQueue.then(async () => {
    try {
      await dispatchAlert(url);
    } catch (err) {
      console.warn('[whatsapp] alert error:', err);
    }
  });

  return sendQueue;
}
