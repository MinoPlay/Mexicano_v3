/**
 * GitHub Contents API service.
 * Reads and writes app data as JSON files in a user-configured GitHub repository.
 *
 * Matches are stored in per-tournament-day files using the backup format:
 *   YYYY/YYYY-MM/YYYY-MM-DD.json  (PascalCase fields, metadata wrapper)
 *
 * Other data lives in the data/ folder:
 *   active_tournament  → data/active_tournament.json
 *   changelog          → data/changelog.json
 *   doodle_YYYY-MM     → data/doodle_YYYY-MM.json
 *
 * Members and theme are local-only and are never synced to GitHub.
 */

import { Store } from '../store.js';

const API_BASE = 'https://api.github.com';

// ─── Field converters (camelCase ↔ backup PascalCase) ────────────────────────

function toBackupMatch(m) {
  return {
    Date: m.date,
    RoundNumber: m.roundNumber,
    ScoreTeam1: m.scoreTeam1,
    ScoreTeam2: m.scoreTeam2,
    Team1Player1Name: m.team1Player1Name,
    Team1Player2Name: m.team1Player2Name,
    Team2Player1Name: m.team2Player1Name,
    Team2Player2Name: m.team2Player2Name,
  };
}

function fromBackupMatch(m) {
  return {
    date: m.Date,
    roundNumber: m.RoundNumber,
    scoreTeam1: m.ScoreTeam1,
    scoreTeam2: m.ScoreTeam2,
    team1Player1Name: m.Team1Player1Name,
    team1Player2Name: m.Team1Player2Name,
    team2Player1Name: m.Team2Player1Name,
    team2Player2Name: m.Team2Player2Name,
  };
}

/** Maps a date string ('YYYY-MM-DD') to its repo file path, under the configured base path. */
function datePath(date) {
  const year = date.slice(0, 4);
  const month = date.slice(0, 7);
  const base = getConfig()?.basePath?.trim().replace(/\/$/, '') || '';
  const prefix = base ? `${base}/` : '';
  return `${prefix}${year}/${month}/${date}.json`;
}

/** Returns the base path for tournament files, without a trailing slash. */
function matchesBase() {
  const base = getConfig()?.basePath?.trim().replace(/\/$/, '') || '';
  return base;
}

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
  // matches are written per-date; members/theme/user-prefs are local-only
  if (['github_config', 'theme', 'current_user', 'matches', 'members'].includes(key)) return null;
  // Pre-computed summary data — never synced back
  if (key === 'players_summary' || key === 'tournament_dates' || key === 'matches_fully_loaded') return null;
  if (key.startsWith('monthly_')) return null;
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
  const bytes = Uint8Array.from(atob(json.content.replace(/\n/g, '')), c => c.charCodeAt(0));
  const content = JSON.parse(new TextDecoder().decode(bytes));
  return { content, sha: json.sha };
}

/**
 * List the contents of a directory in the repo.
 * Returns an array of GitHub content objects, or [] if the path doesn't exist.
 */
async function listContents(path) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return [];

  const url = `${API_BASE}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
  const res = await fetch(url, { headers: authHeaders(cfg.pat) });

  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub list failed (${res.status}): ${path}`);

  return res.json();
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
 *
 * Matches are written as per-tournament-day files: YYYY/YYYY-MM/YYYY-MM-DD.json
 * (PascalCase fields, backup metadata wrapper).
 *
 * Other synced keys (doodle, changelog, active_tournament) are written to data/.
 *
 * @param {function} [onProgress] - called with (label, total, index) for each file written
 */
export async function pushAll(onProgress) {
  const data = Store.exportAll();

  // 1. Push non-matches data (doodle, changelog, active_tournament, …)
  const entries = Object.entries(data).filter(([k]) => keyToPath(k));
  let total = entries.length;
  let i = 0;
  for (const [key, value] of entries) {
    const path = keyToPath(key);
    let sha;
    try { const existing = await readFile(path); sha = existing?.sha; } catch { sha = undefined; }
    await writeFile(path, value, sha);
    onProgress?.(key, total, ++i);
  }

  // 2. Push matches as per-date files
  const matches = data.matches || [];
  const byDate = {};
  for (const m of matches) {
    if (!m.date) continue;
    if (!byDate[m.date]) byDate[m.date] = [];
    byDate[m.date].push(m);
  }

  const dateEntries = Object.entries(byDate);
  total = dateEntries.length;
  i = 0;
  for (const [date, dateMatches] of dateEntries) {
    const path = datePath(date);
    const backupData = {
      backup_timestamp: new Date().toISOString(),
      match_date: date,
      match_count: dateMatches.length,
      matches: dateMatches.map(toBackupMatch),
    };
    let sha;
    try { const existing = await readFile(path); sha = existing?.sha; } catch { sha = undefined; }
    await writeFile(path, backupData, sha);
    onProgress?.(date, dateEntries.length, ++i);
  }
}

/**
 * Pull summary data from GitHub into local Store.
 *
 * Reads pre-computed summary files (players.json, monthly overviews) and
 * discovers tournament dates from the directory structure — WITHOUT reading
 * every individual day file.
 *
 * Other data (doodle, changelog, active_tournament) is read from data/.
 *
 * @param {function} [onProgress] - called with (label, total, index)
 */
export async function pullAll(onProgress) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  _isPulling = true;
  try {
    const base = matchesBase();

    // ── 1. Read players.json ────────────────────────────────────────────────
    const playersPath = base ? `${base}/players.json` : 'players.json';
    try {
      const playersResult = await readFile(playersPath);
      if (playersResult?.content && Array.isArray(playersResult.content)) {
        const camelPlayers = playersResult.content.map(p => ({
          name: p.Name,
          elo: p.ELO,
        }));
        localStorage.setItem('mexicano_players_summary', JSON.stringify(camelPlayers));
      }
    } catch { /* players.json may not exist yet */ }
    onProgress?.('players.json', 0, 0);

    // ── 2. Walk directory tree: discover dates + collect month paths ────────
    const rootContents = await listContents(base);
    const yearDirs = rootContents.filter(f => f.type === 'dir' && /^\d{4}$/.test(f.name));

    const allDates = [];
    const monthDirs = [];

    for (const yearDir of yearDirs) {
      const monthContents = await listContents(yearDir.path);
      const months = monthContents.filter(f => f.type === 'dir' && /^\d{4}-\d{2}$/.test(f.name));
      for (const monthDir of months) {
        monthDirs.push(monthDir);
        const dayContents = await listContents(monthDir.path);
        const dayFiles = dayContents.filter(
          f => f.type === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name)
        );
        for (const df of dayFiles) {
          allDates.push(df.name.replace('.json', ''));
        }
      }
    }

    allDates.sort();
    localStorage.setItem('mexicano_tournament_dates', JSON.stringify(allDates));

    // ── 3. Read monthly overview files ──────────────────────────────────────
    const total = monthDirs.length;
    for (let i = 0; i < monthDirs.length; i++) {
      const monthDir = monthDirs[i];
      const overviewPath = `${monthDir.path}/players_overview.json`;
      try {
        const result = await readFile(overviewPath);
        if (result?.content && Array.isArray(result.content)) {
          const camelOverview = result.content.map(p => ({
            name: p.Name,
            totalPoints: p.Total_Points,
            wins: p.Wins,
            losses: p.Losses,
            average: p.Average,
            elo: p.ELO,
          }));
          localStorage.setItem(`mexicano_monthly_${monthDir.name}`, JSON.stringify(camelOverview));
        }
      } catch { /* overview may not exist for every month */ }
      onProgress?.(monthDir.name, total, i + 1);
    }

    // Clear the fully-loaded flag since we didn't load individual matches
    localStorage.removeItem('mexicano_matches_fully_loaded');

    // ── 4. Pull data/ files (doodle, changelog, active_tournament) ─────────
    const dataFiles = await listContents('data');
    const jsonFiles = dataFiles.filter(f => f.type === 'file' && f.name.endsWith('.json'));
    for (const file of jsonFiles) {
      const key = file.name.replace(/\.json$/, '');
      if (keyToPath(key) === null) continue;
      const result = await readFile(`data/${file.name}`);
      if (result !== null) {
        localStorage.setItem(`mexicano_${key}`, JSON.stringify(result.content));
      }
    }
  } finally {
    _isPulling = false;
  }
}

/**
 * Read matches for a single tournament day from GitHub.
 * @param {string} date - 'YYYY-MM-DD'
 * @returns {Promise<Array>} camelCase match objects
 */
export async function readDayMatches(date) {
  const path = datePath(date);
  const result = await readFile(path);
  if (!result?.content?.matches) return [];
  return result.content.matches.map(fromBackupMatch);
}

/**
 * Ensure matches for a specific date are in localStorage.
 * Returns the day's matches (from cache or freshly fetched).
 */
export async function ensureDayMatchesLoaded(date) {
  const cached = JSON.parse(localStorage.getItem('mexicano_matches') || '[]');
  const dayMatches = cached.filter(m => m.date === date);
  if (dayMatches.length > 0) return dayMatches;

  const fetched = await readDayMatches(date);
  if (fetched.length > 0) {
    const updated = [...cached, ...fetched];
    localStorage.setItem('mexicano_matches', JSON.stringify(updated));
  }
  return fetched;
}

/**
 * Load ALL individual match files from GitHub (for pages that need full history).
 * Stores them in localStorage and sets the fully-loaded flag.
 *
 * @param {function} [onProgress] - called with (label, total, index)
 * @returns {Promise<Array>} all matches
 */
export async function pullAllMatches(onProgress) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  const base = matchesBase();
  const rootContents = await listContents(base);
  const yearDirs = rootContents.filter(f => f.type === 'dir' && /^\d{4}$/.test(f.name));

  const dayFilePaths = [];
  for (const yearDir of yearDirs) {
    const monthContents = await listContents(yearDir.path);
    const months = monthContents.filter(f => f.type === 'dir' && /^\d{4}-\d{2}$/.test(f.name));
    for (const monthDir of months) {
      const dayContents = await listContents(monthDir.path);
      const dayFiles = dayContents.filter(
        f => f.type === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name)
      );
      dayFilePaths.push(...dayFiles.map(f => f.path));
    }
  }

  const allMatches = [];
  for (let idx = 0; idx < dayFilePaths.length; idx++) {
    const path = dayFilePaths[idx];
    const result = await readFile(path);
    if (result?.content?.matches) {
      for (const m of result.content.matches) {
        allMatches.push(fromBackupMatch(m));
      }
    }
    onProgress?.(path, dayFilePaths.length, idx + 1);
  }

  localStorage.setItem('mexicano_matches', JSON.stringify(allMatches));
  localStorage.setItem('mexicano_matches_fully_loaded', JSON.stringify(true));
  return allMatches;
}

/**
 * Ensure ALL matches are loaded into localStorage.
 * Returns immediately if already loaded; otherwise fetches from GitHub.
 *
 * @param {function} [onProgress] - called with (label, total, index)
 * @returns {Promise<Array>} all matches
 */
export async function ensureAllMatchesLoaded(onProgress) {
  if (JSON.parse(localStorage.getItem('mexicano_matches_fully_loaded') || 'false')) {
    return JSON.parse(localStorage.getItem('mexicano_matches') || '[]');
  }
  return pullAllMatches(onProgress);
}

// ─── Auto-sync (debounced) ───────────────────────────────────────────────────

let _syncTimer = null;
let _syncStatus = 'idle'; // idle | syncing | success | error
let _isPulling = false;   // suppresses auto-push during pullAll
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
 * Handles both regular data keys and the special 'matches' key.
 */
export function schedulePush(key) {
  if (_isPulling) return;
  if (!getConfig()?.pat) return;
  // Allow matches through even though keyToPath returns null for it
  if (keyToPath(key) === null && key !== 'matches') return;

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
