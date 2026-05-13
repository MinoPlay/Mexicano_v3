/**
 * backfill-match-elos.mjs
 *
 * Reads all tournament day JSON files from backup-data, computes per-player
 * ELO after each match (chained across all tournament days), and writes
 * the ELO fields back into each match object.
 *
 * Usage:
 *   node scripts/backfill-match-elos.mjs [backup-data-path]
 *
 * Default path: ./backup-data (relative to repo root)
 * Idempotent: files where all matches already have ELO fields are skipped.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { processMatchElo, calculateAllEloRankings } from '../js/services/elo.js';

const BACKUP = process.argv[2] || './backup-data';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

function collectDayFiles(dir) {
  const files = [];
  function walk(d) {
    for (const e of readdirSync(d)) {
      const full = join(d, e);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (DATE_PATTERN.test(basename(full))) {
        files.push(full);
      }
    }
  }
  walk(dir);
  return files.sort(); // lexicographic = chronological for YYYY-MM-DD
}

function hasEloFields(match) {
  return match.Team1Player1Elo != null &&
    match.Team1Player2Elo != null &&
    match.Team2Player1Elo != null &&
    match.Team2Player2Elo != null;
}

const dayFiles = collectDayFiles(BACKUP);
console.log(`Found ${dayFiles.length} day files in ${BACKUP}`);

// Accumulate player states across ALL days in order
const playerStates = {};

let updatedCount = 0;
let skippedCount = 0;

for (const filePath of dayFiles) {
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!raw.matches || raw.matches.length === 0) {
    skippedCount++;
    continue;
  }

  // Check if all matches already have ELO embedded
  const allHaveElo = raw.matches.every(hasEloFields);

  // Still need to process for player state chaining even if skipping write
  const sortedMatches = [...raw.matches].sort((a, b) => a.RoundNumber - b.RoundNumber);

  for (const m of sortedMatches) {
    if (m.ScoreTeam1 === 0 && m.ScoreTeam2 === 0) continue;

    const matchForElo = {
      team1Player1Name: m.Team1Player1Name,
      team1Player2Name: m.Team1Player2Name,
      team2Player1Name: m.Team2Player1Name,
      team2Player2Name: m.Team2Player2Name,
      scoreTeam1: m.ScoreTeam1,
      scoreTeam2: m.ScoreTeam2,
      date: m.Date,
      roundNumber: m.RoundNumber,
    };

    processMatchElo(matchForElo, playerStates);

    if (!allHaveElo) {
      m.Team1Player1Elo = playerStates[m.Team1Player1Name]?.elo ?? null;
      m.Team1Player2Elo = playerStates[m.Team1Player2Name]?.elo ?? null;
      m.Team2Player1Elo = playerStates[m.Team2Player1Name]?.elo ?? null;
      m.Team2Player2Elo = playerStates[m.Team2Player2Name]?.elo ?? null;
    }
  }

  if (allHaveElo) {
    skippedCount++;
  } else {
    writeFileSync(filePath, JSON.stringify(raw, null, 2));
    updatedCount++;
    console.log(`  Updated: ${basename(filePath)}`);
  }
}

console.log(`\nDone. Updated ${updatedCount} files, skipped ${skippedCount} files.`);
