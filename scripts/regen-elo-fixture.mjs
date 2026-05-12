import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, basename } from 'path';
import { calculateAllEloRankings, getEloSnapshots } from '../js/services/elo.js';

const BACKUP = 'C:\\Private\\DataHub_Mexicano\\mexicano_v3\\backup-data';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}\.json$/;

function loadAllMatches(dir) {
  const all = [];
  function walk(d) {
    for (const e of readdirSync(d)) {
      const full = join(d, e);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (DATE_PATTERN.test(basename(full))) {
        const data = JSON.parse(readFileSync(full, 'utf8'));
        if (data.matches) {
          for (const m of data.matches) {
            all.push({
              date: m.Date, roundNumber: m.RoundNumber,
              scoreTeam1: m.ScoreTeam1, scoreTeam2: m.ScoreTeam2,
              team1Player1Name: m.Team1Player1Name, team1Player2Name: m.Team1Player2Name,
              team2Player1Name: m.Team2Player1Name, team2Player2Name: m.Team2Player2Name,
            });
          }
        }
      }
    }
  }
  walk(dir);
  return all;
}

const allMatches = loadAllMatches(BACKUP);
const { rankings } = calculateAllEloRankings(allMatches);
const { snapshots } = getEloSnapshots(allMatches);
const dates = [...new Set(allMatches.map(m => m.date))].sort();

// 3 sample isolated tournaments
const sampleDates = [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]];
const isolated = {};
for (const d of sampleDates) {
  const dm = allMatches.filter(m => m.date === d);
  const { rankings: r } = calculateAllEloRankings(dm);
  isolated[d] = r.map((p, i) => ({ name: p.name, elo: Math.round(p.elo * 100) / 100, place: i + 1 }));
}

const fixture = {
  matchCount: allMatches.length,
  playerCount: rankings.length,
  cumulative: rankings.map((p, i) => ({ name: p.name, elo: Math.round(p.elo * 100) / 100, place: i + 1 })),
  tournamentDates: dates,
  snapshots,
  isolatedTournaments: isolated,
};

writeFileSync('./tests/fixtures/elo-expected.json', JSON.stringify(fixture, null, 2));
console.log(`Written: ${allMatches.length} matches, ${rankings.length} players, ${dates.length} dates`);
