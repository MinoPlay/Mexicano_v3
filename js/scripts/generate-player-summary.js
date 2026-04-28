/**
 * generate-player-summary.js
 *
 * Generates or incrementally updates the statistics summary file for a single
 * player. Writes backup-data/players_summaries/summary_<name>.json to GitHub.
 */

import { Store } from '../store.js';
import {
  getConfig,
  readFile,
  writeFile,
  readDayMatches,
  fetchTournamentsIndex,
  playerSummaryPath,
  mergeSummary,
} from '../services/github.js';

/**
 * Generate or incrementally update the summary for a single player.
 *
 * @param {string}   playerName
 * @param {function} [onProgress] - called with (label, total, index)
 * @returns {Promise<{ newDates: number, upToDate: boolean }>}
 */
export async function generateOrUpdatePlayerSummary(playerName, onProgress) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');

  const { generatePlayerSummary, calculateOpponentStats, calculatePartnershipStats } =
    await import('../services/statistics.js');

  // Read existing summary (for incremental mode + sha)
  const path = playerSummaryPath(playerName);
  let existingSummary = null;
  let existingSha = null;
  try {
    const result = await readFile(path);
    if (result?.content) {
      existingSummary = result.content;
      existingSha = result.sha;
    }
  } catch { /* file may not exist yet */ }

  const lastProcessedDate = existingSummary?.lastProcessedDate ?? null;

  // Get all known tournament dates
  let allDates = Store.getTournamentsIndex().map(e => e.date);
  if (allDates.length === 0) {
    allDates = JSON.parse(localStorage.getItem('mexicano_tournament_dates') || '[]');
  }
  if (allDates.length === 0) {
    const entries = await fetchTournamentsIndex({ create: true });
    allDates = (entries || []).map(e => e.date);
  }
  allDates.sort();

  // Only process dates not yet included
  const newDates = lastProcessedDate
    ? allDates.filter(d => d > lastProcessedDate)
    : allDates;

  if (newDates.length === 0) {
    return { newDates: 0, upToDate: true };
  }

  // Fetch matches for new dates only
  const newMatches = [];
  for (let i = 0; i < newDates.length; i++) {
    onProgress?.(`Fetching ${newDates[i]}`, newDates.length, i + 1);
    const dayMatches = await readDayMatches(newDates[i]);
    newMatches.push(...dayMatches);
  }

  // Compute delta stats from new matches only
  const deltaSummary  = generatePlayerSummary(playerName, newMatches);
  const deltaOpps     = calculateOpponentStats(playerName, newMatches);
  const deltaParts    = calculatePartnershipStats(playerName, newMatches);
  const delta = { ...deltaSummary, opponents: deltaOpps, partners: deltaParts };

  const newLastDate = newDates[newDates.length - 1];

  // Merge or create
  const payload = existingSummary
    ? mergeSummary(existingSummary, delta, newLastDate)
    : {
        playerName,
        generatedAt:           new Date().toISOString(),
        lastProcessedDate:     newLastDate,
        totalTournaments:      deltaSummary.totalTournaments,
        totalWins:             deltaSummary.totalWins,
        totalLosses:           deltaSummary.totalLosses,
        totalPoints:           deltaSummary.totalPoints,
        tightWins:             deltaSummary.tightWins,
        solidWins:             deltaSummary.solidWins,
        dominatingWins:        deltaSummary.dominatingWins,
        firstPlaceFinishes:    deltaSummary.firstPlaceFinishes,
        secondPlaceFinishes:   deltaSummary.secondPlaceFinishes,
        thirdPlaceFinishes:    deltaSummary.thirdPlaceFinishes,
        opponents:             deltaOpps,
        partners:              deltaParts,
      };

  onProgress?.(`Writing summary…`, newDates.length, newDates.length);
  await writeFile(path, payload, existingSha ?? undefined);

  return { newDates: newDates.length, upToDate: false };
}
