/**
 * generate-monthly-overviews.js
 *
 * Reads day-match files for the selected month, seeds starting ELO from the
 * previous month's players_overview.json, and writes
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

  // ── 1. Seed ELO from previous months' players_overview.json ─────────────────
  // Reads the immediately preceding month first.  For players absent from that
  // month (skipped months), walks backwards through older months on GitHub
  // (newest first) until every player has a seed.  This ensures players who
  // haven't played recently still carry their correct all-time ELO instead of
  // falling back to the 1000 default.
  const prevDate = new Date(parseInt(year, 10), parseInt(yearMonth.slice(5, 7), 10) - 1, 0);
  const prevYm = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  /** Extract a single ELO number from a raw overview row (array or number). */
  function lastEloFromRow(row) {
    if (!row || row.ELO == null) return null;
    if (Array.isArray(row.ELO)) return row.ELO.length > 0 ? row.ELO[row.ELO.length - 1].ELO : null;
    return row.ELO;
  }

  /** Read one month's overview from GitHub and return a name→elo map. */
  async function readOverviewElos(ym) {
    try {
      const path = `${prefix}${ym.slice(0, 4)}/${ym}/players_overview.json`;
      const result = await readFile(path);
      if (!result?.content || !Array.isArray(result.content)) return {};
      const map = {};
      for (const p of result.content) {
        const elo = lastEloFromRow(p);
        if (p.Name && elo != null) map[p.Name] = elo;
      }
      return map;
    } catch {
      return {};
    }
  }

  /** Decrement a YYYY-MM string by one month. */
  function prevMonth(ym) {
    const d = new Date(parseInt(ym.slice(0, 4), 10), parseInt(ym.slice(5, 7), 10) - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  const eloState = {};

  onProgress?.(`Reading previous month ELO (${prevYm})…`, 0, 0);
  const prevElos = await readOverviewElos(prevYm);
  Object.assign(eloState, prevElos);

  /**
   * For players still missing from eloState after we have loaded the current
   * month's matches, walk backwards through older months on GitHub to find
   * their last known ELO.
   */
  async function backfillMissingElos(playerNames) {
    const missing = new Set(playerNames.filter(n => !(n in eloState)));
    if (missing.size === 0) return;

    // Walk back at most 36 months (3 years) to avoid runaway API calls.
    const LOOK_BACK_MONTHS = 36;
    let cursor = prevMonth(prevYm);
    for (let i = 0; i < LOOK_BACK_MONTHS && missing.size > 0; i++) {
      onProgress?.(`Backfilling ELO seeds from ${cursor}…`, 0, 0);
      const elos = await readOverviewElos(cursor);
      for (const name of [...missing]) {
        if (elos[name] != null) {
          eloState[name] = elos[name];
          missing.delete(name);
        }
      }
      cursor = prevMonth(cursor);
    }
    // Any still-missing players will receive INITIAL_ELO when first encountered.
  }

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

  // Backfill ELO seeds for players absent from the previous month by walking
  // back through older months on GitHub (fixes skipped-month ELO reset bug).
  const allPlayerNames = [...new Set(valid.flatMap(m => [
    m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name,
  ]))];
  await backfillMissingElos(allPlayerNames);

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
