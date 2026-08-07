/**
 * Runtime derivation of all NON-raw data from raw matches.
 *
 * The Supabase backend stores ONLY raw source-of-truth (matches, players
 * registry, active tournament, doodle, attendance, changelog). Everything the
 * old GitHub backend pre-computed into JSON files is instead derived here at
 * runtime:
 *   - players_summary          (ELO + aggregate stats)
 *   - monthly_YYYY-MM overview (per-month stats)
 *   - tournaments index        (per-date metadata)
 *   - tournament_dates         (sorted distinct dates)
 *   - per-player ELO history   (elo-charts payload shape)
 *
 * Pure functions only — no I/O — so they are unit-testable and reusable by the
 * Supabase backend module.
 */
import { processMatchElo } from './elo.js';
import { calculatePlayerStatistics } from './statistics.js';

const round2 = (n) => Math.round(n * 100) / 100;

/** Chronological sort by date then round number. */
export function sortMatchesChrono(matches) {
  return [...matches].sort((a, b) =>
    a.date === b.date ? (a.roundNumber - b.roundNumber) : a.date.localeCompare(b.date)
  );
}

/**
 * Replay every match through the classic ELO calculator.
 * @returns {Object<string,{name,elo,history:Array<{date,roundNumber,elo}>}>}
 */
export function computeEloPlayers(matches) {
  const players = {};
  for (const m of sortMatchesChrono(matches)) {
    if (m.scoreTeam1 === 0 && m.scoreTeam2 === 0) continue; // unplayed
    processMatchElo(m, players);
  }
  return players;
}

/** Per-player final ELO map { name -> elo }. */
export function computeFinalElo(matches) {
  const players = computeEloPlayers(matches);
  const out = {};
  for (const [name, p] of Object.entries(players)) out[name] = round2(p.elo);
  return out;
}

/**
 * Per-player ELO as of the end of the SECOND-TO-LAST tournament day that the
 * player took part in (i.e. their ELO before the latest tournament they played).
 * Players with a single tournament — or none — map to the 1000 baseline.
 * @returns {Object<string,number>}
 */
export function computePreviousElo(matches) {
  const players = computeEloPlayers(matches);
  const out = {};
  for (const [name, p] of Object.entries(players)) {
    const dates = [...new Set(p.history.map(h => h.date))].sort();
    if (dates.length <= 1) {
      out[name] = 1000;
      continue;
    }
    const prevDate = dates[dates.length - 2];
    const entries = p.history.filter(h => h.date === prevDate);
    out[name] = round2(entries[entries.length - 1].elo);
  }
  return out;
}

/**
 * Build the players_summary array (Store.getPlayersSummary shape).
 * Merges the registry (so name-only players appear) with derived stats + ELO.
 * @param {Array} matches - all camelCase matches
 * @param {Array} [registry] - [{name, matchPadelId}]
 */
export function buildPlayersSummary(matches, registry = []) {
  const stats = calculatePlayerStatistics(matches);
  const statByName = new Map(stats.map(s => [s.name, s]));
  const eloMap = computeFinalElo(matches);
  const prevEloMap = computePreviousElo(matches);

  // Count distinct tournament days each player appears in.
  const daysByPlayer = new Map();
  for (const m of matches) {
    for (const n of [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name]) {
      if (!n) continue;
      if (!daysByPlayer.has(n)) daysByPlayer.set(n, new Set());
      daysByPlayer.get(n).add(m.date);
    }
  }

  const registryByName = new Map((registry || []).map(r => [r.name, r]));
  const names = new Set([...statByName.keys(), ...registryByName.keys(), ...Object.keys(eloMap)]);

  const summary = [];
  for (const name of names) {
    const s = statByName.get(name);
    const reg = registryByName.get(name);
    summary.push({
      id: name, // runtime id == name (elo-charts maps ids -> names)
      name,
      elo: eloMap[name] ?? 1000,
      previousElo: prevEloMap[name] ?? 1000,
      wins: s?.wins ?? 0,
      losses: s?.losses ?? 0,
      points: s?.points ?? 0,
      average: s?.average ?? 0,
      tournaments: daysByPlayer.get(name)?.size ?? 0,
      matchPadelId: reg?.matchPadelId ?? null,
    });
  }
  summary.sort((a, b) => (b.points - a.points) || (b.wins - a.wins) || a.name.localeCompare(b.name));
  return summary;
}

/**
 * Per-player ELO as of the END of a given month (YYYY-MM): the last history
 * entry on or before that month. Players with no matches by then are omitted.
 * @returns {Object<string,number>}
 */
export function computeMonthEndElo(matches, yearMonth) {
  const players = computeEloPlayers(matches);
  const out = {};
  for (const [name, p] of Object.entries(players)) {
    const upto = p.history.filter(h => (h.date || '').slice(0, 7) <= yearMonth);
    if (upto.length) out[name] = round2(upto[upto.length - 1].elo);
  }
  return out;
}

/**
 * Build a single month's overview (Store.getMonthlyOverview shape):
 * [{ name, totalPoints, wins, losses, average, elo }]
 * ELO is the player's rating as of the END of that month, so month-over-month
 * comparisons in the UI produce a real delta.
 */
export function buildMonthlyOverview(matches, yearMonth) {
  const monthMatches = matches.filter(m => (m.date || '').slice(0, 7) === yearMonth);
  const stats = calculatePlayerStatistics(monthMatches);
  const eloMap = computeMonthEndElo(matches, yearMonth);
  return stats.map(s => ({
    name: s.name,
    totalPoints: s.points,
    wins: s.wins,
    losses: s.losses,
    average: s.average,
    elo: eloMap[s.name] ?? 1000,
  }));
}

/** Sorted list of distinct tournament dates. */
export function computeTournamentDates(matches) {
  return [...new Set(matches.map(m => m.date).filter(Boolean))].sort();
}

/**
 * Tournaments index entries (Store.getTournamentsIndex shape):
 * [{ date, playerCount, roundCount, matchCount, completedCount, isComplete }]
 * A match counts as "completed" when its scores sum to 25.
 */
export function buildTournamentsIndex(matches) {
  const byDate = new Map();
  for (const m of matches) {
    if (!m.date) continue;
    if (!byDate.has(m.date)) byDate.set(m.date, []);
    byDate.get(m.date).push(m);
  }
  const entries = [];
  for (const [date, dayMatches] of byDate) {
    const players = new Set();
    const rounds = new Set();
    let completed = 0;
    for (const m of dayMatches) {
      for (const n of [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name]) {
        if (n) players.add(n);
      }
      if (m.roundNumber != null) rounds.add(m.roundNumber);
      if ((m.scoreTeam1 ?? 0) + (m.scoreTeam2 ?? 0) === 25) completed++;
    }
    entries.push({
      date,
      playerCount: players.size,
      roundCount: rounds.size,
      matchCount: dayMatches.length,
      completedCount: completed,
      isComplete: dayMatches.length > 0 && completed === dayMatches.length,
    });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}

/**
 * Per-player ELO history file payload (elo-charts mergePlayerHistoryFiles shape):
 * { playerName, points: [{ date, elo, delta }] }
 * One point per tournament day (last round of that day), with day-over-day delta.
 */
export function buildEloHistoryFile(matches, playerName) {
  const players = computeEloPlayers(matches);
  const p = players[playerName];
  if (!p) return { playerName, points: [] };

  // Reduce per-round history to one point per date (final ELO that day).
  const byDate = new Map();
  for (const h of p.history) byDate.set(h.date, h.elo);
  const dates = [...byDate.keys()].sort();

  const points = [];
  let prev = null;
  for (const date of dates) {
    const elo = round2(byDate.get(date));
    points.push({ date, elo, delta: prev == null ? 0 : round2(elo - prev) });
    prev = elo;
  }
  return { playerName, points };
}
