/**
 * GitHub Contents API service.
 * Reads and writes app data as JSON files in a user-configured GitHub repository.
 *
 * Matches are stored in per-tournament-day files using the backup format:
 *   <basePath>/YYYY/YYYY-MM/YYYY-MM-DD.json  (PascalCase fields, metadata wrapper)
 *
 * Other data lives in the data/ folder under the base path:
 *   active_tournament  → <basePath>/data/active_tournament.json
 *   doodle_YYYY-MM     → <basePath>/YYYY/YYYY-MM/doodle_YYYY-MM.json
 *
 * Members, theme, and changelog are local-only and are never synced to GitHub.
 */

import { Store } from '../store.js';

const API_BASE = 'https://api.github.com';

// ─── Logging ─────────────────────────────────────────────────────────────────

const GH_LOG_KEY = 'mexicano_github_log';
const GH_LOG_MAX = 200;

function ghLog(action, path, detail) {
  const entry = {
    ts: new Date().toISOString(),
    action,
    path,
    ...(detail ? { detail } : {}),
  };
  console.log(`[GitHub ${action}] ${path}`, detail || '');
  try {
    const log = JSON.parse(localStorage.getItem(GH_LOG_KEY) || '[]');
    log.unshift(entry);
    localStorage.setItem(GH_LOG_KEY, JSON.stringify(log.slice(0, GH_LOG_MAX)));
  } catch { /* storage full or unavailable */ }
}

/** Return the stored GitHub operation log (most recent first). */
export function getGitHubLog() {
  try { return JSON.parse(localStorage.getItem(GH_LOG_KEY) || '[]'); } catch { return []; }
}

// ─── Path guard ──────────────────────────────────────────────────────────────

/**
 * Normalise a repo-relative path and ensure it stays within the configured
 * basePath.  Throws if the resolved path escapes the base folder (e.g. via
 * ".." segments) or if basePath is not configured.
 * Normalizes all paths to forward slashes for compatibility (Windows + Mac/iOS).
 */
function guardPath(rawPath) {
  let base = getConfig()?.basePath?.trim().replace(/\/$/, '') || '';
  if (!base) throw new Error('basePath is not configured — cannot access GitHub repo');

  // Normalize all backslashes to forward slashes (cross-platform)
  base = base.replace(/\\/g, '/');
  const normalizedPath = rawPath.replace(/\\/g, '/');

  // Normalise: collapse slashes, resolve ".." / "."
  const segments = normalizedPath.split('/').filter(Boolean);
  const resolved = [];
  for (const seg of segments) {
    if (seg === '.') continue;
    if (seg === '..') {
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }
  const normalised = resolved.join('/');

  if (!normalised.startsWith(base + '/') && normalised !== base) {
    throw new Error(`Path "${rawPath}" resolves outside the allowed base "${base}"`);
  }
  return normalised;
}

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

/** Map a Store key to a GitHub file path (returns null if the key should not be synced).
 *  Uses an allowlist — only keys this app explicitly owns are synced. */
export function keyToPath(key) {
  if (!key) return null;

  const base = getConfig()?.basePath?.trim().replace(/\/$/, '') || '';
  const prefix = base ? `${base}/` : '';

  // Doodle files live next to that month's tournament data: YYYY/YYYY-MM/doodle_YYYY-MM.json
  const doodleMatch = key.match(/^doodle_(\d{4})-(\d{2})$/);
  if (doodleMatch) {
    const year = doodleMatch[1];
    const yearMonth = `${year}-${doodleMatch[2]}`;
    return `${prefix}${year}/${yearMonth}/${key}.json`;
  }

  // Only these data-folder keys are synced (changelog is local-only UI state)
  const SYNCED_DATA_KEYS = ['active_tournament'];
  if (SYNCED_DATA_KEYS.includes(key)) {
    return `${prefix}data/${key}.json`;
  }

  return null;
}

/**
 * Fetch a single file from the repo.
 * Returns the parsed JSON content and the file's current SHA (needed for updates), or null if not found.
 */
export async function readFile(path) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return null;

  const safePath = guardPath(path);
  ghLog('READ', safePath);

  const url = `${API_BASE}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${safePath}`;
  const res = await fetch(url, { headers: authHeaders(cfg.pat) });

  if (res.status === 404) { ghLog('READ_404', safePath); return null; }
  if (!res.ok) throw new Error(`GitHub read failed (${res.status}): ${safePath}`);

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

  const safePath = guardPath(path);
  ghLog('LIST', safePath);

  const url = `${API_BASE}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${safePath}`;
  const res = await fetch(url, { headers: authHeaders(cfg.pat) });

  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub list failed (${res.status}): ${safePath}`);

  return res.json();
}

/**
 * Delete a file from the repo.
 * @param {string} path - repo-relative file path
 * @param {string} sha  - current file SHA (required)
 */
export async function deleteFile(path, sha) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  const safePath = guardPath(path);
  ghLog('DELETE', safePath);

  const url = `${API_BASE}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${safePath}`;
  const body = {
    message: `mexicano: delete ${safePath}`,
    sha,
  };
  const res = await fetch(url, {
    method: 'DELETE',
    headers: authHeaders(cfg.pat),
    body: JSON.stringify(body),
  });

  if (!res.ok && res.status !== 404) {
    const err = await res.json().catch(() => ({}));
    ghLog('DELETE_FAIL', safePath, err.message);
    throw new Error(`GitHub delete failed (${res.status}): ${err.message || safePath}`);
  }
  ghLog('DELETE_OK', safePath);
}

/**
 * Write (create or update) a single file in the repo.
 * Automatically retries once on 409 Conflict by re-reading the current SHA.
 * @param {string} path  - repo-relative file path, e.g. "data/members.json"
 * @param {*}      data  - value to serialise as JSON
 * @param {string} [sha] - current file SHA (required when updating an existing file)
 */
export async function writeFile(path, data, sha) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  const safePath = guardPath(path);
  ghLog('WRITE', safePath, sha ? 'update' : 'create');

  const url = `${API_BASE}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${safePath}`;

  async function attempt(currentSha) {
    const body = {
      message: `mexicano: update ${safePath}`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
      ...(currentSha ? { sha: currentSha } : {}),
    };
    return fetch(url, {
      method: 'PUT',
      headers: authHeaders(cfg.pat),
      body: JSON.stringify(body),
    });
  }

  let res = await attempt(sha);

  // Retry once on 409 Conflict — re-read the current SHA and try again
  if (res.status === 409) {
    ghLog('WRITE_CONFLICT', safePath, 'retrying');
    const fresh = await readFile(path);
    res = await attempt(fresh?.sha);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    ghLog('WRITE_FAIL', safePath, err.message);
    throw new Error(`GitHub write failed (${res.status}): ${err.message || safePath}`);
  }
  ghLog('WRITE_OK', safePath);
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
 * Other synced keys (doodle, active_tournament) are written to data/.
 *
 * @param {function} [onProgress] - called with (label, total, index) for each file written
 * @param {object}   [opts]
 * @param {boolean}  [opts.allMatchDates=false] - when true, push every match date (manual sync);
 *                   when false (auto-sync), only push dates marked dirty via markMatchDateDirty().
 */
export async function pushAll(onProgress, { allMatchDates = false } = {}) {
  const data = Store.exportAll();

  // 1. Push non-matches data (doodle, active_tournament, …)
  const entries = Object.entries(data).filter(([k]) => keyToPath(k));
  ghLog('PUSH_START', '-', `${entries.length} data keys, allMatchDates=${allMatchDates}`);

  let total = entries.length;
  let i = 0;
  for (const [key, value] of entries) {
    const path = keyToPath(key);
    let sha;
    try { const existing = await readFile(path); sha = existing?.sha; } catch { sha = undefined; }
    await writeFile(path, value, sha);
    onProgress?.(key, total, ++i);
  }

  // 2. Push matches as per-date files (only dirty dates unless allMatchDates)
  const matches = data.matches || [];
  const byDate = {};
  for (const m of matches) {
    if (!m.date) continue;
    if (!allMatchDates && !_dirtyMatchDates.has(m.date)) continue;
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

  ghLog('PUSH_DONE', '-', `${entries.length} data + ${dateEntries.length} match files`);
  _dirtyMatchDates.clear();
}

// ─── tournaments.json index ───────────────────────────────────────────────────

/** Returns the path to tournaments.json (next to players.json). */
function tournamentsIndexPath() {
  const base = matchesBase();
  return base ? `${base}/tournaments.json` : 'tournaments.json';
}

/**
 * Fetch (and optionally create) the tournaments.json index file.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.create=false] - When true and file is missing, traverse
 *   the repo, read every day's match JSON, compute metadata, write tournaments.json.
 * @returns {Promise<Array|null>} Array of tournament entries, or null when not found
 *   and opts.create is false.
 */
async function fetchTournamentsIndex({ create = false } = {}) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return null;

  const path = tournamentsIndexPath();
  const base = matchesBase();

  ghLog('READ_TOURNAMENTS_INDEX', path);
  const result = await readFile(path);

  if (result !== null) {
    const entries = Array.isArray(result.content) ? result.content : [];
    Store.setTournamentsIndex(entries);
    const dates = entries.map(e => e.date).sort();
    localStorage.setItem('mexicano_tournament_dates', JSON.stringify(dates));
    ghLog('TOURNAMENTS_INDEX_LOADED', path, `${entries.length} entries`);
    return entries;
  }

  if (!create) return null;

  // ── Bootstrap: traverse repo, read each day file, build index ─────────────
  ghLog('TOURNAMENTS_INDEX_MISSING', path, 'traversing repo to create it');

  const rootContents = await listContents(base);
  const yearDirs = rootContents.filter(f => f.type === 'dir' && /^\d{4}$/.test(f.name));

  const dayFilePaths = [];
  for (const yearDir of yearDirs) {
    const monthContents = await listContents(yearDir.path);
    const months = monthContents.filter(f => f.type === 'dir' && /^\d{4}-\d{2}$/.test(f.name));
    for (const monthDir of months) {
      const dayContents = await listContents(monthDir.path);
      dayContents
        .filter(f => f.type === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name))
        .forEach(f => dayFilePaths.push(f.path));
    }
  }

  const entries = [];
  for (const filePath of dayFilePaths) {
    const dateStr = filePath.split('/').pop().replace('.json', '');
    try {
      const dayResult = await readFile(filePath);
      if (dayResult?.content?.matches && Array.isArray(dayResult.content.matches)) {
        const matches = dayResult.content.matches;
        const players = new Set();
        const rounds = new Set();
        let completed = 0;
        for (const m of matches) {
          if (m.Team1Player1Name) players.add(m.Team1Player1Name);
          if (m.Team1Player2Name) players.add(m.Team1Player2Name);
          if (m.Team2Player1Name) players.add(m.Team2Player1Name);
          if (m.Team2Player2Name) players.add(m.Team2Player2Name);
          if (m.RoundNumber != null) rounds.add(m.RoundNumber);
          if ((m.ScoreTeam1 ?? 0) + (m.ScoreTeam2 ?? 0) === 25) completed++;
        }
        entries.push({
          date: dateStr,
          playerCount: players.size,
          roundCount: rounds.size,
          matchCount: matches.length,
          completedCount: completed,
          isComplete: matches.length > 0 && completed === matches.length,
        });
      } else {
        entries.push({ date: dateStr, playerCount: 0, roundCount: 0, matchCount: 0, completedCount: 0, isComplete: false });
      }
    } catch {
      entries.push({ date: dateStr, playerCount: 0, roundCount: 0, matchCount: 0, completedCount: 0, isComplete: false });
    }
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));

  try {
    await writeFile(path, entries, null);
    ghLog('TOURNAMENTS_INDEX_CREATED', path, `${entries.length} entries`);
  } catch (e) {
    console.warn('[github] failed to write tournaments.json:', e);
  }

  Store.setTournamentsIndex(entries);
  const dates = entries.map(e => e.date).sort();
  localStorage.setItem('mexicano_tournament_dates', JSON.stringify(dates));
  return entries;
}

/**
 * Upsert a single tournament entry in tournaments.json.
 * Reads the current file (to get SHA), merges the entry, writes back.
 * No-op if GitHub is not configured.
 *
 * @param {object} entry - { date, playerCount, roundCount, matchCount, completedCount, isComplete }
 */
export async function updateTournamentIndexEntry(entry) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return;
  if (!entry?.date) return;

  const path = tournamentsIndexPath();
  ghLog('UPDATE_TOURNAMENT_ENTRY', path, entry.date);

  let entries = [];
  let sha = null;
  try {
    const result = await readFile(path);
    if (result !== null) {
      entries = Array.isArray(result.content) ? [...result.content] : [];
      sha = result.sha;
    }
  } catch { /* file may not exist yet */ }

  const idx = entries.findIndex(e => e.date === entry.date);
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...entry };
  } else {
    entries.push(entry);
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));

  try {
    await writeFile(path, entries, sha);
  } catch (e) {
    console.warn('[github] failed to update tournaments.json:', e);
    return;
  }

  Store.setTournamentsIndex(entries);
  const dates = entries.map(e => e.date).sort();
  localStorage.setItem('mexicano_tournament_dates', JSON.stringify(dates));
}

/**
 * Public wrapper for fetchTournamentsIndex with create:true.
 * Used by the Tournaments page for lazy-loading when index is empty.
 */
export async function fetchTournamentsIndexPublic() {
  return fetchTournamentsIndex({ create: true });
}

 *
 * Reads pre-computed summary files (players.json, monthly overviews) and
 * discovers tournament dates via tournaments.json (creating it if missing).
 *
 * Doodle files are read from YYYY/YYYY-MM/doodle_YYYY-MM.json alongside
 * tournament data. Other data (changelog, active_tournament) is read from data/.
 *
 * @param {function} [onProgress] - called with (label, total, index)
 */
export async function pullAll(onProgress) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  ghLog('PULL_START', '-');
  _isPulling = true;

  // Keys to preserve across pull (config, audit log, user preferences, dev flags)
  const PRESERVE = new Set([
    GH_LOG_KEY,
    'mexicano_github_config',
    'mexicano_theme',
    'mexicano_current_user',
    'mexicano_local_data_loaded', // dev-server flag — must survive pull or loadLocalData loops
  ]);

  // Snapshot all app data for failure recovery, then clear it so pull starts clean
  const snapshot = {};
  const toClear = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('mexicano_') && !PRESERVE.has(k)) {
      snapshot[k] = localStorage.getItem(k);
      toClear.push(k);
    }
  }
  toClear.forEach(k => localStorage.removeItem(k));

  let pullSucceeded = false;
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
          previousElo: p.PreviousELO ?? p.ELO,
        }));
        localStorage.setItem('mexicano_players_summary', JSON.stringify(camelPlayers));
        // Update members list from the authoritative players.json
        const playerNames = camelPlayers.map(p => p.name).sort();
        localStorage.setItem('mexicano_members', JSON.stringify(playerNames));
      }
    } catch { /* players.json may not exist yet */ }
    onProgress?.('players.json', 0, 0);

    // ── 2. tournaments.json → tournament dates ──────────────────────────────
    await fetchTournamentsIndex({ create: true });
    onProgress?.('tournaments.json', 0, 0);

    // ── 3. Read monthly overview + doodle files (derived from index dates) ──
    const allDates = JSON.parse(localStorage.getItem('mexicano_tournament_dates') || '[]');
    const uniqueMonths = [...new Set(allDates.map(d => d.slice(0, 7)))].sort();
    const total = uniqueMonths.length;
    for (let i = 0; i < uniqueMonths.length; i++) {
      const ym = uniqueMonths[i];
      const year = ym.slice(0, 4);
      const monthPath = base ? `${base}/${year}/${ym}` : `${year}/${ym}`;

      try {
        const result = await readFile(`${monthPath}/players_overview.json`);
        if (result?.content && Array.isArray(result.content)) {
          const camelOverview = result.content.map(p => ({
            name: p.Name,
            totalPoints: p.Total_Points,
            wins: p.Wins,
            losses: p.Losses,
            average: p.Average,
            elo: p.ELO,
          }));
          localStorage.setItem(`mexicano_monthly_${ym}`, JSON.stringify(camelOverview));
        }
      } catch { /* overview may not exist */ }

      try {
        const doodleResult = await readFile(`${monthPath}/doodle_${ym}.json`);
        if (doodleResult?.content) {
          localStorage.setItem(`mexicano_doodle_${ym}`, JSON.stringify(doodleResult.content));
        }
      } catch { /* doodle may not exist */ }

      onProgress?.(ym, total, i + 1);
    }

    // ── 4. Pull data/ files (changelog, active_tournament, …) ──────────────
    const dataPath = base ? `${base}/data` : 'data';
    const dataFiles = await listContents(dataPath);
    const jsonFiles = dataFiles.filter(f => f.type === 'file' && f.name.endsWith('.json'));
    for (const file of jsonFiles) {
      const key = file.name.replace(/\.json$/, '');
      if (keyToPath(key) === null) continue;
      // Doodle files are pulled from month directories (step 3)
      if (key.startsWith('doodle_')) continue;
      const result = await readFile(`${dataPath}/${file.name}`);
      if (result !== null) {
        localStorage.setItem(`mexicano_${key}`, JSON.stringify(result.content));
      }
    }

    pullSucceeded = true;
  } finally {
    _isPulling = false;
    ghLog('PULL_DONE', '-');
    if (!pullSucceeded) {
      // Restore snapshot so data is intact after a network/API failure
      toClear.forEach(k => localStorage.removeItem(k));
      Object.entries(snapshot).forEach(([k, v]) => localStorage.setItem(k, v));
    }
  }

  return { updated: true };
}

// ─── Session TTL helpers ──────────────────────────────────────────────────────

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

function markFetched(key) {
  try { sessionStorage.setItem(`mexicano_gh_ts_${key}`, Date.now().toString()); } catch { /* storage unavailable */ }
}

function isFreshInSession(key) {
  try {
    const ts = parseInt(sessionStorage.getItem(`mexicano_gh_ts_${key}`) || '0', 10);
    return Date.now() - ts < SESSION_TTL_MS;
  } catch { return false; }
}

/** Parse a raw players_overview.json entry (PascalCase) to camelCase. */
function fromOverview(p) {
  return {
    name: p.Name,
    totalPoints: p.Total_Points,
    wins: p.Wins,
    losses: p.Losses,
    average: p.Average,
    elo: p.ELO,
  };
}

/**
 * Internal: fetch a single YYYY/YYYY-MM/players_overview.json and store it.
 * Silently no-ops if the file doesn't exist.
 */
async function _fetchOverview(base, yearMonth) {
  const year = yearMonth.slice(0, 4);
  const prefix = base ? `${base}/` : '';
  const path = `${prefix}${year}/${yearMonth}/players_overview.json`;
  try {
    const result = await readFile(path);
    if (result?.content && Array.isArray(result.content)) {
      localStorage.setItem(`mexicano_monthly_${yearMonth}`, JSON.stringify(result.content.map(fromOverview)));
    }
  } catch { /* overview may not exist for this month */ }
}

/**
 * Pull only the core data needed for every route:
 * players.json, tournament_dates (via tournaments.json), active_tournament,
 * and the current + previous month's players_overview.json.
 *
 * Does NOT clear localStorage. No-op if already fresh in this session.
 * @returns {Promise<boolean>} true if any data was fetched
 */
async function pullCoreData() {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return false;
  if (isFreshInSession('core')) return false;

  ghLog('PULL_CORE', '-', 'start');
  const base = matchesBase();

  // ── 1. players.json ────────────────────────────────────────────────────────
  const playersPath = base ? `${base}/players.json` : 'players.json';
  try {
    const result = await readFile(playersPath);
    if (result?.content && Array.isArray(result.content)) {
      const camelPlayers = result.content.map(p => ({
        name: p.Name,
        elo: p.ELO,
        previousElo: p.PreviousELO ?? p.ELO,
      }));
      localStorage.setItem('mexicano_players_summary', JSON.stringify(camelPlayers));
      localStorage.setItem('mexicano_members', JSON.stringify(camelPlayers.map(p => p.name).sort()));
    }
  } catch { /* players.json may not exist yet */ }

  // ── 2. tournaments.json → tournament_dates (no dir-walk, no create) ────────
  await fetchTournamentsIndex({ create: false });

  // ── 3. active_tournament ───────────────────────────────────────────────────
  const dataPath = base ? `${base}/data` : 'data';
  try {
    const atResult = await readFile(`${dataPath}/active_tournament.json`);
    if (atResult !== null) {
      localStorage.setItem('mexicano_active_tournament', JSON.stringify(atResult.content));
    } else {
      localStorage.removeItem('mexicano_active_tournament');
    }
  } catch { /* data/ may not exist yet */ }

  // ── 4. Current + previous month overviews ─────────────────────────────────
  const now = new Date();
  for (const offset of [0, -1]) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    await _fetchOverview(base, ym);
    markFetched(`overview_${ym}`);
  }

  markFetched('core');
  ghLog('PULL_CORE', '-', 'done');
  return true;
}

/**
 * Pull data for the Tournaments list page.
 * Fetches tournaments.json, creating it from a repo traverse if missing.
 * No-op if already fresh in this session.
 * @returns {Promise<boolean>} true if any data was fetched
 */
async function pullTournamentsPage() {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return false;
  if (isFreshInSession('tournaments_page')) return false;

  ghLog('PULL_TOURNAMENTS_PAGE', '-', 'start');
  const base = matchesBase();

  // ── 1. players.json ────────────────────────────────────────────────────────
  const playersPath = base ? `${base}/players.json` : 'players.json';
  try {
    const result = await readFile(playersPath);
    if (result?.content && Array.isArray(result.content)) {
      const camelPlayers = result.content.map(p => ({
        name: p.Name,
        elo: p.ELO,
        previousElo: p.PreviousELO ?? p.ELO,
      }));
      localStorage.setItem('mexicano_players_summary', JSON.stringify(camelPlayers));
      localStorage.setItem('mexicano_members', JSON.stringify(camelPlayers.map(p => p.name).sort()));
    }
  } catch { /* players.json may not exist yet */ }

  // ── 2. tournaments.json — create if missing ────────────────────────────────
  await fetchTournamentsIndex({ create: true });

  // ── 3. active_tournament ───────────────────────────────────────────────────
  const dataPath = base ? `${base}/data` : 'data';
  try {
    const atResult = await readFile(`${dataPath}/active_tournament.json`);
    if (atResult !== null) {
      localStorage.setItem('mexicano_active_tournament', JSON.stringify(atResult.content));
    } else {
      localStorage.removeItem('mexicano_active_tournament');
    }
  } catch { /* data/ may not exist yet */ }

  markFetched('tournaments_page');
  ghLog('PULL_TOURNAMENTS_PAGE', '-', 'done');
  return true;
}

/**
 * Pull only players.json for the settings page.
 * Lightweight fetch that skips expensive directory walk and tournament data.
 * No-op if already fresh in this session.
 */
async function pullSettingsData() {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return false;
  if (isFreshInSession('settings')) return false;

  ghLog('PULL_SETTINGS', '-', 'start');
  const base = matchesBase();

  // Fetch only players.json
  const playersPath = base ? `${base}/players.json` : 'players.json';
  try {
    const result = await readFile(playersPath);
    if (result?.content && Array.isArray(result.content)) {
      const camelPlayers = result.content.map(p => ({
        name: p.Name,
        elo: p.ELO,
        previousElo: p.PreviousELO ?? p.ELO,
      }));
      localStorage.setItem('mexicano_players_summary', JSON.stringify(camelPlayers));
      localStorage.setItem('mexicano_members', JSON.stringify(camelPlayers.map(p => p.name).sort()));
    }
  } catch { /* players.json may not exist yet */ }

  markFetched('settings');
  ghLog('PULL_SETTINGS', '-', 'done');
  return true;
}

/**
 * Pull a single month's players_overview.json from GitHub and store it.
 * No-op if already fresh in this session.
 * @param {string} yearMonth - 'YYYY-MM'
 * @returns {Promise<{ updated: boolean }>}
 */
export async function pullMonthlyOverview(yearMonth) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return { updated: false };
  if (isFreshInSession(`overview_${yearMonth}`)) return { updated: false };

  const base = matchesBase();
  const hadData = !!localStorage.getItem(`mexicano_monthly_${yearMonth}`);
  await _fetchOverview(base, yearMonth);
  markFetched(`overview_${yearMonth}`);
  const hasData = !!localStorage.getItem(`mexicano_monthly_${yearMonth}`);
  return { updated: !hadData && hasData };
}

/**
 * Pull all monthly overviews from GitHub (one per unique YYYY-MM in tournament_dates).
 * Skips months already fresh in this session.
 * @returns {Promise<{ updated: boolean }>}
 */
export async function pullAllOverviews() {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return { updated: false };

  const dates = JSON.parse(localStorage.getItem('mexicano_tournament_dates') || '[]');
  const months = [...new Set(dates.map(d => d.slice(0, 7)))].sort();
  const base = matchesBase();
  let updated = false;

  for (const ym of months) {
    if (isFreshInSession(`overview_${ym}`)) continue;
    const hadData = !!localStorage.getItem(`mexicano_monthly_${ym}`);
    await _fetchOverview(base, ym);
    markFetched(`overview_${ym}`);
    if (!hadData && localStorage.getItem(`mexicano_monthly_${ym}`)) updated = true;
  }
  return { updated };
}

/**
 * Pull a single doodle month from GitHub.
 * No-op if already fresh in this session.
 * Returns the raw content array and whether it differed from the cached version.
 * The caller is responsible for updating Store and emitting state events.
 * @param {string} yearMonth - 'YYYY-MM'
 * @returns {Promise<{ content: Array|null, updated: boolean }>}
 */
export async function pullDoodleMonth(yearMonth) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return { content: null, updated: false };
  if (isFreshInSession(`doodle_${yearMonth}`)) return { content: null, updated: false };

  const base = matchesBase();
  const year = yearMonth.slice(0, 4);
  const prefix = base ? `${base}/` : '';
  const path = `${prefix}${year}/${yearMonth}/doodle_${yearMonth}.json`;
  try {
    const result = await readFile(path);
    markFetched(`doodle_${yearMonth}`);
    if (!result?.content) return { content: null, updated: false };
    const existing = localStorage.getItem(`mexicano_doodle_${yearMonth}`);
    const newJson = JSON.stringify(result.content);
    return { content: result.content, updated: existing !== newJson };
  } catch {
    markFetched(`doodle_${yearMonth}`);
    return { content: null, updated: false };
  }
}

/**
 * Pull only what the home page needs from GitHub.
 * Fetches players.json, active_tournament.json, tournaments.json (no create),
 * and the latest date's match file.
 *
 * No-op if already fresh in this session.
 * @returns {Promise<boolean>} true if any data was fetched
 */
async function pullHomeData() {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return false;
  if (isFreshInSession('home')) return false;

  ghLog('PULL_HOME', '-', 'start');
  const base = matchesBase();

  // ── 1. players.json ──────────────────────────────────────────────────────────
  const playersPath = base ? `${base}/players.json` : 'players.json';
  try {
    const result = await readFile(playersPath);
    if (result?.content && Array.isArray(result.content)) {
      const camelPlayers = result.content.map(p => ({
        name: p.Name,
        elo: p.ELO,
        previousElo: p.PreviousELO ?? p.ELO,
      }));
      localStorage.setItem('mexicano_players_summary', JSON.stringify(camelPlayers));
      localStorage.setItem('mexicano_members', JSON.stringify(camelPlayers.map(p => p.name).sort()));
    }
  } catch { /* players.json may not exist yet */ }

  // ── 2. active_tournament.json ────────────────────────────────────────────────
  const dataPath = base ? `${base}/data` : 'data';
  try {
    const atResult = await readFile(`${dataPath}/active_tournament.json`);
    if (atResult !== null) {
      localStorage.setItem('mexicano_active_tournament', JSON.stringify(atResult.content));
    } else {
      localStorage.removeItem('mexicano_active_tournament');
    }
  } catch { /* data/ may not exist yet */ }

  // ── 3. Tournament dates — read tournaments.json (no create, no dir-walk) ─────
  await fetchTournamentsIndex({ create: false });

  // ── 4. Latest date's matches — only if not already in localStorage ───────────
  const allDates = JSON.parse(localStorage.getItem('mexicano_tournament_dates') || '[]');
  if (allDates.length > 0) {
    const latestDate = allDates[allDates.length - 1];
    const cached = JSON.parse(localStorage.getItem('mexicano_matches') || '[]');
    const hasLatest = cached.some(m => m.date === latestDate);
    if (!hasLatest) {
      try {
        const fetched = await readDayMatches(latestDate);
        if (fetched.length > 0) {
          const updated = [...cached, ...fetched];
          localStorage.setItem('mexicano_matches', JSON.stringify(updated));
        }
      } catch { /* match file may not exist */ }
    }
  }

  markFetched('home');
  ghLog('PULL_HOME', '-', 'done');
  return true;
}

/**
 * Pull only what the current route needs from GitHub.
 * Replaces pullAll() for the auto-pull on page load.
 *
 * For /: fetches players, active_tournament, tournaments.json (no create), latest matches.
 * For /tournaments: fetches players, active_tournament, tournaments.json (creates if missing).
 * For /settings: fetches only players.json (lightweight).
 * For /doodle: fetches core data + current and next month's doodle file.
 * For all other routes: fetches core data (players, dates, active_tournament, recent overviews).
 *
 * @param {string} hash - window.location.hash (e.g. '#/doodle')
 * @returns {Promise<{ updated: boolean }>}
 */
export async function pullForRoute(hash) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  _isPulling = true;
  try {
    const path = (hash || '').replace(/^#/, '').split('?')[0] || '/';

    // Home page: lightweight fetch — no dir walk, no create
    if (path === '/') {
      const updated = await pullHomeData();
      return { updated };
    }

    // Tournaments list page: fetch or create tournaments.json
    if (path === '/tournaments') {
      const updated = await pullTournamentsPage();
      return { updated };
    }

    // Settings page: only fetch players.json
    if (path === '/settings') {
      const updated = await pullSettingsData();
      return { updated };
    }

    let updated = await pullCoreData();

    if (path === '/doodle') {
      const now = new Date();
      for (const offset of [0, 1]) {
        const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const { updated: du } = await pullDoodleMonth(ym);
        if (du) updated = true;
      }
    }

    return { updated };
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
 * Uses tournaments.json index (or tournament_dates) to get file paths — no dir-walk.
 * Stores them in localStorage and sets the fully-loaded flag.
 *
 * @param {function} [onProgress] - called with (label, total, index)
 * @returns {Promise<Array>} all matches
 */
export async function pullAllMatches(onProgress) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  // Prefer tournaments index; fall back to tournament_dates; last resort: dir-walk
  let dates = Store.getTournamentsIndex().map(e => e.date);
  if (dates.length === 0) {
    dates = JSON.parse(localStorage.getItem('mexicano_tournament_dates') || '[]');
  }

  // If still no dates, fetch tournaments.json (create if needed) to populate them
  if (dates.length === 0) {
    const entries = await fetchTournamentsIndex({ create: true });
    dates = (entries || []).map(e => e.date);
  }

  const dayFilePaths = dates.map(d => datePath(d));

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

// ─── Auto-sync (debounced + serialised) ──────────────────────────────────────

let _syncTimer = null;
let _syncStatus = 'idle'; // idle | syncing | success | error
let _isPulling = false;   // suppresses auto-push during pullAll
let _pushInProgress = false;
let _pushPending = false;
const _listeners = new Set();
const _dirtyMatchDates = new Set();

/** Mark a tournament date as needing a push to GitHub. */
export function markMatchDateDirty(date) {
  if (date) _dirtyMatchDates.add(date);
}

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

/** Execute a single push, serialising concurrent requests. */
async function executePush() {
  if (_pushInProgress) {
    _pushPending = true;
    ghLog('AUTO_SYNC', '-', 'queued (push already in progress)');
    return;
  }
  _pushInProgress = true;
  setSyncStatus('syncing');
  ghLog('AUTO_SYNC', '-', 'starting');
  try {
    await pushAll();
    setSyncStatus('success');
    setTimeout(() => setSyncStatus('idle'), 3000);
  } catch (e) {
    console.error('GitHub auto-sync failed:', e);
    ghLog('AUTO_SYNC_FAIL', '-', e.message);
    setSyncStatus('error');
  } finally {
    _pushInProgress = false;
    if (_pushPending) {
      _pushPending = false;
      executePush();
    }
  }
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
  // Doodle is pushed explicitly via pushDoodleNow — skip auto-sync to avoid race conditions
  if (key.startsWith('doodle_')) return;

  ghLog('SCHEDULE_PUSH', '-', `triggered by key: ${key}`);
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => executePush(), 1500);
}

/** Cancel any pending debounced auto-push without executing it. */
export function cancelPendingSync() {
  clearTimeout(_syncTimer);
  _syncTimer = null;
}

/**
 * Immediately flush any pending sync (bypasses debounce timer).
 * Use for critical operations like tournament creation / completion.
 */
export function flushPush() {
  if (_isPulling) return;
  if (!getConfig()?.pat) return;
  clearTimeout(_syncTimer);
  executePush();
}

/**
 * Push a single doodle file to GitHub immediately (bypasses debounce).
 * Returns a Promise that resolves when the write completes.
 * No-op if GitHub is not configured.
 */
export async function pushDoodleNow(yearMonth) {
  const cfg = getConfig();
  if (!cfg?.pat) return;
  const key = `doodle_${yearMonth}`;
  const filePath = keyToPath(key);
  if (!filePath) return;
  const entries = Store.getDoodle(yearMonth);
  let sha;
  try { const existing = await readFile(filePath); sha = existing?.sha; } catch { sha = undefined; }
  await writeFile(filePath, entries, sha);
}
