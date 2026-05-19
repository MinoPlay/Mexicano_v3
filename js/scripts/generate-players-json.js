/**
 * generate-players-json.js
 *
 * Aggregates all monthly players_overview.json files from GitHub and writes
 * backup-data/players.json sorted by player name ascending.
 *
 * Output shape: [{ Name, ELO, PreviousELO, Wins, Losses, TotalPoints, Average, Tournaments }]
 */

import {
  getConfig,
  matchesBase,
  listContents,
  readFile,
  writeFile,
} from '../services/github.js';

function normalizePlayerKey(name) {
  return String(name || '').trim().toLowerCase();
}

function createRandomPlayerId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : ((r & 0x3) | 0x8);
    return v.toString(16);
  });
}

/**
 * Generate players.json by aggregating all monthly players_overview.json files.
 *
 * @param {function} [onProgress] - called with (label, total, index)
 * @param {object}   [options]
 * @param {string[]} [options.playerNames] - when set, only recompute these players;
 *   non-participants keep their existing players.json entry unchanged
 * @returns {Promise<{ written: number }>}
 */
export async function generatePlayersJson(onProgress, options) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  // Normalise optional options arg (onProgress may be omitted)
  if (typeof onProgress !== 'function' && onProgress != null) {
    options = onProgress;
    onProgress = undefined;
  }
  options = options || {};
  const participantSet = Array.isArray(options.playerNames)
    ? new Set(options.playerNames.map(n => normalizePlayerKey(n)).filter(Boolean))
    : null; // null = rebuild all players

  const base        = matchesBase();
  const playersPath = base ? `${base}/players.json` : 'players.json';
  const existingPlayersResult = await readFile(playersPath).catch(() => null);
  const existingPlayers = Array.isArray(existingPlayersResult?.content) ? existingPlayersResult.content : [];
  const existingIdByKey = new Map();

  for (const row of existingPlayers) {
    if (!row?.Name) continue;
    const key = normalizePlayerKey(row.Name);
    if (!key) continue;
    const id = typeof row.Id === 'string' && row.Id.trim() ? row.Id.trim() : null;
    if (!existingIdByKey.has(key)) {
      existingIdByKey.set(key, id);
      continue;
    }
    const prior = existingIdByKey.get(key);
    if (prior && id && prior !== id) {
      throw new Error(`players.json contains conflicting Id values for "${row.Name}".`);
    }
    if (!prior && id) existingIdByKey.set(key, id);
  }

  // ── 1. Discover all players_overview.json files ───────────────────────────
  onProgress?.('Listing year directories…', 0, 0);
  const yearDirs = await listContents(base);

  const overviews = []; // [{ yearMonth, rows }]
  for (const yearEntry of yearDirs.filter(e => e.type === 'dir' && /^\d{4}$/.test(e.name))) {
    const monthDirs = await listContents(`${base}/${yearEntry.name}`);
    for (const monthEntry of monthDirs.filter(e => e.type === 'dir' && /^\d{4}-\d{2}$/.test(e.name))) {
      onProgress?.(`Reading ${monthEntry.name}…`, 0, 0);
      const overviewPath = `${base}/${yearEntry.name}/${monthEntry.name}/players_overview.json`;
      const result = await readFile(overviewPath).catch(() => null);
      if (result?.content && Array.isArray(result.content) && result.content.length > 0) {
        overviews.push({ yearMonth: monthEntry.name, rows: result.content });
      }
    }
  }

  if (overviews.length === 0) throw new Error('No players_overview.json files found — generate monthly overviews first.');
  overviews.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

  // ── 2. Aggregate per-player stats across all months ───────────────────────
  const playerTotals = {}; // name → { wins, losses, pts }
  const playerMonths = {}; // name → [{yearMonth, elo}] in chronological order
  const playerDays   = {}; // name → [{date, elo}] all tournament days across all months

  for (const { yearMonth, rows } of overviews) {
    for (const p of rows) {
      const name = p.Name;
      if (!name) continue;
      if (!playerTotals[name]) playerTotals[name] = { wins: 0, losses: 0, pts: 0 };
      if (!playerMonths[name]) playerMonths[name] = [];
      if (!playerDays[name])   playerDays[name]   = [];
      playerTotals[name].wins   += p.Wins         ?? 0;
      playerTotals[name].losses += p.Losses       ?? 0;
      playerTotals[name].pts    += p.Total_Points ?? 0;
      playerMonths[name].push({ yearMonth, elo: Array.isArray(p.ELO) ? (p.ELO.length > 0 ? p.ELO[p.ELO.length - 1].ELO : 1000) : (p.ELO ?? 1000) });
      // Collect all per-day ELO entries for fine-grained PreviousELO computation
      if (Array.isArray(p.ELO)) {
        for (const entry of p.ELO) {
          if (entry.Date && entry.ELO != null) {
            playerDays[name].push({ date: entry.Date, elo: entry.ELO });
          }
        }
      }
    }
  }

  // ── 3. Build result ───────────────────────────────────────────────────────
  const canonicalNames = new Map();
  for (const name of Object.keys(playerTotals)) {
    const key = normalizePlayerKey(name);
    if (!key) continue;
    if (!canonicalNames.has(key)) {
      canonicalNames.set(key, name);
      continue;
    }
    if (canonicalNames.get(key) !== name) {
      throw new Error(`Player name collision after normalization: "${canonicalNames.get(key)}" and "${name}".`);
    }
  }

  // Index existing players.json entries by normalised name for partial-update lookups.
  const existingByKey = new Map();
  for (const row of existingPlayers) {
    if (!row?.Name) continue;
    const key = normalizePlayerKey(row.Name);
    if (key && !existingByKey.has(key)) existingByKey.set(key, row);
  }

  const recomputed = Object.entries(playerTotals)
    .map(([name, s]) => {
      const key = normalizePlayerKey(name);

      // When playerNames filter is active, non-participants keep their existing entry.
      if (participantSet !== null && !participantSet.has(key)) {
        const existing = existingByKey.get(key);
        if (existing) return existing;
        // If no existing entry, fall through to compute (new player in old data).
      }

      const months = playerMonths[name];
      const elo    = months[months.length - 1].elo;
      // Use per-day granularity when available so that PreviousELO reflects the
      // second-to-last tournament day, not the second-to-last month.
      const days    = (playerDays[name] || []).sort((a, b) => a.date.localeCompare(b.date));
      const prevElo = days.length >= 2
        ? days[days.length - 2].elo
        : (months.length >= 2 ? months[months.length - 2].elo : elo);
      const games   = s.wins + s.losses;
      let id = existingIdByKey.get(key);
      if (!id) {
        id = createRandomPlayerId();
        existingIdByKey.set(key, id);
      }
      return {
        Id:          id,
        Name:        name,
        ELO:         elo,
        PreviousELO: prevElo,
        Wins:        s.wins,
        Losses:      s.losses,
        TotalPoints: s.pts,
        Average:     games > 0 ? Math.round(s.pts / games * 100) / 100 : 0,
        // Count individual tournament days (one ELO snapshot per day in overview).
        // Fall back to months count when no day-level ELO data exists (old scalar format).
        Tournaments: days.length > 0 ? days.length : months.length,
      };
    })
    .sort((a, b) => (a.Name || '').localeCompare(b.Name || ''));

  const result = recomputed;

  // ── 4. Write players.json ─────────────────────────────────────────────────
  onProgress?.('Writing players.json…', 1, 1);
  await writeFile(playersPath, result, existingPlayersResult?.sha);

  return { written: result.length };
}
