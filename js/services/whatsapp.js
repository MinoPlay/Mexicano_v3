import { Store } from '../store.js';

const EMPTY = Object.freeze({ phone: '', apiKey: '' });
const GH_API = 'https://api.github.com';
const GH_ACCEPT = 'application/vnd.github+json';
const GH_API_VERSION = '2022-11-28';
const CACHE_MS = 30000;
const MIN_SEND_GAP_MS = 6500;
const LOG_PREFIX = '[whatsapp]';

let cached = EMPTY;
let cachedAt = 0;
let cachedKey = '';
let configLoadPromise = null;
let configLoadKey = '';
let sendQueue = Promise.resolve();
let lastSentAt = 0;
let queueDepth = 0;
let sendSequence = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(level, message, details) {
  if (details === undefined) {
    console[level](`${LOG_PREFIX} ${message}`);
    return;
  }
  console[level](`${LOG_PREFIX} ${message}`, details);
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
  if (!gh?.owner || !gh?.repo || !gh?.pat) {
    log('warn', 'GitHub backend not configured; alerts disabled.');
    return EMPTY;
  }

  const path = getConfigPath(gh.basePath);
  const safePath = path.split('/').map(encodeURIComponent).join('/');
  const owner = encodeURIComponent(gh.owner);
  const repo = encodeURIComponent(gh.repo);
  const url = `${GH_API}/repos/${owner}/${repo}/contents/${safePath}`;
  const res = await fetch(url, { headers: getHeaders(gh.pat) });

  if (res.status === 404) {
    log('warn', 'config.json not found; alerts disabled.', { path });
    return EMPTY;
  }
  if (!res.ok) throw new Error(`GitHub config read failed (${res.status}): ${path}`);

  const file = await res.json();
  const cfg = decodeBase64Json(file.content || '');
  const parsed = parseWaConfig(cfg);
  if (!parsed.phone || !parsed.apiKey) {
    log('warn', 'whatsapp_alerts config missing required fields.', {
      path,
      hasPhone: !!parsed.phone,
      hasApiKey: !!parsed.apiKey,
    });
  }
  return parsed;
}

export async function getWhatsAppConfig({ force = false } = {}) {
  const gh = Store.getGitHubConfig();
  const key = getConfigIdentity(gh);
  if (!force && key === cachedKey && Date.now() - cachedAt < CACHE_MS) {
    return cached;
  }

  if (!force && key === configLoadKey && configLoadPromise) {
    return configLoadPromise;
  }

  configLoadKey = key;
  configLoadPromise = readWhatsAppConfigFromGitHub(gh)
    .then(result => {
      cached = result;
      cachedAt = Date.now();
      cachedKey = key;
      return cached;
    })
    .catch(err => {
      log('error', 'Failed to load WhatsApp config.', err);
      throw err;
    })
    .finally(() => {
      configLoadPromise = null;
      configLoadKey = '';
    });

  const result = await configLoadPromise;
  cachedAt = Date.now();
  return result;
}

async function dispatchAlert(url, meta) {
  const elapsed = Date.now() - lastSentAt;
  const waitMs = Math.max(0, MIN_SEND_GAP_MS - elapsed);
  if (waitMs > 0) await sleep(waitMs);
  log('info', 'Sending WhatsApp alert.', { kind: meta.kind, url });
  await fetch(url, { mode: 'no-cors' });
  lastSentAt = Date.now();
}

function queueAlert(url, meta) {
  const seq = ++sendSequence;
  queueDepth += 1;
  const runMeta = { ...meta, seq, queueDepth };

  sendQueue = sendQueue.then(async () => {
    try {
      await dispatchAlert(url, runMeta);
    } catch (err) {
      log('warn', 'Alert dispatch failed.', { kind: meta.kind, error: err?.message || String(err) });
    } finally {
      queueDepth = Math.max(0, queueDepth - 1);
    }
  });

  return sendQueue;
}

export async function sendDoodleAlert(playerName, yearMonth, selectedAdded = [], selectedRemoved = []) {
  const { phone, apiKey } = await getWhatsAppConfig();
  const baseMeta = {
    playerName,
    yearMonth,
    addedCount: selectedAdded.length,
    removedCount: selectedRemoved.length,
  };
  if (!phone || !apiKey) {
    log('warn', 'Skipping alert: missing phone/apiKey in config.', baseMeta);
    return;
  }
  if (!selectedAdded.length && !selectedRemoved.length) {
    log('info', 'Skipping alert: no doodle changes detected.', baseMeta);
    return;
  }

  const added   = selectedAdded.length   ? selectedAdded.join(', ')   : 'none';
  const removed = selectedRemoved.length ? selectedRemoved.join(', ') : 'none';
  const text    = `🎾 Doodle update — ${playerName} (${yearMonth})\n✅ Added: ${added}\n❌ Removed: ${removed}`;

  const cleanPhone = phone.replace(/\s/g, '');
  const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(text)}&apikey=${apiKey}`;
  const meta = { ...baseMeta, kind: 'doodle' };
  return queueAlert(url, meta);
}

export async function sendWhatsAppTestAlert() {
  const { phone, apiKey } = await getWhatsAppConfig({ force: true });
  if (!phone || !apiKey) {
    log('warn', 'Skipping test alert: missing phone/apiKey in config.');
    throw new Error('Missing whatsapp_alerts.phone_number or whatsapp_alerts.api_key in config.json');
  }

  const currentUser = Store.getCurrentUser() || 'unknown';
  const timestamp = new Date().toISOString();
  const cleanPhone = phone.replace(/\s/g, '');
  const text = `📞 Mexicano test alert\nUser: ${currentUser}\nTime: ${timestamp}`;
  const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(text)}&apikey=${apiKey}`;
  return queueAlert(url, { kind: 'test', user: currentUser, timestamp });
}
