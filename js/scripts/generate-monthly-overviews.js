/**
 * generate-monthly-overviews.js
 *
 * Reads day-match files for the selected month, seeds starting ELO from each
 * player's individual elo_history file, and writes
 * backup-data/YYYY/YYYY-MM/players_overview.json.
 *
 * ELO is stored as an array of { Date, ELO } snapshots (one per tournament day).
 */

import {
  getConfig,
  matchesBase,
  readFile,
  listContents,
  writeFile,
  fromBackupMatch,
  ghLog,
} from '../services/github.js';

/**
 * Generate players_overview.json for a single month.
 *
 * @param {string}   yearMonth  - 'YYYY-MM'
 * @param {function} [onProgress] - called with (label, total, index)
 * @returns {Promise<{ written: number, month: string }>}
 */
export async function generateMonthlyOverviews(yearMonth, onProgress) {
  const cfg = getConfig();
  if (!cfg?.owner || !cfg?.repo || !cfg?.pat) throw new Error('GitHub not configured');
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) throw new Error('yearMonth must be YYYY-MM');

  const { calculateClassicElo } = await import('../services/elo.js');

  const INITIAL_ELO = 1000;
  const base = matchesBase();
  const year = yearMonth.slice(0, 4);
  const prefix = base ? `${base}/` : '';

  // ── 1. Build name→id map from players.json ────────────────────────────────
  onProgress?.(`Reading players.json…`, 0, 0);
  const playersResult = await readFile(`${prefix}players.json`);
  const playerIdMap = {};
  if (Array.isArray(playersResult?.content)) {
    for (const p of playersResult.content) {
      if (p.Name && p.Id) playerIdMap[p.Name] = p.Id;
    }
  }

  /**
   * Return the last known ELO for a player strictly before `yearMonth`
   * by reading their individual elo_history file.
   * Returns null if no prior history exists.
   */
  async function seedFromHistory(name) {
    const id = playerIdMap[name];
    if (!id) return null;
    try {
      const result = await readFile(`${prefix}elo_history/elo_history_${id}.json`);
      const points = result?.content?.points;
      if (!Array.isArray(points) || points.length === 0) return null;
      let lastElo = null;
      for (const e of points) {
        if (e.date < yearMonth) lastElo = e.elo;
        else break;
      }
      return lastElo;
    } catch {
      return null;
    }
  }

  const eloState = {};

  // ── 2. Load only this month's match files ────────────────────────────────────
  onProgress?.(`Loading ${yearMonth} match files…`, 0, 0);
  const monthDir = `${prefix}${year}/${yearMonth}`;
  const dirContents = await listContents(monthDir);
  const dayFiles = dirContents.filter(f => f.type === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(f.name));

  if (dayFiles.length === 0) throw new Error(`No match files found for ${yearMonth}`);

  const monthMatches = [];
  for (const f of dayFiles) {
    const result = await readFile(f.path);
    if (result?.content?.matches) {
      for (const m of result.content.matches) {
        monthMatches.push(fromBackupMatch(m));
      }
    }
  }

  const valid = monthMatches.filter(m => !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0));
  if (valid.length === 0) throw new Error(`No valid matches found for ${yearMonth}`);

  valid.sort((a, b) => {
    const ak = `${a.date}.${String(a.roundNumber).padStart(2, '0')}`;
    const bk = `${b.date}.${String(b.roundNumber).padStart(2, '0')}`;
    return ak.localeCompare(bk);
  });

  // Seed ELO for all players from their individual elo_history files.
  // Players with no prior history will receive INITIAL_ELO when first encountered.
  const allPlayerNames = [...new Set(valid.flatMap(m => [
    m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name,
  ]))];
  for (const name of allPlayerNames) {
    const elo = await seedFromHistory(name);
    if (elo != null) eloState[name] = elo;
  }

  // ── 3. Compute stats + replay ELO per tournament day ─────────────────────────
  onProgress?.(`Computing stats for ${yearMonth}…`, 1, 1);
  const monthStats = {};

  // Group matches by tournament date
  const matchesByDay = new Map();
  for (const m of valid) {
    if (!matchesByDay.has(m.date)) matchesByDay.set(m.date, []);
    matchesByDay.get(m.date).push(m);
  }
  const sortedDays = [...matchesByDay.keys()].sort();

  // elo_snapshots[name] = [{Date, ELO}, ...] — one entry per tournament day
  const eloSnapshots = {};

  for (const day of sortedDays) {
    const dayMatches = matchesByDay.get(day);
    const dayPlayers = new Set();

    // Accumulate stats and replay ELO for all matches on this day
    for (const m of dayMatches) {
      const { team1Player1Name: t1p1, team1Player2Name: t1p2, team2Player1Name: t2p1, team2Player2Name: t2p2, scoreTeam1, scoreTeam2 } = m;
      const team1Won = scoreTeam1 > scoreTeam2;

      for (const name of [t1p1, t1p2]) {
        if (!monthStats[name]) monthStats[name] = { points: 0, wins: 0, losses: 0, games: 0 };
        monthStats[name].points += scoreTeam1;
        monthStats[name].games++;
        if (team1Won) monthStats[name].wins++; else monthStats[name].losses++;
      }
      for (const name of [t2p1, t2p2]) {
        if (!monthStats[name]) monthStats[name] = { points: 0, wins: 0, losses: 0, games: 0 };
        monthStats[name].points += scoreTeam2;
        monthStats[name].games++;
        if (!team1Won) monthStats[name].wins++; else monthStats[name].losses++;
      }

      // Seed ELO for brand-new players (never seen before) — defaults to 1000
      for (const name of [t1p1, t1p2, t2p1, t2p2]) {
        if (!(name in eloState)) eloState[name] = INITIAL_ELO;
        dayPlayers.add(name);
      }

      // ELO replay — sequential update order matching Python
      const t2p1Elo = eloState[t2p1];
      const t2p2Elo = eloState[t2p2];
      eloState[t1p1] = calculateClassicElo(eloState[t1p1], t2p1Elo, t2p2Elo, team1Won);
      eloState[t1p2] = calculateClassicElo(eloState[t1p2], t2p1Elo, t2p2Elo, team1Won);
      eloState[t2p1] = calculateClassicElo(t2p1Elo, eloState[t1p1], eloState[t1p2], !team1Won);
      eloState[t2p2] = calculateClassicElo(t2p2Elo, eloState[t1p1], eloState[t1p2], !team1Won);
    }

    // Snapshot ELO for each player who played today
    for (const name of dayPlayers) {
      if (!eloSnapshots[name]) eloSnapshots[name] = [];
      eloSnapshots[name].push({ Date: day, ELO: eloState[name] });
    }
  }

  const overview = Object.entries(monthStats).map(([name, stats]) => {
    const snapshots = eloSnapshots[name] ?? [{ Date: yearMonth + '-01', ELO: eloState[name] ?? INITIAL_ELO }];
    return {
      Name: name,
      Total_Points: stats.points,
      Wins: stats.wins,
      Losses: stats.losses,
      Average: stats.games > 0 ? Math.round(stats.points / stats.games * 100) / 100 : 0,
      ELO: snapshots,
    };
  });
  overview.sort((a, b) => {
    const aElo = a.ELO[a.ELO.length - 1]?.ELO ?? INITIAL_ELO;
    const bElo = b.ELO[b.ELO.length - 1]?.ELO ?? INITIAL_ELO;
    return bElo - aElo;
  });

  // ── 4. Write result ───────────────────────────────────────────────────────────
  const path = `${prefix}${year}/${yearMonth}/players_overview.json`;
  onProgress?.(`Writing ${yearMonth}/players_overview.json…`, 1, 1);
  const existing = await readFile(path);
  await writeFile(path, overview, existing?.sha);

  ghLog('GENERATE_MONTHLY_OVERVIEWS', path, `${overview.length} players`);
  return { written: 1, month: yearMonth };
}
