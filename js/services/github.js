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
 * Members and theme are local-only and are never synced to GitHub.
 */

import { Store } from '../store.js';
import { Cache } from '../cache.js';

const API_BASE = 'https://api.github.com';

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
  const out = {
    Date: m.date,
    RoundNumber: m.roundNumber,
    ScoreTeam1: m.scoreTeam1,
    ScoreTeam2: m.scoreTeam2,
    Team1Player1Name: m.team1Player1Name,
    Team1Player2Name: m.team1Player2Name,
    Team2Player1Name: m.team2Player1Name,
    Team2Player2Name: m.team2Player2Name,
  };
  if (m.team1Player1Elo != null) out.Team1Player1Elo = m.team1Player1Elo;
  if (m.team1Player2Elo != null) out.Team1Player2Elo = m.team1Player2Elo;
  if (m.team2Player1Elo != null) out.Team2Player1Elo = m.team2Player1Elo;
  if (m.team2Player2Elo != null) out.Team2Player2Elo = m.team2Player2Elo;
  return out;
}

export function fromBackupMatch(m) {
  const out = {
    date: m.Date,
    roundNumber: m.RoundNumber,
    scoreTeam1: m.ScoreTeam1,
    scoreTeam2: m.ScoreTeam2,
    team1Player1Name: m.Team1Player1Name,
    team1Player2Name: m.Team1Player2Name,
    team2Player1Name: m.Team2Player1Name,
    team2Player2Name: m.Team2Player2Name,
  };
  if (m.Team1Player1Elo != null) out.team1Player1Elo = m.Team1Player1Elo;
  if (m.Team1Player2Elo != null) out.team1Player2Elo = m.Team1Player2Elo;
  if (m.Team2Player1Elo != null) out.team2Player1Elo = m.Team2Player1Elo;
  if (m.Team2Player2Elo != null) out.team2Player2Elo = m.Team2Player2Elo;
  return out;
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
export function matchesBase() {
  const base = getConfig()?.basePath?.trim().replace(/\/$/, '') || '';
  return base;
}

/** Returns the configured GitHub credentials or null if not set. */
export function getConfig() {
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

  const doodleChangelogMatch = key.match(/^doodle_changelog_(\d{4})-(\d{2})$/);
  if (doodleChangelogMatch) {
    const year = doodleChangelogMatch[1];
    const yearMonth = `${year}-${doodleChangelogMatch[2]}`;
    return `${prefix}${year}/${yearMonth}/${key}.json`;
  }

  // Doodle files live next to that month's tournament data: YYYY/YYYY-MM/doodle_YYYY-MM.json
  const doodleMatch = key.match(/^doodle_(\d{4})-(\d{2})$/);
  if (doodleMatch) {
    const year = doodleMatch[1];
    const yearMonth = `${year}-${doodleMatch[2]}`;
    return `${prefix}${year}/${yearMonth}/${key}.json`;
  }

  // Active tournament is now embedded in the date file — not synced separately.
  const SYNCED_DATA_KEYS = [];
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

  const url = `${API_BASE}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${safePath}`;
  const res = await fetch(url, { headers: authHeaders(cfg.pat) });

  if (res.status === 404) { return null; }
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
export async function listContents(path) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return [];

  const safePath = guardPath(path);

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
    throw new Error(`GitHub delete failed (${res.status}): ${err.message || safePath}`);
  }
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
    const fresh = await readFile(path);
    res = await attempt(fresh?.sha);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub write failed (${res.status}): ${err.message || safePath}`);
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
 * Other synced keys (doodle) are written to data/.
 * The active tournament is embedded in the date file under a `tournament` field
 * instead of a separate data/active_tournament.json.
 *
 * @param {function} [onProgress] - called with (label, total, index) for each file written
 * @param {object}   [opts]
 * @param {boolean}  [opts.allMatchDates=false] - when true, push every match date (manual sync);
 *                   when false (auto-sync), only push dates marked dirty via markMatchDateDirty().
 */
export async function pushAll(onProgress, { allMatchDates = false } = {}) {
  const data = Store.exportAll();

  // 1. Push non-matches data — doodle is pushed explicitly via pushDoodleNow, not here
  const entries = Object.entries(data).filter(([k]) => keyToPath(k) && !k.startsWith('doodle_'));

  let total = entries.length;
  let i = 0;
  for (const [key, value] of entries) {
    const path = keyToPath(key);
    let sha;
    try { const existing = await readFile(path); sha = existing?.sha; } catch { sha = undefined; }
    await writeFile(path, value, sha);
    onProgress?.(key, total, ++i);
  }

  // 2. Push matches as per-date files (only dirty dates unless allMatchDates).
  // Snapshot dirty dates now so marks added during push are not lost.
  const dirtyDatesSnapshot = new Set(_dirtyMatchDates);
  _dirtyMatchDates.clear();

  // Active (in-progress) tournament: embed the full tournament object in its date file.
  const activeTournament = Store.getActiveTournament();
  const activeTDate = (!activeTournament?.isCompleted && activeTournament?.tournamentDate)
    ? activeTournament.tournamentDate : null;

  const matches = data.matches || [];
  const byDate = {};
  for (const m of matches) {
    if (!m.date) continue;
    if (!allMatchDates && !dirtyDatesSnapshot.has(m.date)) continue;
    if (!byDate[m.date]) byDate[m.date] = [];
    byDate[m.date].push(m);
  }

  // Ensure the active tournament date is included in the push even with no completed matches.
  if (activeTDate && (allMatchDates || dirtyDatesSnapshot.has(activeTDate))) {
    if (!byDate[activeTDate]) byDate[activeTDate] = [];
  }

  const dateEntries = Object.entries(byDate);
  total = dateEntries.length;
  i = 0;
  for (const [date, dateMatches] of dateEntries) {
    const path = datePath(date);
    let backupData;
    if (activeTDate === date) {
      // In-progress: store tournament object so any device can restore state.
      backupData = {
        backup_timestamp: new Date().toISOString(),
        match_date: date,
        tournament: activeTournament,
      };
    } else {
      backupData = {
        backup_timestamp: new Date().toISOString(),
        match_date: date,
        match_count: dateMatches.length,
        matches: dateMatches.map(toBackupMatch),
      };
    }
    let sha;
    try { const existing = await readFile(path); sha = existing?.sha; } catch { sha = undefined; }
    await writeFile(path, backupData, sha);
    onProgress?.(date, dateEntries.length, ++i);
  }

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
export async function fetchTournamentsIndex({ create = false } = {}) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return null;

  const path = tournamentsIndexPath();
  const base = matchesBase();

  const result = await readFile(path);

  if (result !== null) {
    const entries = Array.isArray(result.content) ? result.content : [];

    // Self-heal stale entries: matchCount=0 but playerCount>0 means the
    // tournament was started but updateTournamentIndexEntry failed at completion.
    const staleEntries = entries.filter(e => e.matchCount === 0 && e.playerCount > 0 && !e.isComplete);
    if (staleEntries.length > 0) {
      let changed = false;
      for (const stale of staleEntries) {
        const prefix = base ? `${base}/` : '';
        const year = stale.date.slice(0, 4);
        const yearMonth = stale.date.slice(0, 7);
        const filePath = `${prefix}${year}/${yearMonth}/${stale.date}.json`;
        try {
          const dayResult = await readFile(filePath);
          if (dayResult?.content?.matches && Array.isArray(dayResult.content.matches)) {
            const matches = dayResult.content.matches;
            if (matches.length === 0) continue;
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
            const idx = entries.findIndex(e => e.date === stale.date);
            if (idx >= 0) {
              entries[idx] = {
                ...entries[idx],
                playerCount: players.size,
                roundCount: rounds.size,
                matchCount: matches.length,
                completedCount: completed,
                isComplete: matches.length > 0 && completed === matches.length,
              };
              changed = true;
            }
          }
        } catch { /* skip */ }
      }
      if (changed) {
        try {
          await writeFile(path, entries, result.sha);
        } catch (e) {
          console.warn('[github] failed to write healed tournaments.json:', e);
        }
      }
    }

    Store.setTournamentsIndex(entries);
    const dates = entries.map(e => e.date).sort();
    Cache.set('tournament_dates', dates);
    return entries;
  }

  if (!create) return null;

  // ── Bootstrap: traverse repo, read each day file, build index ─────────────

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
  } catch (e) {
    console.warn('[github] failed to write tournaments.json:', e);
  }

  Store.setTournamentsIndex(entries);
  const dates = entries.map(e => e.date).sort();
  Cache.set('tournament_dates', dates);
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
  Cache.set('tournament_dates', dates);
}

/**
 * Public wrapper for fetchTournamentsIndex with create:true.
 * Used by the Tournaments page for lazy-loading when index is empty.
 */
export async function fetchTournamentsIndexPublic() {
  return fetchTournamentsIndex({ create: true });
}

/**
 * Internal helper: resolve the active tournament from its date file.
 * Must be called AFTER tournaments.json has been loaded into the Store.
 *
 * Strategy:
 *  1. If local active tournament is completed → clear it and return.
 *  2. If local active tournament is in-progress → verify/refresh from its date file.
 *  3. Else try the most recent `isComplete:false` entry in the index.
 *  4. Fallback: probe the most recent date (≤3 days) in case tournaments.json
 *     wrongly has `isComplete:true` after a data restore (stale index).
 *  5. Backward-compat migration: if nothing found in date file, try the old
 *     `data/active_tournament.json` once.
 *
 * When a date file has `{ tournament: {...} }` and the tournament is not
 * completed, the in-memory index entry is corrected to `isComplete:false`.
 */
async function pullActiveTournamentFromDateFile() {
  const entries = Store.getTournamentsIndex() || [];
  const local = Store.getActiveTournament();
  const base = matchesBase();

  if (local?.isCompleted) {
    localStorage.removeItem('mexicano_active_tournament');
    return;
  }

  let dateToCheck = null;
  let isExplicit = false;

  if (local && !local.isCompleted) {
    dateToCheck = local.tournamentDate;
    isExplicit = true;
  } else {
    const incompleteEntry = [...entries]
      .filter(e => !e.isComplete)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    if (incompleteEntry) {
      dateToCheck = incompleteEntry.date;
      isExplicit = true;
    } else {
      const mostRecent = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0];
      if (mostRecent) {
        const daysDiff = (Date.now() - new Date(mostRecent.date + 'T00:00:00').getTime()) / 86400000;
        if (daysDiff <= 3) dateToCheck = mostRecent.date;
      }
    }
  }

  // No active tournament found in index → stale localStorage entry must be cleared.
  if (!dateToCheck) {
    localStorage.removeItem('mexicano_active_tournament');
    return;
  }

  let foundActiveInDateFile = false;

  if (dateToCheck) {
    let dateFileResult = null;
    try { dateFileResult = await readFile(datePath(dateToCheck)); } catch { /* ok */ }

    const activeTInFile = dateFileResult?.content?.tournament;
    const entry = entries.find(e => e.date === dateToCheck);
    // Index is definitively complete when it has real match data (not just a
    // stale isComplete:true from a data-restore with matchCount=0).
    const indexIsDefinitivelyComplete = !!(entry?.isComplete
      && entry.matchCount > 0
      && entry.completedCount === entry.matchCount);

    if (indexIsDefinitivelyComplete) {
      // Index has real completion data — date file may be a stale intermediate push.
      // Clear local state unconditionally and return early (skip migration path).
      if (local && local.tournamentDate === dateToCheck) {
        const otherMatches = Store.getMatches().filter(m => m.date !== dateToCheck);
        localStorage.setItem('mexicano_matches', JSON.stringify(otherMatches));
      }
      localStorage.removeItem('mexicano_active_tournament');
      localStorage.removeItem('mexicano_completion_marker');
      return;
    } else if (activeTInFile && !activeTInFile.isCompleted) {
      const completionMarker = localStorage.getItem('mexicano_completion_marker');
      if (completionMarker === dateToCheck) {
        // Tournament was just completed locally, push is in-flight — don't restore stale state.
      } else {
        foundActiveInDateFile = true;
        localStorage.setItem('mexicano_active_tournament', JSON.stringify(activeTInFile));
        // Fix in-memory index if tournaments.json wrongly marks it complete (stale index).
        if (entry?.isComplete) {
          const fixed = entries.map(e => e.date === dateToCheck ? { ...e, isComplete: false } : e);
          Store.setTournamentsIndex(fixed);
          Cache.set('tournament_dates', fixed.map(e => e.date).sort());
        }
      }
    } else if (isExplicit) {
      // We explicitly expected an active tournament here.
      // Clear local state when the date file shows the tournament completed
      // (non-empty matches array) OR when tournaments.json definitively marks
      // this date as complete — the index is updated after every successful push
      // and is the authoritative source of truth.
      const fileShowsCompleted = Array.isArray(dateFileResult?.content?.matches)
        && dateFileResult.content.matches.length > 0;
      const indexMarksComplete = entries.some(e => e.date === dateToCheck && e.isComplete);
      if (fileShowsCompleted || indexMarksComplete) {
        if (local && local.tournamentDate === dateToCheck) {
          const otherMatches = Store.getMatches().filter(m => m.date !== dateToCheck);
          localStorage.setItem('mexicano_matches', JSON.stringify(otherMatches));
        }
        localStorage.removeItem('mexicano_active_tournament');
        localStorage.removeItem('mexicano_completion_marker'); // push confirmed, clear marker
        return;
      }
    }
  }

  // Backward-compat migration: pre-migration date files lack the `tournament` field.
  // If no active tournament resolved via the date file, try old data/active_tournament.json.
  if (!foundActiveInDateFile && !Store.getActiveTournament()) {
    const dataPath = base ? `${base}/data` : 'data';
    try {
      const atResult = await readFile(`${dataPath}/active_tournament.json`);
      if (atResult !== null && !atResult.content?.isCompleted) {
        localStorage.setItem('mexicano_active_tournament', JSON.stringify(atResult.content));
        markMatchDateDirty(atResult.content.tournamentDate);
      }
    } catch { /* data/active_tournament.json may not exist */ }
  }
}

/**
 * Force-fetch the latest active tournament state from its date file.
 * Use on the tournament detail page to bypass the session pull guard.
 * Returns the updated tournament object or null if not found / already completed.
 */
export async function fetchActiveTournamentJson() {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return null;

  const local = Store.getActiveTournament();
  if (!local || local.isCompleted) return null;

  const dateToFetch = local.tournamentDate;
  if (!dateToFetch) return null;

  try {
    const dateResult = await readFile(datePath(dateToFetch));
    const activeTInFile = dateResult?.content?.tournament;
    if (activeTInFile && !activeTInFile.isCompleted) {
      localStorage.setItem('mexicano_active_tournament', JSON.stringify(activeTInFile));
      return activeTInFile;
    }
  } catch { /* ok */ }

  // Backward compat: try old data/active_tournament.json
  const base = matchesBase();
  const dataPath = base ? `${base}/data` : 'data';
  try {
    const atResult = await readFile(`${dataPath}/active_tournament.json`);
    if (atResult !== null && !atResult.content?.isCompleted) {
      localStorage.setItem('mexicano_active_tournament', JSON.stringify(atResult.content));
      return atResult.content;
    }
  } catch { /* ok */ }

  return null;
}

/**
 *
 * Reads pre-computed summary files (players.json, monthly overviews) and
 * discovers tournament dates via tournaments.json (creating it if missing).
 *
 * Doodle files are read from YYYY/YYYY-MM/doodle_YYYY-MM.json alongside
 * tournament data, and monthly doodle changelog is read from
 * YYYY/YYYY-MM/doodle_changelog_YYYY-MM.json. Other data (active_tournament)
 * is read from data/.
 *
 * @param {function} [onProgress] - called with (label, total, index)
 */
export async function pullAll(onProgress) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  _isPulling = true;

  // Keys to preserve across pull (config, audit log, user preferences, dev flags)
  const PRESERVE = new Set([
    'mexicano_round_log',
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
          id: p.Id ?? null,
          name: p.Name,
          elo: p.ELO,
          previousElo: p.PreviousELO ?? p.ELO,
          wins: p.Wins ?? null,
          losses: p.Losses ?? null,
          points: p.TotalPoints ?? null,
          average: p.Average ?? null,
          tournaments: p.Tournaments ?? null,
          matchPadelId: p.MatchPadelId ?? null,
        }));
        Store.setPlayersSummaryCache(camelPlayers);
        // Update members list from the authoritative players.json
        const playerNames = camelPlayers.map(p => p.name).sort();
        Cache.set('members', playerNames);
        Store.setMembers(playerNames);
      }
    } catch { /* players.json may not exist yet */ }
    onProgress?.('players.json', 0, 0);

    // ── 2. tournaments.json → tournament dates ──────────────────────────────
    await fetchTournamentsIndex({ create: true });
    onProgress?.('tournaments.json', 0, 0);

    // ── 3. Read monthly overview + doodle files (derived from index dates) ──
    const allDates = Cache.get('tournament_dates') || [];
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
          Cache.set(`monthly_${ym}`, camelOverview);
        }
      } catch { /* overview may not exist */ }

      try {
        const doodleResult = await readFile(`${monthPath}/doodle_${ym}.json`);
        if (doodleResult?.content) {
          localStorage.setItem(`mexicano_doodle_${ym}`, JSON.stringify(doodleResult.content));
        }
      } catch { /* doodle may not exist */ }

      try {
        const changelogResult = await readFile(`${monthPath}/doodle_changelog_${ym}.json`);
        if (changelogResult?.content) {
          localStorage.setItem(`mexicano_doodle_changelog_${ym}`, JSON.stringify(changelogResult.content));
        }
      } catch { /* doodle changelog may not exist */ }

      onProgress?.(ym, total, i + 1);
    }

    // ── 4. Resolve active tournament from date file ─────────────────────────
    await pullActiveTournamentFromDateFile();

    pullSucceeded = true;
  } finally {
    _isPulling = false;
    if (!pullSucceeded) {
      // Restore snapshot so data is intact after a network/API failure
      toClear.forEach(k => localStorage.removeItem(k));
      Object.entries(snapshot).forEach(([k, v]) => localStorage.setItem(k, v));
    }
  }

  return { updated: true };
}

// ─── Doodle-only Session TTL helpers ─────────────────────────────────────────
// Read-only GitHub data (players, tournaments, overviews, per-player elo_history files) now uses
// the in-memory Cache instead of TTL. Doodle data stays in localStorage and
// still uses a session TTL to avoid hammering the API on repeated doodle visits.

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

function markDoodleFetched(yearMonth) {
  try { sessionStorage.setItem(`mexicano_gh_ts_doodle_${yearMonth}`, Date.now().toString()); } catch { /* unavailable */ }
}

function isDoodleFreshInSession(yearMonth) {
  try {
    const ts = parseInt(sessionStorage.getItem(`mexicano_gh_ts_doodle_${yearMonth}`) || '0', 10);
    return Date.now() - ts < SESSION_TTL_MS;
  } catch { return false; }
}

function clearDoodleSessionTTL(yearMonth) {
  try { sessionStorage.removeItem(`mexicano_gh_ts_doodle_${yearMonth}`); } catch { /* unavailable */ }
}

/**
 * Backward-compatible TTL clear helper used by existing page modules.
 * Expects key format: doodle_YYYY-MM
 */
export function clearSessionTTL(key) {
  const match = key?.match(/^doodle_(\d{4}-\d{2})$/);
  if (match) clearDoodleSessionTTL(match[1]);
}

/** Parse a raw players_overview.json entry (PascalCase) to camelCase. */
function fromOverview(p) {
  // ELO may be an array [{Date, ELO}, ...] (new format) or a plain number (legacy).
  // Store the final ELO value for display in the monthly stats view.
  const elo = Array.isArray(p.ELO)
    ? (p.ELO.length > 0 ? p.ELO[p.ELO.length - 1].ELO : 1000)
    : (p.ELO ?? 1000);
  return {
    name: p.Name,
    totalPoints: p.Total_Points,
    wins: p.Wins,
    losses: p.Losses,
    average: p.Average,
    elo,
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
      Cache.set(`monthly_${yearMonth}`, result.content.map(fromOverview));
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
  if (Cache.has('players_summary')) return false;

  const base = matchesBase();

  // ── 1. players.json ────────────────────────────────────────────────────────
  const playersPath = base ? `${base}/players.json` : 'players.json';
  try {
    const result = await readFile(playersPath);
    if (result?.content && Array.isArray(result.content)) {
      const camelPlayers = result.content.map(p => ({
        id: p.Id ?? null,
        name: p.Name,
        elo: p.ELO,
        previousElo: p.PreviousELO ?? p.ELO,
        wins: p.Wins ?? null,
        losses: p.Losses ?? null,
        points: p.TotalPoints ?? null,
        average: p.Average ?? null,
        tournaments: p.Tournaments ?? null,
        matchPadelId: p.MatchPadelId ?? null,
      }));
      Store.setPlayersSummaryCache(camelPlayers);
      const memberNames = camelPlayers.map(p => p.name).sort();
      Cache.set('members', memberNames);
      Store.setMembers(memberNames);
    }
  } catch { /* players.json may not exist yet */ }

  // ── 2. tournaments.json → tournament_dates (no dir-walk, no create) ────────
  await fetchTournamentsIndex({ create: false });

  // ── 3. Resolve active tournament from date file ────────────────────────────
  await pullActiveTournamentFromDateFile();

  // ── 4. Current + previous month overviews─────────────────────────────────
  const now = new Date();
  for (const offset of [0, -1]) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    await _fetchOverview(base, ym);
  }

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
  if (Cache.has('players_summary')) return false;

  const base = matchesBase();

  // ── 1. players.json ────────────────────────────────────────────────────────
  const playersPath = base ? `${base}/players.json` : 'players.json';
  try {
    const result = await readFile(playersPath);
    if (result?.content && Array.isArray(result.content)) {
      const camelPlayers = result.content.map(p => ({
        id: p.Id ?? null,
        name: p.Name,
        elo: p.ELO,
        previousElo: p.PreviousELO ?? p.ELO,
        wins: p.Wins ?? null,
        losses: p.Losses ?? null,
        points: p.TotalPoints ?? null,
        average: p.Average ?? null,
        tournaments: p.Tournaments ?? null,
        matchPadelId: p.MatchPadelId ?? null,
      }));
      Store.setPlayersSummaryCache(camelPlayers);
      const memberNames = camelPlayers.map(p => p.name).sort();
      Cache.set('members', memberNames);
      Store.setMembers(memberNames);
    }
  } catch { /* players.json may not exist yet */ }

  // ── 2. tournaments.json — create if missing ────────────────────────────────
  await fetchTournamentsIndex({ create: true });

  // ── 3. Resolve active tournament from date file ────────────────────────────
  await pullActiveTournamentFromDateFile();

  return true;
}

/**
 * Append a brand-new player entry to players.json on GitHub.
 * Throws if GitHub is not configured, players.json is missing, or the name
 * already exists (case-insensitive).
 * @param {string} name - The player's display name (already trimmed/validated)
 */
export async function addPlayerToPlayersJson(name) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) {
    throw new Error('GitHub is not configured. Configure it in Settings before adding members.');
  }

  const base = matchesBase();
  const playersPath = base ? `${base}/players.json` : 'players.json';

  const result = await readFile(playersPath);
  if (!result || !Array.isArray(result.content)) {
    throw new Error('players.json not found in the GitHub repository.');
  }

  const players = result.content;
  const lowerName = name.toLowerCase();
  if (players.some(p => (p.Name ?? '').toLowerCase() === lowerName)) {
    throw new Error(`Player "${name}" already exists in players.json.`);
  }

  const newPlayer = {
    Name: name,
    ELO: 1000,
    PreviousELO: 1000,
    Wins: 0,
    Losses: 0,
    TotalPoints: 0,
    Average: 0,
    Tournaments: 0,
    Id: crypto.randomUUID(),
    MatchPadelId: 0,
  };

  players.push(newPlayer);
  await writeFile(playersPath, players, result.sha);

  // Refresh local cache from the updated array
  const camelPlayers = players.map(p => ({
    id: p.Id ?? null,
    name: p.Name,
    elo: p.ELO,
    previousElo: p.PreviousELO ?? p.ELO,
    wins: p.Wins ?? null,
    losses: p.Losses ?? null,
    points: p.TotalPoints ?? null,
    average: p.Average ?? null,
    tournaments: p.Tournaments ?? null,
    matchPadelId: p.MatchPadelId ?? null,
  }));
  Store.setPlayersSummaryCache(camelPlayers);
  const memberNames = camelPlayers.map(p => p.name).sort();
  Cache.set('members', memberNames);
  Store.setMembers(memberNames);
}

/**
 * Pull only players.json for the settings page.
 * Lightweight fetch that skips expensive directory walk and tournament data.
 * No-op if already fresh in this session.
 */
async function pullSettingsData() {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return false;
  if (Cache.has('players_summary')) return false;

  const base = matchesBase();

  const playersPath = base ? `${base}/players.json` : 'players.json';
  try {
    const result = await readFile(playersPath);
    if (result?.content && Array.isArray(result.content)) {
      const camelPlayers = result.content.map(p => ({
        id: p.Id ?? null,
        name: p.Name,
        elo: p.ELO,
        previousElo: p.PreviousELO ?? p.ELO,
        wins: p.Wins ?? null,
        losses: p.Losses ?? null,
        points: p.TotalPoints ?? null,
        average: p.Average ?? null,
        tournaments: p.Tournaments ?? null,
        matchPadelId: p.MatchPadelId ?? null,
      }));
      Store.setPlayersSummaryCache(camelPlayers);
      const memberNames = camelPlayers.map(p => p.name).sort();
      Cache.set('members', memberNames);
      Store.setMembers(memberNames);
    }
  } catch { /* players.json may not exist yet */ }

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

  const base = matchesBase();
  const hadData = Cache.has(`monthly_${yearMonth}`);
  await _fetchOverview(base, yearMonth);
  const hasData = Cache.has(`monthly_${yearMonth}`);
  return { updated: !hadData && hasData };
}

/**
 * Pull a single month's RAW players_overview.json (full ELO arrays intact).
 * Unlike pullMonthlyOverview, this does NOT run fromOverview() — the per-date
 * ELO entries are preserved, which the attendance feature needs.
 * Cached in-memory under `monthly_raw_YYYY-MM`. Returns the raw array or null.
 * @param {string} yearMonth - 'YYYY-MM'
 * @returns {Promise<Array|null>}
 */
export async function pullMonthlyOverviewRaw(yearMonth) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return null;

  const cacheKey = `monthly_raw_${yearMonth}`;
  if (Cache.has(cacheKey)) return Cache.get(cacheKey);

  const base = matchesBase();
  const year = yearMonth.slice(0, 4);
  const prefix = base ? `${base}/` : '';
  const path = `${prefix}${year}/${yearMonth}/players_overview.json`;
  try {
    const result = await readFile(path);
    if (result?.content && Array.isArray(result.content)) {
      Cache.set(cacheKey, result.content);
      return result.content;
    }
  } catch { /* overview may not exist for this month */ }
  return null;
}

/**
 * Pull all monthly overviews from GitHub (one per unique YYYY-MM in tournament_dates).
 * Skips months already loaded in the current page session (in-memory Cache).
 * @returns {Promise<{ updated: boolean }>}
 */
export async function pullAllOverviews() {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return { updated: false };

  const dates = Cache.get('tournament_dates') || [];
  const months = [...new Set(dates.map(d => d.slice(0, 7)))].sort();
  const base = matchesBase();
  let updated = false;

  for (const ym of months) {
    if (Cache.has(`monthly_${ym}`)) continue;
    await _fetchOverview(base, ym);
    if (Cache.has(`monthly_${ym}`)) updated = true;
  }
  return { updated };
}

/**
 * Pull a single doodle month from GitHub.
 * No-op if already fresh in this session.
 * Returns the raw doodle + changelog arrays and whether either differed from cache.
 * The caller is responsible for updating Store and emitting state events.
 * @param {string} yearMonth - 'YYYY-MM'
 * @returns {Promise<{ content: Array|null, changelog: Array|null, updated: boolean }>}
 */
export async function pullDoodleMonth(yearMonth) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return { content: null, changelog: null, updated: false };
  if (isDoodleFreshInSession(yearMonth)) return { content: null, changelog: null, updated: false };

  const base = matchesBase();
  const year = yearMonth.slice(0, 4);
  const prefix = base ? `${base}/` : '';
  const doodlePath = `${prefix}${year}/${yearMonth}/doodle_${yearMonth}.json`;
  const changelogPath = `${prefix}${year}/${yearMonth}/doodle_changelog_${yearMonth}.json`;

  let content = null;
  let changelog = null;
  let updated = false;

  try {
    const result = await readFile(doodlePath);
    if (Array.isArray(result?.content)) {
      content = result.content;
      const existing = localStorage.getItem(`mexicano_doodle_${yearMonth}`);
      const newJson = JSON.stringify(content);
      if (existing !== newJson) updated = true;
    }
  } catch { /* doodle file may not exist yet */ }

  try {
    const result = await readFile(changelogPath);
    if (Array.isArray(result?.content)) {
      changelog = result.content;
      const existing = localStorage.getItem(`mexicano_doodle_changelog_${yearMonth}`);
      const newJson = JSON.stringify(changelog);
      if (existing !== newJson) updated = true;
    }
  } catch { /* changelog file may not exist yet */ }

  markDoodleFetched(yearMonth);
  return { content, changelog, updated };
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
  if (Cache.has('players_summary')) return false;

  const base = matchesBase();

  // ── 1. players.json ──────────────────────────────────────────────────────────
  const playersPath = base ? `${base}/players.json` : 'players.json';
  try {
    const result = await readFile(playersPath);
    if (result?.content && Array.isArray(result.content)) {
      const camelPlayers = result.content.map(p => ({
        id: p.Id ?? null,
        name: p.Name,
        elo: p.ELO,
        previousElo: p.PreviousELO ?? p.ELO,
        wins: p.Wins ?? null,
        losses: p.Losses ?? null,
        points: p.TotalPoints ?? null,
        average: p.Average ?? null,
        tournaments: p.Tournaments ?? null,
        matchPadelId: p.MatchPadelId ?? null,
      }));
      Store.setPlayersSummaryCache(camelPlayers);
      const memberNames = camelPlayers.map(p => p.name).sort();
      Cache.set('members', memberNames);
      Store.setMembers(memberNames);
    }
  } catch { /* players.json may not exist yet */ }

  // ── 2. Tournament dates — read tournaments.json (no create, no dir-walk) ─────
  await fetchTournamentsIndex({ create: false });

  // ── 3. Resolve active tournament from date file ─────────────────────────────
  await pullActiveTournamentFromDateFile();

  // ── 4. Latest date's matches — only if not already in localStorage ───────────
  const allDates = Cache.get('tournament_dates') || [];
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

  return true;
}

/**
 * Pull only what the elo-charts page needs from GitHub.
 * Fetches players.json and tournaments.json.
 *
 * No-op if already fresh in this session.
 * @returns {Promise<boolean>} true if any data was fetched
 */
async function pullEloChartsData() {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return false;
  if (Cache.has('players_summary')) return false;

  const base = matchesBase();

  // ── 1. players.json ──────────────────────────────────────────────────────────
  const playersPath = base ? `${base}/players.json` : 'players.json';
  try {
    const result = await readFile(playersPath);
    if (result?.content && Array.isArray(result.content)) {
      const camelPlayers = result.content.map(p => ({
        id: p.Id ?? null,
        name: p.Name,
        elo: p.ELO,
        previousElo: p.PreviousELO ?? p.ELO,
        wins: p.Wins ?? null,
        losses: p.Losses ?? null,
        points: p.TotalPoints ?? null,
        average: p.Average ?? null,
        tournaments: p.Tournaments ?? null,
        matchPadelId: p.MatchPadelId ?? null,
      }));
      Store.setPlayersSummaryCache(camelPlayers);
      const memberNames = camelPlayers.map(p => p.name).sort();
      Cache.set('members', memberNames);
      Store.setMembers(memberNames);
    }
  } catch { /* players.json may not exist yet */ }

  // ── 2. tournaments.json ──────────────────────────────────────────────────────
  try {
    await fetchTournamentsIndex({ create: false });
  } catch { /* tournaments.json may not exist */ }

  // ── 3. Latest tournament's matches (for Latest Tournament chart) ─────────────
  const allDates = Cache.get('tournament_dates') || [];
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

    // Elo charts page: fetch players and tournaments (history loads per selected player)
    if (path === '/elo-charts') {
      const updated = await pullEloChartsData();
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
 * Refresh data for the current route, clearing TTLs first so pull always re-fetches.
 * Reports progress via onStep(type, label, status) callbacks.
 *
 * @param {string} hash - window.location.hash
 * @param {Function} [onStep] - (type: 'add'|'update', label: string, status: string) => void
 * @returns {Promise<{ updated: boolean }>}
 */
export async function refreshCurrentPage(hash, onStep) {
  const cfg = getConfig();
  if (!cfg?.pat) throw new Error('GitHub not configured');

  const path = (hash || '').replace(/^#/, '').split('?')[0] || '/';

  // Clear in-memory Cache for the data this route needs so pull always re-fetches
  if (path === '/elo-charts') {
    Cache.keys('elo_history_player_').forEach(k => Cache.del(k));
    Cache.del('players_summary');
    Cache.del('members');
  } else if (path === '/settings') {
    Cache.del('players_summary');
    Cache.del('members');
  } else {
    // home, tournaments, statistics, doodle, tournament detail
    Cache.del('players_summary');
    Cache.del('members');
    Cache.del('tournaments_index');
    Cache.del('tournament_dates');
    const now = new Date();
    for (const offset of [-1, 0]) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      Cache.del(`monthly_${ym}`);
    }
  }
  if (path === '/doodle') {
    const now = new Date();
    for (const offset of [0, 1]) {
      const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      clearDoodleSessionTTL(ym);
    }
  }

  const steps = _getRefreshSteps(path);
  steps.forEach(s => onStep?.('add', s, 'pending'));

  if (steps.length > 0) onStep?.('update', steps[0], 'loading');
  const result = await pullForRoute(hash);
  steps.forEach(s => onStep?.('update', s, 'done'));
  return result;
}

function _getRefreshSteps(path) {
  if (path === '/') return ['players.json', 'tournaments.json', 'Latest match data'];
  if (path === '/tournaments') return ['players.json', 'tournaments.json'];
  if (path === '/elo-charts') return ['players.json', 'Per-player ELO history'];
  if (path === '/statistics') return ['players.json', 'tournaments.json', 'Monthly overviews'];
  if (path === '/doodle') return ['Core data', 'Doodle schedules'];
  if (path === '/settings') return ['players.json'];
  if (path.startsWith('/tournament/')) return ['Core data', 'Match data'];
  return ['players.json', 'tournaments.json', 'Monthly data'];
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

  // Prefer tournaments index; fall back to Cache tournament_dates; last resort: dir-walk
  let dates = Store.getTournamentsIndex().map(e => e.date);
  if (dates.length === 0) {
    dates = Cache.get('tournament_dates') || [];
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
const _afterAllPushResolvers = [];
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
    return new Promise(resolve => { _afterAllPushResolvers.push(resolve); });
  }
  _pushInProgress = true;
  setSyncStatus('syncing');
  try {
    await pushAll();
    setSyncStatus('success');
    setTimeout(() => setSyncStatus('idle'), 3000);
  } catch (e) {
    console.error('GitHub auto-sync failed:', e);
    setSyncStatus('error');
  } finally {
    _pushInProgress = false;
    if (_pushPending) {
      _pushPending = false;
      await executePush(); // wait for the pending run (which also handles more pending)
    }
    // Queue fully drained — notify all waiters
    const resolvers = _afterAllPushResolvers.splice(0);
    resolvers.forEach(fn => fn());
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
  // NOTE: Does NOT check _isPulling — tournament completion/creation must push even during pulls.
  if (!getConfig()?.pat) return Promise.resolve();
  clearTimeout(_syncTimer);
  return executePush();
}

// ─── Player Summaries ────────────────────────────────────────────────────────

/** Convert a player name to a safe file-system/URL slug. */
export function sanitizePlayerName(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/** Repo-relative path for a player summary file. */
export function playerSummaryPath(playerName) {
  const base = matchesBase();
  const prefix = base ? `${base}/` : '';
  return `${prefix}players_summaries/summary_${sanitizePlayerName(playerName)}.json`;
}

/**
 * Read a pre-generated player summary from GitHub.
 * Returns the parsed summary object, or null if not found / GitHub not configured.
 */
export async function readPlayerSummary(playerName) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return null;
  try {
    const result = await readFile(playerSummaryPath(playerName));
    return result?.content ?? null;
  } catch {
    return null;
  }
}

function playerEloHistoryPath(playerId) {
  const base = matchesBase();
  const safeId = encodeURIComponent(String(playerId || '').trim());
  return base ? `${base}/elo_history/elo_history_${safeId}.json` : `elo_history/elo_history_${safeId}.json`;
}

function playerEloCacheKey(playerId) {
  return `elo_history_player_${String(playerId || '').trim()}`;
}

/**
 * Pull and cache per-player ELO history files for the provided player IDs.
 * Missing files are cached as { missing: true } so repeated reads are avoided.
 *
 * @param {string[]} playerIds
 * @returns {Promise<{ loadedPlayerIds: string[], missingPlayerIds: string[] }>}
 */
export async function pullEloHistoryForPlayerIds(playerIds = []) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return { loadedPlayerIds: [], missingPlayerIds: [] };

  const ids = [...new Set(playerIds.map(id => String(id || '').trim()).filter(Boolean))];
  const loadedPlayerIds = [];
  const missingPlayerIds = [];

  for (const playerId of ids) {
    const key = playerEloCacheKey(playerId);
    if (Cache.has(key)) {
      const cached = Cache.get(key);
      if (cached?.missing) missingPlayerIds.push(playerId);
      else loadedPlayerIds.push(playerId);
      continue;
    }
    try {
      const result = await readFile(playerEloHistoryPath(playerId));
      if (result?.content) {
        Cache.set(key, result.content);
        loadedPlayerIds.push(playerId);
      } else {
        Cache.set(key, { missing: true, playerId });
        missingPlayerIds.push(playerId);
      }
    } catch {
      Cache.set(key, { missing: true, playerId });
      missingPlayerIds.push(playerId);
    }
  }

  return { loadedPlayerIds, missingPlayerIds };
}

/**
 * Read cached per-player ELO histories for provided player IDs.
 * Returns only existing cached content (missing markers excluded).
 *
 * @param {string[]} playerIds
 * @returns {object[]} array of per-player elo history payloads
 */
export function getCachedEloHistoryForPlayerIds(playerIds = []) {
  const ids = [...new Set(playerIds.map(id => String(id || '').trim()).filter(Boolean))];
  const out = [];
  for (const playerId of ids) {
    const item = Cache.get(playerEloCacheKey(playerId));
    if (item && !item.missing) out.push(item);
  }
  return out;
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
  const localEntries = Store.getDoodle(yearMonth);
  let sha;
  let entriesToPush = localEntries;
  let remoteContent = null;
  try {
    const existing = await readFile(filePath);
    sha = existing?.sha;
    if (existing?.content && Array.isArray(existing.content)) {
      remoteContent = existing.content;
      // Merge: local entries take priority; preserve remote entries not in local store
      const localNames = new Set(localEntries.map(e => e.name));
      const remoteOnly = existing.content.filter(e => !localNames.has(e.name));
      entriesToPush = [...localEntries, ...remoteOnly];
      // Update local store so UI reflects merged state
      localStorage.setItem(`mexicano_doodle_${yearMonth}`, JSON.stringify(entriesToPush));
    }
  } catch { sha = undefined; }

  if (!sha || JSON.stringify(entriesToPush) !== JSON.stringify(remoteContent)) {
    await writeFile(filePath, entriesToPush, sha);
  } else {
  }

  const changelogKey = `doodle_changelog_${yearMonth}`;
  const changelogPath = keyToPath(changelogKey);
  if (!changelogPath) return;

  const localChangelog = Store.getDoodleChangelog(yearMonth);
  let changelogSha;
  let changelogToPush = Array.isArray(localChangelog) ? localChangelog : [];
  let remoteChangelog = null;
  let changelogMissing = false;
  try {
    const existing = await readFile(changelogPath);
    if (existing === null) {
      changelogMissing = true;
      changelogSha = undefined;
    } else {
      changelogSha = existing?.sha;
    }
    if (Array.isArray(existing?.content)) {
      remoteChangelog = existing.content;
      changelogToPush = mergeDoodleChangelogEntries(changelogToPush, existing.content);
    }
  } catch { changelogSha = undefined; }

  if (!changelogSha || JSON.stringify(changelogToPush) !== JSON.stringify(remoteChangelog)) {
    await writeFile(changelogPath, changelogToPush, changelogSha);
    localStorage.setItem(`mexicano_doodle_changelog_${yearMonth}`, JSON.stringify(changelogToPush));
    if (changelogMissing && changelogToPush.length === 0) {
    }
  } else {
  }
}

function changelogEntryKey(entry) {
  if (!entry || typeof entry !== 'object') return '';
  const player = String(entry.playerName || '');
  const stamp = String(entry.timestamp || '');
  const yearMonth = String(entry.yearMonth || '');
  const selectedAdded = Array.isArray(entry.selectedAdded) ? entry.selectedAdded.join(',') : '';
  const selectedRemoved = Array.isArray(entry.selectedRemoved) ? entry.selectedRemoved.join(',') : '';
  return `${stamp}|${player}|${yearMonth}|${selectedAdded}|${selectedRemoved}`;
}

function mergeDoodleChangelogEntries(localEntries = [], remoteEntries = []) {
  const map = new Map();
  for (const entry of [...localEntries, ...remoteEntries]) {
    if (!entry || typeof entry !== 'object') continue;
    const key = changelogEntryKey(entry);
    if (!key || map.has(key)) continue;
    map.set(key, entry);
  }

  const merged = [...map.values()];
  merged.sort((a, b) => {
    const at = Date.parse(a.timestamp || '') || 0;
    const bt = Date.parse(b.timestamp || '') || 0;
    return bt - at;
  });
  return merged;
}

/**
 * List all backup day-match files available in the GitHub backend.
 * Returns an array of { label, localPath } where localPath is the project-relative
 * path (e.g. "backup-data/2026/2026-04/2026-04-28.json").
 * The basePath prefix (e.g. "mexicano_v3/") is stripped from localPath.
 */
export async function listBackupFiles() {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) return [];

  const base = matchesBase(); // e.g. "mexicano_v3/backup-data"
  const yearDirs = await listContents(base);
  const results = [];

  for (const yearEntry of yearDirs.filter(e => e.type === 'dir' && /^\d{4}$/.test(e.name))) {
    const monthDirs = await listContents(`${base}/${yearEntry.name}`);
    for (const monthEntry of monthDirs.filter(e => e.type === 'dir' && /^\d{4}-\d{2}$/.test(e.name))) {
      const files = await listContents(`${base}/${yearEntry.name}/${monthEntry.name}`);
      for (const f of files.filter(e => e.type === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(e.name))) {
        // Strip basePath prefix up to and including the first path segment (e.g. "mexicano_v3/")
        // so the resulting path starts at "backup-data/..."
        const repoPath = f.path; // e.g. "mexicano_v3/backup-data/2026/2026-04/2026-04-28.json"
        const slashIdx = base.indexOf('/');
        const localPath = slashIdx >= 0 ? repoPath.slice(slashIdx + 1) : repoPath;
        results.push({ label: f.name.replace('.json', ''), localPath });
      }
    }
  }

  return results.sort((a, b) => b.label.localeCompare(a.label));
}
