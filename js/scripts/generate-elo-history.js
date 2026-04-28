/**
 * generate-elo-history.js
 *
 * Reads all match files from GitHub, replays the full ELO timeline, and writes
 * backup-data/elo_history.json with a per-player ELO value for every tournament date.
 */

import {
  getConfig,
  matchesBase,
  pullAllMatches,
  readFile,
  writeFile,
  ghLog,
} from '../services/github.js';

/**
 * Generate elo_history.json from all match files. Always a full rebuild.
 *
 * @param {function} [onProgress] - called with (label, total, index)
 * @returns {Promise<{ written: number }>}
 */
export async function generateEloHistory(onProgress) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  const { getEloHistoryAllTime } = await import('../services/elo.js');

  onProgress?.('Loading all match files…', 0, 0);
  const allMatches = await pullAllMatches((label, total, idx) => onProgress?.(`Loading: ${label}`, total, idx));

  onProgress?.('Computing ELO history…', 1, 1);
  const history = getEloHistoryAllTime(allMatches);

  const output = {
    generatedAt: new Date().toISOString(),
    players: history.players,
    dates: history.dates,
  };

  const base = matchesBase();
  const eloHistoryPath = base ? `${base}/elo_history.json` : 'elo_history.json';
  onProgress?.('Writing elo_history.json…', 1, 1);
  const existing = await readFile(eloHistoryPath);
  await writeFile(eloHistoryPath, output, existing?.sha);

  const playerCount = Object.keys(output.players).length;
  ghLog('GENERATE_ELO_HISTORY', eloHistoryPath, `${playerCount} players`);
  return { written: playerCount };
}
