/**
 * Helper: load all match data from backup directory.
 * Mirrors the C# fixture generator's loading logic.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

const BACKUP_DIR = 'C:\\Private\\DataHub\\mexicano_v3\\backup-data';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

export function loadAllMatches(backupDir = BACKUP_DIR) {
  const allMatches = [];

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (DATE_PATTERN.test(basename(full))) {
        const data = JSON.parse(readFileSync(full, 'utf8'));
        if (data.matches) {
          for (const m of data.matches) {
            allMatches.push({
              date: m.Date,
              roundNumber: m.RoundNumber,
              scoreTeam1: m.ScoreTeam1,
              scoreTeam2: m.ScoreTeam2,
              team1Player1Name: m.Team1Player1Name,
              team1Player2Name: m.Team1Player2Name,
              team2Player1Name: m.Team2Player1Name,
              team2Player2Name: m.Team2Player2Name,
            });
          }
        }
      }
    }
  }

  walk(backupDir);
  return allMatches;
}

export function loadMatchesForDate(date, backupDir = BACKUP_DIR) {
  const allMatches = loadAllMatches(backupDir);
  return allMatches.filter(m => m.date === date);
}
