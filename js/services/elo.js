/**
 * Classic ELO rating calculator for Mexicano padel.
 * K=32, initial=1000, combined opponent ELO via RMS.
 */
import { Store } from '../store.js';

const K = 32;
const INITIAL_ELO = 1000;

export function calculateCombinedOpponentElo(opp1Elo, opp2Elo) {
  return Math.sqrt((opp1Elo * opp1Elo + opp2Elo * opp2Elo) / 2);
}

export function calculateExpectedScore(playerElo, opponentElo) {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
}

export function calculateClassicElo(playerElo, opp1Elo, opp2Elo, didWin) {
  const combinedOpp = calculateCombinedOpponentElo(opp1Elo, opp2Elo);
  const expected = calculateExpectedScore(playerElo, combinedOpp);
  const actual = didWin ? 1 : 0;
  const newElo = playerElo + K * (actual - expected);
  return Math.round(newElo * 100) / 100;
}

export function processMatchElo(match, players) {
  const { team1Player1Name, team1Player2Name, team2Player1Name, team2Player2Name, scoreTeam1, scoreTeam2 } = match;
  const team1Won = scoreTeam1 > scoreTeam2;

  const ensurePlayer = (name) => {
    if (!players[name]) {
      players[name] = { name, elo: INITIAL_ELO, history: [] };
    }
  };

  ensurePlayer(team1Player1Name);
  ensurePlayer(team1Player2Name);
  ensurePlayer(team2Player1Name);
  ensurePlayer(team2Player2Name);

  // P1 (team1 player1)
  const p1 = players[team1Player1Name];
  p1.elo = calculateClassicElo(p1.elo, players[team2Player1Name].elo, players[team2Player2Name].elo, team1Won);
  p1.history.push({ date: match.date, roundNumber: match.roundNumber, elo: p1.elo });

  // P2 (team1 player2)
  const p2 = players[team1Player2Name];
  p2.elo = calculateClassicElo(p2.elo, players[team2Player1Name].elo, players[team2Player2Name].elo, team1Won);
  p2.history.push({ date: match.date, roundNumber: match.roundNumber, elo: p2.elo });

  // P3 (team2 player1)
  const p3 = players[team2Player1Name];
  p3.elo = calculateClassicElo(p3.elo, players[team1Player1Name].elo, players[team1Player2Name].elo, !team1Won);
  p3.history.push({ date: match.date, roundNumber: match.roundNumber, elo: p3.elo });

  // P4 (team2 player2)
  const p4 = players[team2Player2Name];
  p4.elo = calculateClassicElo(p4.elo, players[team1Player1Name].elo, players[team1Player2Name].elo, !team1Won);
  p4.history.push({ date: match.date, roundNumber: match.roundNumber, elo: p4.elo });
}

function buildSortKey(match) {
  const rn = String(match.roundNumber).padStart(2, '0');
  return `${match.date}.${rn}`;
}

export function calculateAllEloRankings(allMatches) {
  const validMatches = allMatches.filter(m => !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0));

  const sorted = [...validMatches].sort((a, b) => buildSortKey(a).localeCompare(buildSortKey(b)));

  const players = {};
  for (const match of sorted) {
    processMatchElo(match, players);
  }

  const rankings = Object.values(players)
    .sort((a, b) => b.elo - a.elo)
    .map((p, idx) => ({
      place: idx + 1,
      name: p.name,
      elo: p.elo,
      change: calculateEloChange(p)
    }));

  return { rankings, players };
}

export function getEloHistoryAllTime(allMatches) {
  const validMatches = allMatches.filter(m => !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0));
  const sorted = [...validMatches].sort((a, b) => buildSortKey(a).localeCompare(buildSortKey(b)));

  const players = {};
  const dateSet = new Set(sorted.map(m => m.date));
  const dates = [...dateSet].sort();

  // Process all matches
  for (const match of sorted) {
    processMatchElo(match, players);
  }

  // Build history map: name → [{date, elo}] with snapshot at end of each tournament date
  const historyMap = {};
  for (const [name, player] of Object.entries(players)) {
    historyMap[name] = [];
    for (const date of dates) {
      const entriesForDate = player.history.filter(h => h.date === date);
      if (entriesForDate.length > 0) {
        const lastEntry = entriesForDate[entriesForDate.length - 1];
        historyMap[name].push({ date, elo: lastEntry.elo });
      }
    }
  }

  return { players: historyMap, dates };
}

export function getEloHistoryForLatestTournament(allMatches) {
  const validMatches = allMatches.filter(m => !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0));
  if (validMatches.length === 0) return {};

  const sorted = [...validMatches].sort((a, b) => buildSortKey(a).localeCompare(buildSortKey(b)));

  const dates = [...new Set(sorted.map(m => m.date))].sort();
  const latestDate = dates[dates.length - 1];

  // Process all matches up to and including the latest tournament
  const players = {};
  const latestRounds = new Set();

  for (const match of sorted) {
    processMatchElo(match, players);
    if (match.date === latestDate) {
      latestRounds.add(match.roundNumber);
    }
  }

  const roundNumbers = [...latestRounds].sort((a, b) => a - b);

  const historyMap = {};
  for (const [name, player] of Object.entries(players)) {
    const latestEntries = player.history.filter(h => h.date === latestDate);
    if (latestEntries.length === 0) continue;

    historyMap[name] = [];
    for (const rn of roundNumbers) {
      const entry = latestEntries.filter(h => h.roundNumber === rn);
      if (entry.length > 0) {
        const last = entry[entry.length - 1];
        historyMap[name].push({ round: rn, elo: last.elo });
      }
    }
  }

  return { players: historyMap, rounds: roundNumbers };
}

export function calculateEloChange(player) {
  if (!player.history || player.history.length === 0) return 0;

  const dates = [...new Set(player.history.map(h => h.date))].sort();
  if (dates.length <= 1) {
    // Only one tournament — change is from initial
    return Math.round((player.elo - INITIAL_ELO) * 100) / 100;
  }

  const previousDate = dates[dates.length - 2];
  const previousEntries = player.history.filter(h => h.date === previousDate);
  const previousElo = previousEntries.length > 0
    ? previousEntries[previousEntries.length - 1].elo
    : INITIAL_ELO;

  return Math.round((player.elo - previousElo) * 100) / 100;
}
