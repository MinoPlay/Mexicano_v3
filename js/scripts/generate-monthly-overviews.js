/**
 * generate-monthly-overviews.js
 *
 * Reads day-match files for the selected month, seeds starting ELO from the
 * previous month's players_overview.json, and writes
 * backup-data/YYYY/YYYY-MM/players_overview.json.
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

  // ── 1. Seed ELO from previous month's players_overview.json ─────────────────
  const prevDate = new Date(parseInt(year, 10), parseInt(yearMonth.slice(5, 7), 10) - 1, 0);
  const prevYm = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const eloState = {};

  onProgress?.(`Reading previous month ELO (${prevYm})…`, 0, 0);
  try {
    const prevPath = `${prefix}${prevYm.slice(0, 4)}/${prevYm}/players_overview.json`;
    const prevResult = await readFile(prevPath);
    if (prevResult?.content && Array.isArray(prevResult.content)) {
      for (const p of prevResult.content) {
        if (p.Name && p.ELO != null) eloState[p.Name] = p.ELO;
      }
    }
  } catch { /* prev month may not exist — all players start at 1000 */ }

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

  // ── 3. Compute stats + replay ELO for this month ─────────────────────────────
  onProgress?.(`Computing stats for ${yearMonth}…`, 1, 1);
  const monthStats = {};

  for (const m of valid) {
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

    // ELO replay — sequential update order matching Python
    for (const name of [t1p1, t1p2, t2p1, t2p2]) {
      if (!(name in eloState)) eloState[name] = INITIAL_ELO;
    }
    const t2p1Elo = eloState[t2p1];
    const t2p2Elo = eloState[t2p2];
    eloState[t1p1] = calculateClassicElo(eloState[t1p1], t2p1Elo, t2p2Elo, team1Won);
    eloState[t1p2] = calculateClassicElo(eloState[t1p2], t2p1Elo, t2p2Elo, team1Won);
    eloState[t2p1] = calculateClassicElo(t2p1Elo, eloState[t1p1], eloState[t1p2], !team1Won);
    eloState[t2p2] = calculateClassicElo(t2p2Elo, eloState[t1p1], eloState[t1p2], !team1Won);
  }

  const overview = Object.entries(monthStats).map(([name, stats]) => ({
    Name: name,
    Total_Points: stats.points,
    Wins: stats.wins,
    Losses: stats.losses,
    Average: stats.games > 0 ? Math.round(stats.points / stats.games * 100) / 100 : 0,
    ELO: eloState[name] ?? INITIAL_ELO,
  }));
  overview.sort((a, b) => b.ELO - a.ELO);

  // ── 4. Write result ───────────────────────────────────────────────────────────
  const path = `${prefix}${year}/${yearMonth}/players_overview.json`;
  onProgress?.(`Writing ${yearMonth}/players_overview.json…`, 1, 1);
  const existing = await readFile(path);
  await writeFile(path, overview, existing?.sha);

  ghLog('GENERATE_MONTHLY_OVERVIEWS', path, `${overview.length} players`);
  return { written: 1, month: yearMonth };
}
