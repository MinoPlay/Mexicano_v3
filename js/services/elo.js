/**
 * Classic ELO rating calculator for Mexicano padel.
 * K=32, initial=1000, combined opponent ELO via RMS.
 */
import { Store } from '../store.js';
import { isMatchComplete } from './tournament-shape.js';

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
    // Compute delta vs previous point
    for (let i = 0; i < historyMap[name].length; i++) {
      const prev = historyMap[name][i - 1];
      historyMap[name][i].delta = prev ? Math.round((historyMap[name][i].elo - prev.elo) * 10) / 10 : 0;
    }
  }

  return { players: historyMap, dates };
}

/**
 * Like getEloHistoryAllTime but filtered to last `months` calendar months.
 * Pass months=null for all time.
 * Each point includes a `delta` field (ELO change vs previous point for that player).
 */
export function getEloHistoryForPeriod(allMatches, months) {
  const full = getEloHistoryAllTime(allMatches);
  if (!months || !full.dates || full.dates.length === 0) return full;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const filteredDates = full.dates.filter(d => d >= cutoffStr);
  const filteredDateSet = new Set(filteredDates);

  const filteredPlayers = {};
  for (const [name, points] of Object.entries(full.players)) {
    const pts = points.filter(p => filteredDateSet.has(p.date));
    if (pts.length > 0) filteredPlayers[name] = pts;
  }

  return { players: filteredPlayers, dates: filteredDates };
}

/**
 * Like getEloHistoryForPeriod but filtered to a custom date range [fromStr, toStr] (YYYY-MM-DD).
 */
export function getEloHistoryForDateRange(allMatches, fromStr, toStr) {
  const full = getEloHistoryAllTime(allMatches);
  if (!full.dates || full.dates.length === 0) return full;

  const filteredDates = full.dates.filter(d => (!fromStr || d >= fromStr) && (!toStr || d <= toStr));
  const filteredDateSet = new Set(filteredDates);

  const filteredPlayers = {};
  for (const [name, points] of Object.entries(full.players)) {
    const pts = points.filter(p => filteredDateSet.has(p.date));
    if (pts.length > 0) filteredPlayers[name] = pts;
  }

  return { players: filteredPlayers, dates: filteredDates };
}

/**
 * Returns ELO history for the latest tournament that involved any of the given players.
 * Pass playerNames=null (or omit) to use the global latest tournament.
 *
 * seedElos: optional { playerName: startingElo } map.
 * When provided, players are pre-seeded with those ELOs and only the latest
 * tournament's matches are processed (no full-history replay needed).
 * This is the correct approach when per-player elo_history files are available.
 */
export function getEloHistoryForLatestTournament(allMatches, playerNames = null, seedElos = null) {
  const validMatches = allMatches.filter(m => !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0));
  if (validMatches.length === 0) return {};

  const sorted = [...validMatches].sort((a, b) => buildSortKey(a).localeCompare(buildSortKey(b)));

  const dates = [...new Set(sorted.map(m => m.date))].sort();

  // Find latest date where any of the selected players participated
  let latestDate;
  if (playerNames && playerNames.length > 0) {
    const playerSet = new Set(playerNames.map(n => n.toLowerCase()));
    const isInvolved = (m) =>
      [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name]
        .some(n => playerSet.has((n || '').toLowerCase()));
    const involvedDates = dates.filter(d => sorted.some(m => m.date === d && isInvolved(m)));
    latestDate = involvedDates.length > 0 ? involvedDates[involvedDates.length - 1] : dates[dates.length - 1];
  } else {
    latestDate = dates[dates.length - 1];
  }

  const players = {};
  const latestRounds = new Set();
  // Pre-tournament ELO per player (= round 0 on the chart)
  const preElos = {};

  if (seedElos) {
    // Pre-seed players from provided ELOs, then process only the latest tournament's matches
    for (const [name, elo] of Object.entries(seedElos)) {
      players[name] = { name, elo, history: [] };
      preElos[name] = elo;
    }
    for (const match of sorted.filter(m => m.date === latestDate)) {
      processMatchElo(match, players);
      latestRounds.add(match.roundNumber);
    }
  } else {
    // Fallback: replay all matches from scratch (requires full match history in allMatches)
    let snapped = false;
    for (const match of sorted) {
      if (!snapped && match.date === latestDate) {
        // Snapshot ELOs right before the latest tournament starts
        for (const [name, p] of Object.entries(players)) preElos[name] = p.elo;
        snapped = true;
      }
      processMatchElo(match, players);
      if (match.date === latestDate) {
        latestRounds.add(match.roundNumber);
      }
    }
  }

  const roundNumbers = [...latestRounds].sort((a, b) => a - b);

  const historyMap = {};
  for (const [name, player] of Object.entries(players)) {
    const latestEntries = player.history.filter(h => h.date === latestDate);
    if (latestEntries.length === 0) continue;

    historyMap[name] = [];
    // Round 0 = player's ELO before this tournament
    const preElo = preElos[name] !== undefined ? preElos[name] : INITIAL_ELO;
    historyMap[name].push({ round: 0, elo: preElo });
    for (const rn of roundNumbers) {
      const entry = latestEntries.filter(h => h.roundNumber === rn);
      if (entry.length > 0) {
        const last = entry[entry.length - 1];
        historyMap[name].push({ round: rn, elo: last.elo });
      }
    }
    // Compute delta vs previous round point
    for (let i = 0; i < historyMap[name].length; i++) {
      const prev = historyMap[name][i - 1];
      historyMap[name][i].delta = prev ? Math.round((historyMap[name][i].elo - prev.elo) * 10) / 10 : 0;
    }
  }

  return { players: historyMap, rounds: [0, ...roundNumbers] };
}

/**
 * Build latest-tournament ELO history from ELO fields embedded in match entities.
 * Requires matches to have team1Player1Elo, team1Player2Elo, team2Player1Elo, team2Player2Elo.
 * Returns { players: { name → [{round, elo, delta}] }, rounds: [roundNumbers] }
 */
export function getEloFromEmbeddedMatches(allMatches, date) {
  const tournamentMatches = (allMatches || []).filter(m => m.date === date);
  const sorted = [...tournamentMatches].sort((a, b) => a.roundNumber - b.roundNumber);
  const rounds = [...new Set(sorted.map(m => m.roundNumber))].sort((a, b) => a - b);

  const historyMap = {};
  for (const match of sorted) {
    const players = [
      { name: match.team1Player1Name, elo: match.team1Player1Elo },
      { name: match.team1Player2Name, elo: match.team1Player2Elo },
      { name: match.team2Player1Name, elo: match.team2Player1Elo },
      { name: match.team2Player2Name, elo: match.team2Player2Elo },
    ];
    for (const { name, elo } of players) {
      if (!name || elo == null) continue;
      if (!historyMap[name]) historyMap[name] = [];
      const existing = historyMap[name].find(e => e.round === match.roundNumber);
      if (existing) {
        existing.elo = elo;
      } else {
        historyMap[name].push({ round: match.roundNumber, elo });
      }
    }
  }

  for (const points of Object.values(historyMap)) {
    points.sort((a, b) => a.round - b.round);
    for (let i = 0; i < points.length; i++) {
      const prev = points[i - 1];
      points[i].delta = prev ? Math.round((points[i].elo - prev.elo) * 10) / 10 : 0;
    }
  }

  return { players: historyMap, rounds };
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

/**
 * Build per-player ELO snapshots at the end of each tournament date.
 * Returns { snapshots: { playerName: { date: elo } }, players }
 */
export function getEloSnapshots(allMatches) {
  const validMatches = allMatches.filter(m => !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0));
  const sorted = [...validMatches].sort((a, b) => buildSortKey(a).localeCompare(buildSortKey(b)));

  const players = {};
  for (const match of sorted) {
    processMatchElo(match, players);
  }

  const snapshots = {};
  for (const [name, player] of Object.entries(players)) {
    snapshots[name] = {};
    const dates = [...new Set(player.history.map(h => h.date))].sort();
    for (const date of dates) {
      const entries = player.history.filter(h => h.date === date);
      if (entries.length > 0) {
        snapshots[name][date] = entries[entries.length - 1].elo;
      }
    }
  }

  return { snapshots, players };
}

/**
 * Get ELO and ±ELO for each player at a specific tournament date.
 * ±ELO = change vs. the previous tournament date for that player.
 */
export function getEloForDate(snapshots, targetDate) {
  const result = {};
  for (const [name, dateMap] of Object.entries(snapshots)) {
    if (!(targetDate in dateMap)) continue;
    const dates = Object.keys(dateMap).sort();
    const idx = dates.indexOf(targetDate);
    const prevElo = idx > 0 ? dateMap[dates[idx - 1]] : INITIAL_ELO;
    result[name] = {
      elo: dateMap[targetDate],
      eloChange: Math.round((dateMap[targetDate] - prevElo) * 100) / 100,
    };
  }
  return result;
}

/**
 * Get ELO and ±ELO for each player at the end of a month (YYYY-MM).
 * ±ELO = change vs. end of the previous month.
 */
export function getEloForMonth(snapshots, yearMonth) {
  const result = {};
  for (const [name, dateMap] of Object.entries(snapshots)) {
    const dates = Object.keys(dateMap).sort();
    // Find the last date within this month
    const monthDates = dates.filter(d => d.startsWith(yearMonth));
    if (monthDates.length === 0) continue;
    const lastDateInMonth = monthDates[monthDates.length - 1];
    const elo = dateMap[lastDateInMonth];

    // Find the last date before this month for previous ELO
    const priorDates = dates.filter(d => d < yearMonth);
    const prevElo = priorDates.length > 0 ? dateMap[priorDates[priorDates.length - 1]] : INITIAL_ELO;

    result[name] = {
      elo,
      eloChange: Math.round((elo - prevElo) * 100) / 100,
    };
  }
  return result;
}

/**
 * Pre-tournament ELO per player, read from the players summary.
 * `eloDate` is the tournament date of a player's latest ELO row. When it equals
 * the tournament date the row already holds (part of) that tournament, so the
 * baseline is `previousElo`; when it is earlier, `elo` is the baseline.
 * Returns null if any baseline is unknown: a player missing from the summary,
 * or a later tournament that already rewrote the player's ELO.
 */
export function resolvePreTournamentElo(summary, date, names) {
  const byName = new Map((summary || []).map(p => [p.name, p]));
  const baseline = {};
  for (const name of names) {
    const entry = byName.get(name);
    if (!entry) return null;
    if (entry.eloDate && entry.eloDate > date) return null;
    baseline[name] = (entry.eloDate === date ? entry.previousElo : entry.elo) ?? INITIAL_ELO;
  }
  return baseline;
}

const matchPlayerNames = (match) =>
  [match.player1, match.player2, match.player3, match.player4].map(p => p?.name);

/**
 * Replays the completed matches of a tournament round by round from the
 * pre-tournament ELO (the same chain the completion flow uses), so editing a
 * result also moves the later rounds. Returns null when a baseline is unknown,
 * else { baseline, steps }: every completed match in play order with the ELO
 * of its four players before and after it.
 */
function replayTournamentElo(tournament, summary) {
  const scored = [];
  const rounds = [...(tournament.rounds || [])].sort((a, b) => a.roundNumber - b.roundNumber);
  for (const round of rounds) {
    for (const match of round.matches || []) {
      if (isMatchComplete(match) && matchPlayerNames(match).every(Boolean)) {
        scored.push({ match, roundNumber: round.roundNumber });
      }
    }
  }

  const allNames = [...new Set(scored.flatMap(({ match }) => matchPlayerNames(match)))];
  const baseline = resolvePreTournamentElo(summary, tournament.tournamentDate, allNames);
  if (!baseline) return null;

  const players = {};
  for (const name of allNames) players[name] = { name, elo: baseline[name], history: [] };

  const steps = scored.map(({ match, roundNumber }) => {
    const names = matchPlayerNames(match);
    const before = names.map(name => players[name].elo);
    processMatchElo({
      team1Player1Name: names[0],
      team1Player2Name: names[1],
      team2Player1Name: names[2],
      team2Player2Name: names[3],
      scoreTeam1: match.team1Score,
      scoreTeam2: match.team2Score,
      date: tournament.tournamentDate,
      roundNumber,
    }, players);
    return { match, roundNumber, names, before, after: names.map(name => players[name].elo) };
  });
  return { baseline, steps };
}

/**
 * ELO change of each player in every completed match of a tournament, as
 * Map<match, [p1, p2, p3, p4]>. Keyed by the match object because match ids
 * repeat across rounds. Empty when a baseline is unknown.
 */
export function calculateTournamentMatchEloChanges(tournament, summary) {
  const changes = new Map();
  for (const { match, before, after } of replayTournamentElo(tournament, summary)?.steps ?? []) {
    changes.set(match, after.map((elo, i) => Math.round((elo - before[i]) * 100) / 100));
  }
  return changes;
}

/**
 * ELO of every player through the rounds of a tournament, for a progression
 * chart. Same shape as getEloHistoryForLatestTournament: round 0 is the
 * pre-tournament ELO, then one point per round in which the player played a
 * completed match (a sit-out round has no point); delta is the change vs the
 * previous point, 1 decimal. Replays like calculateTournamentMatchEloChanges,
 * so chart and match badges agree. Null when a baseline is unknown.
 */
export function calculateTournamentEloProgression(tournament, summary) {
  const replay = replayTournamentElo(tournament, summary);
  if (!replay) return null;

  const players = {};
  for (const [name, elo] of Object.entries(replay.baseline)) players[name] = [{ round: 0, elo, delta: 0 }];
  for (const { roundNumber, names, after } of replay.steps) {
    names.forEach((name, i) => {
      const points = players[name];
      const previous = points[points.length - 1];
      points.push({ round: roundNumber, elo: after[i], delta: Math.round((after[i] - previous.elo) * 10) / 10 });
    });
  }

  const rounds = [...new Set(replay.steps.map(step => step.roundNumber))];
  return { players, rounds: rounds.length ? [0, ...rounds] : [] };
}
