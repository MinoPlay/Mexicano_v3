/**
 * generate-elo-history.js
 *
 * Reads monthly players_overview.json files from GitHub and writes per-player
 * ELO history files:
 *   backup-data/elo_history/elo_history_{playerId}.json
 */

import {
  getConfig,
  matchesBase,
  listContents,
  readFile,
  writeFile,
  ghLog,
} from '../services/github.js';

function normalizePlayerKey(name) {
  return String(name || '').trim().toLowerCase();
}

function playerEloHistoryPath(base, playerId) {
  const safeId = encodeURIComponent(playerId);
  return base ? `${base}/elo_history/elo_history_${safeId}.json` : `elo_history/elo_history_${safeId}.json`;
}

function normalizeOptions(onProgress, options) {
  if (typeof onProgress === 'function' || onProgress == null) {
    return { onProgress, options: options || {} };
  }
  return { onProgress: undefined, options: onProgress || {} };
}

/**
 * Generate per-player ELO history files from all monthly players_overview.json files.
 *
 * @param {function|object} [onProgress] - callback or options object
 * @param {object} [options]
 * @param {string[]} [options.playerIds] - optional subset of player IDs to write
 * @returns {Promise<{ written: number, playerIds: string[] }>}
 */
export async function generateEloHistory(onProgress, options) {
  const normalized = normalizeOptions(onProgress, options);
  onProgress = normalized.onProgress;
  options = normalized.options;

  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  const base = matchesBase();
  const playersPath = base ? `${base}/players.json` : 'players.json';

  onProgress?.('Reading players.json…', 0, 0);
  const playersResult = await readFile(playersPath);
  if (!playersResult?.content || !Array.isArray(playersResult.content) || playersResult.content.length === 0) {
    throw new Error('players.json not found or empty — generate players.json first.');
  }

  const playerMetaByKey = new Map(); // normalized name -> { id, name }
  for (const row of playersResult.content) {
    const key = normalizePlayerKey(row?.Name);
    if (!key) continue;
    const id = typeof row?.Id === 'string' && row.Id.trim() ? row.Id.trim() : '';
    if (!id) throw new Error(`players.json missing Id for "${row?.Name || 'unknown'}". Regenerate players.json first.`);
    if (!playerMetaByKey.has(key)) {
      playerMetaByKey.set(key, { id, name: row.Name });
      continue;
    }
    const existing = playerMetaByKey.get(key);
    if (existing.id !== id) {
      throw new Error(`players.json contains conflicting Id values for "${row.Name}".`);
    }
  }

  const allPlayerIds = [...new Set([...playerMetaByKey.values()].map(p => p.id))];
  const requested = Array.isArray(options.playerIds)
    ? [...new Set(options.playerIds.map(id => String(id || '').trim()).filter(Boolean))]
    : allPlayerIds;
  const targetIds = requested.filter(id => allPlayerIds.includes(id));

  if (targetIds.length === 0) return { written: 0, playerIds: [] };

  // ── 1. Discover all monthly overview files ───────────────────────────────────
  onProgress?.('Listing year directories…', 0, 0);
  const yearDirs = await listContents(base);

  const overviews = []; // [{ yearMonth, rows }]
  for (const yearEntry of yearDirs.filter(e => e.type === 'dir' && /^\d{4}$/.test(e.name))) {
    const monthDirs = await listContents(`${base}/${yearEntry.name}`);
    for (const monthEntry of monthDirs.filter(e => e.type === 'dir' && /^\d{4}-\d{2}$/.test(e.name))) {
      onProgress?.(`Reading ${monthEntry.name}/players_overview.json…`, 0, 0);
      const overviewPath = `${base}/${yearEntry.name}/${monthEntry.name}/players_overview.json`;
      const result = await readFile(overviewPath).catch(() => null);
      if (result?.content && Array.isArray(result.content) && result.content.length > 0) {
        overviews.push({ yearMonth: monthEntry.name, rows: result.content });
      }
    }
  }

  if (overviews.length === 0) throw new Error('No players_overview.json files found — generate monthly overviews first.');
  overviews.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));

  // ── 2. Build per-player points from monthly overviews ────────────────────────
  onProgress?.('Computing per-player ELO history…', 1, 1);
  const pointsById = {}; // playerId -> [{date, elo, delta}]
  const unknownNames = new Set();

  for (const playerId of targetIds) pointsById[playerId] = [];

  for (const { rows } of overviews) {
    for (const row of rows) {
      if (!row?.Name || !Array.isArray(row.ELO)) continue;
      const meta = playerMetaByKey.get(normalizePlayerKey(row.Name));
      if (!meta) {
        unknownNames.add(row.Name);
        continue;
      }
      if (!pointsById[meta.id]) continue;
      for (const entry of row.ELO) {
        if (!entry?.Date || entry.ELO == null) continue;
        pointsById[meta.id].push({ date: entry.Date, elo: entry.ELO });
      }
    }
  }

  if (unknownNames.size > 0) {
    throw new Error(`players_overview.json has player(s) missing in players.json: ${[...unknownNames].sort().join(', ')}`);
  }

  for (const playerId of targetIds) {
    const points = pointsById[playerId] || [];
    points.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < points.length; i++) {
      const prev = points[i - 1];
      points[i].delta = prev ? Math.round((points[i].elo - prev.elo) * 10) / 10 : 0;
    }
  }

  // ── 3. Write per-player files ────────────────────────────────────────────────
  const byIdToName = new Map([...playerMetaByKey.values()].map(p => [p.id, p.name]));
  let written = 0;
  const writtenIds = [];
  for (let i = 0; i < targetIds.length; i++) {
    const playerId = targetIds[i];
    const playerName = byIdToName.get(playerId) || '';
    const points = pointsById[playerId] || [];
    const output = {
      generatedAt: new Date().toISOString(),
      playerId,
      playerName,
      points,
      dates: points.map(p => p.date),
    };

    const path = playerEloHistoryPath(base, playerId);
    onProgress?.(`Writing elo_history_${playerId}.json…`, targetIds.length, i + 1);
    const existing = await readFile(path).catch(() => null);
    await writeFile(path, output, existing?.sha);
    written++;
    writtenIds.push(playerId);
  }

  ghLog('GENERATE_ELO_HISTORY', `${base || '.'}/elo_history`, `${written} player files`);
  return { written, playerIds: writtenIds };
}
