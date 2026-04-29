/**
 * generate-elo-history.js
 *
 * Reads all players_overview.json files from GitHub (one per month) and
 * reconstructs elo_history.json from the per-day ELO arrays stored in each
 * overview — no match-file traversal needed.
 *
 * Falls back to loading all match files only if the monthly overviews use
 * the legacy single-number ELO format (no array entries found at all).
 */

import {
  getConfig,
  matchesBase,
  listContents,
  readFile,
  writeFile,
  ghLog,
} from '../services/github.js';

/**
 * Generate elo_history.json from all monthly players_overview.json files.
 *
 * @param {function} [onProgress] - called with (label, total, index)
 * @returns {Promise<{ written: number }>}
 */
export async function generateEloHistory(onProgress) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  const base = matchesBase();

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

  // Check if overviews use the new array format; fall back to match-file
  // traversal if all ELO fields are legacy numbers.
  const hasArrayElo = overviews.some(o => o.rows.some(r => Array.isArray(r.ELO) && r.ELO.length > 0));

  if (!hasArrayElo) {
    // Legacy fallback: rebuild from match files (old behaviour)
    onProgress?.('Monthly overviews use legacy ELO format — loading match files…', 0, 0);
    const { pullAllMatches } = await import('../services/github.js');
    const { getEloHistoryAllTime } = await import('../services/elo.js');
    const allMatches = await pullAllMatches((label, total, idx) => onProgress?.(`Loading: ${label}`, total, idx));
    onProgress?.('Computing ELO history…', 1, 1);
    const history = getEloHistoryAllTime(allMatches);
    const output = { generatedAt: new Date().toISOString(), players: history.players, dates: history.dates };
    const eloHistoryPath = base ? `${base}/elo_history.json` : 'elo_history.json';
    onProgress?.('Writing elo_history.json…', 1, 1);
    const existing = await readFile(eloHistoryPath);
    await writeFile(eloHistoryPath, output, existing?.sha);
    const playerCount = Object.keys(output.players).length;
    ghLog('GENERATE_ELO_HISTORY', eloHistoryPath, `${playerCount} players (legacy rebuild)`);
    return { written: playerCount };
  }

  // ── 2. Build history from overview ELO arrays ────────────────────────────────
  onProgress?.('Computing ELO history from monthly overviews…', 1, 1);

  // players[name] = [{date, elo}] in chronological order (all months)
  const players = {};
  const dateSet = new Set();

  for (const { rows } of overviews) {
    for (const row of rows) {
      if (!row.Name || !Array.isArray(row.ELO)) continue;
      if (!players[row.Name]) players[row.Name] = [];
      for (const entry of row.ELO) {
        if (!entry.Date || entry.ELO == null) continue;
        players[row.Name].push({ date: entry.Date, elo: entry.ELO });
        dateSet.add(entry.Date);
      }
    }
  }

  // Sort each player's history and compute delta vs previous point
  const allDates = [...dateSet].sort();
  for (const pts of Object.values(players)) {
    pts.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[i - 1];
      pts[i].delta = prev ? Math.round((pts[i].elo - prev.elo) * 10) / 10 : 0;
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    players,
    dates: allDates,
  };

  // ── 3. Write elo_history.json ─────────────────────────────────────────────────
  const eloHistoryPath = base ? `${base}/elo_history.json` : 'elo_history.json';
  onProgress?.('Writing elo_history.json…', 1, 1);
  const existing = await readFile(eloHistoryPath);
  await writeFile(eloHistoryPath, output, existing?.sha);

  const playerCount = Object.keys(output.players).length;
  ghLog('GENERATE_ELO_HISTORY', eloHistoryPath, `${playerCount} players`);
  return { written: playerCount };
}
