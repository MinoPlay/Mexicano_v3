/**
 * GitHub Contents API service.
 * Reads and writes app data as JSON files in a user-configured GitHub repository.
 *
 * Each data type is stored as a separate file under the `data/` folder:
 *   members            → data/members.json
 *   matches            → data/matches.json
 *   active_tournament  → data/active_tournament.json
 *   changelog          → data/changelog.json
 *   doodle_YYYY-MM     → data/doodle_YYYY-MM.json
 */

import { Store } from '../store.js';

const API_BASE = 'https://api.github.com';

/** Returns the configured GitHub credentials or null if not set. */
function getConfig() {
  return Store.getGitHubConfig();
}

function authHeaders(pat) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/** Map a Store key to a GitHub file path (returns null if the key should not be synced). */
export function keyToPath(key) {
  if (!key) return null;
  // Skip config/theme/user-preference keys
  if (['github_config', 'theme', 'current_user'].includes(key)) return null;
  return `data/${key}.json`;
}

/**
 * Fetch a single file from the repo.
 * Returns the parsed JSON content and the file's current SHA (needed for updates), or null if not found.
 */
export async function readFile(path) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return null;

  const url = `${API_BASE}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
  const res = await fetch(url, { headers: authHeaders(cfg.pat) });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${path}`);

  const json = await res.json();
  const content = JSON.parse(atob(json.content.replace(/\n/g, '')));
  return { content, sha: json.sha };
}

/**
 * Write (create or update) a single file in the repo.
 * @param {string} path  - repo-relative file path, e.g. "data/members.json"
 * @param {*}      data  - value to serialise as JSON
 * @param {string} [sha] - current file SHA (required when updating an existing file)
 */
export async function writeFile(path, data, sha) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  const url = `${API_BASE}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
  const body = {
    message: `mexicano: update ${path}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
    ...(sha ? { sha } : {}),
  };

  const res = await fetch(url, {
    method: 'PUT',
    headers: authHeaders(cfg.pat),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub write failed (${res.status}): ${err.message || path}`);
  }
  return res.json();
}

/**
 * Test the connection by fetching the repo metadata.
 * Returns { ok: true } on success or { ok: false, message } on failure.
 */
export async function testConnection() {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) {
    return { ok: false, message: 'Missing owner, repo, or PAT' };
  }

  try {
    const url = `${API_BASE}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
    const res = await fetch(url, { headers: authHeaders(cfg.pat) });
    if (res.status === 401) return { ok: false, message: 'Invalid PAT (401 Unauthorized)' };
    if (res.status === 403) return { ok: false, message: 'Forbidden — check PAT scopes' };
    if (res.status === 404) return { ok: false, message: 'Repository not found' };
    if (!res.ok) return { ok: false, message: `Unexpected error (${res.status})` };
    const repo = await res.json();
    return { ok: true, message: `Connected to ${repo.full_name}` };
  } catch (e) {
    return { ok: false, message: e.message || 'Network error' };
  }
}

/**
 * Push all local Store data to GitHub.
 * For each synced key, reads the current SHA then writes the local value.
 * @param {function} [onProgress] - called with (key, total, index) for each file written
 */
export async function pushAll(onProgress) {
  const data = Store.exportAll();
  const entries = Object.entries(data).filter(([k]) => keyToPath(k));
  let i = 0;
  for (const [key, value] of entries) {
    const path = keyToPath(key);
    // Get current SHA (if file already exists)
    let sha;
    try {
      const existing = await readFile(path);
      sha = existing?.sha;
    } catch {
      sha = undefined;
    }
    await writeFile(path, value, sha);
    onProgress?.(key, entries.length, ++i);
  }
}

/**
 * Pull all data from GitHub into local Store.
 * Only overwrites keys that exist in the repo.
 * @param {function} [onProgress] - called with (key, total, index)
 */
export async function pullAll(onProgress) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  // List files in data/ folder
  const url = `${API_BASE}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/data`;
  const res = await fetch(url, { headers: authHeaders(cfg.pat) });
  if (res.status === 404) return; // No data folder yet
  if (!res.ok) throw new Error(`GitHub list failed (${res.status})`);

  const files = await res.json();
  const jsonFiles = files.filter(f => f.name.endsWith('.json'));
  let i = 0;
  for (const file of jsonFiles) {
    const key = file.name.replace(/\.json$/, '');
    if (keyToPath(key) === null) continue; // skip config keys
    const result = await readFile(`data/${file.name}`);
    if (result !== null) {
      Store.set(key, result.content);
    }
    onProgress?.(key, jsonFiles.length, ++i);
  }
}

// ─── Auto-sync (debounced) ───────────────────────────────────────────────────

let _syncTimer = null;
let _syncStatus = 'idle'; // idle | syncing | success | error
const _listeners = new Set();

export function onSyncStatus(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function setSyncStatus(s) {
  _syncStatus = s;
  _listeners.forEach(fn => fn(s));
}

export function getSyncStatus() {
  return _syncStatus;
}

/**
 * Schedule a debounced auto-push.
 * Called by Store.set() when GitHub is configured.
 */
export function schedulePush(key) {
  if (!getConfig()?.pat) return;
  if (keyToPath(key) === null) return;

  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(async () => {
    setSyncStatus('syncing');
    try {
      await pushAll();
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 3000);
    } catch (e) {
      console.error('GitHub auto-sync failed:', e);
      setSyncStatus('error');
    }
  }, 1500);
}
