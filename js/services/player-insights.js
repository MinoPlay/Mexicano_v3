/**
 * Player-centric view models for the desktop Players hub, Compare and heatmaps.
 * Pure functions over the flat match list (0-0 matches ignored).
 */
import {
  involvesPlayer,
  getPlayerTeamScore,
  getOpponentTeamScore,
  getPartner,
  getOpponents,
  calculateOpponentStats,
  calculatePartnershipStats,
  generatePlayerSummary,
} from './statistics.js';
import { processMatchElo } from './elo.js';

const INITIAL_ELO = 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const pct = (w, g) => (g > 0 ? r2((w / g) * 100) : 0);

function validSorted(matches) {
  return matches
    .filter(m => !(m.scoreTeam1 === 0 && m.scoreTeam2 === 0))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.roundNumber - b.roundNumber));
}

function namesOf(m) {
  return [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name];
}

/** Run ELO over sorted matches; returns { players, eloAtDateEnd: Map<date, Map<name, elo>> }. */
function runElo(sorted) {
  const players = {};
  const dates = [];
  const endOfDate = new Map();
  for (let i = 0; i < sorted.length; i++) {
    processMatchElo(sorted[i], players);
    const d = sorted[i].date;
    if (i === sorted.length - 1 || sorted[i + 1].date !== d) {
      dates.push(d);
      endOfDate.set(d, new Map(Object.values(players).map(p => [p.name, p.elo])));
    }
  }
  return { players, dates, endOfDate };
}

function placementsByDate(sorted) {
  const byDate = new Map();
  for (const m of sorted) {
    if (!byDate.has(m.date)) byDate.set(m.date, {});
    const acc = byDate.get(m.date);
    for (const n of namesOf(m)) {
      if (!acc[n]) acc[n] = { points: 0, wins: 0, games: 0 };
      const my = getPlayerTeamScore(m, n);
      acc[n].points += my;
      acc[n].games++;
      if (my > getOpponentTeamScore(m, n)) acc[n].wins++;
    }
  }
  const out = new Map();
  for (const [date, acc] of byDate) {
    const ranked = Object.entries(acc)
      .sort(([, a], [, b]) => b.points - a.points || b.wins - a.wins)
      .map(([name, s], i) => ({ name, place: i + 1, ...s }));
    out.set(date, ranked);
  }
  return out;
}

export function buildPlayerRows(matches, { recentTournaments = 10, formGames = 10, sparkPoints = 20 } = {}) {
  const sorted = validSorted(matches);
  if (!sorted.length) return [];
  const { players, dates, endOfDate } = runElo(sorted);
  const placements = placementsByDate(sorted);

  const windowDates = dates.slice(-recentTournaments);
  const windowSet = new Set(windowDates);
  const beforeWindow = dates[dates.length - windowDates.length - 1];
  const eloBefore = beforeWindow ? endOfDate.get(beforeWindow) : new Map();

  const acc = {};
  for (const m of sorted) {
    for (const n of namesOf(m)) {
      if (!acc[n]) acc[n] = { games: 0, wins: 0, points: 0, dates: new Set(), results: [], last: null };
      const a = acc[n];
      const my = getPlayerTeamScore(m, n);
      const won = my > getOpponentTeamScore(m, n);
      a.games++;
      a.points += my;
      if (won) a.wins++;
      a.dates.add(m.date);
      a.results.push(won ? 'W' : 'L');
      a.last = m.date;
    }
  }

  const firsts = {};
  const podiums = {};
  for (const ranked of placements.values()) {
    for (const r of ranked) {
      if (r.place === 1) firsts[r.name] = (firsts[r.name] || 0) + 1;
      if (r.place <= 3) podiums[r.name] = (podiums[r.name] || 0) + 1;
    }
  }

  const rows = Object.entries(acc).map(([name, a]) => {
    const p = players[name];
    const playedInWindow = [...a.dates].some(d => windowSet.has(d));
    const startElo = eloBefore.get(name) ?? INITIAL_ELO;
    const attended = windowDates.filter(d => a.dates.has(d)).length;
    const perDate = [];
    for (const d of dates) {
      if (a.dates.has(d)) perDate.push(endOfDate.get(d).get(name));
    }
    return {
      name,
      elo: r2(p.elo),
      eloDelta: playedInWindow ? r2(p.elo - startElo) : 0,
      tournaments: a.dates.size,
      games: a.games,
      wins: a.wins,
      losses: a.games - a.wins,
      winRate: pct(a.wins, a.games),
      avgPoints: r2(a.points / a.games),
      firsts: firsts[name] || 0,
      podiums: podiums[name] || 0,
      lastPlayed: a.last,
      attendance: windowDates.length ? Math.round((attended / windowDates.length) * 100) : 0,
      form: a.results.slice(-formGames),
      spark: perDate.slice(-sparkPoints),
    };
  });

  return rows.sort((a, b) => b.elo - a.elo || a.name.localeCompare(b.name));
}

function pickBy(list, minGames, key, dir) {
  const eligible = list.filter(x => x.gamesPlayed >= minGames);
  if (!eligible.length) return null;
  return eligible.reduce((best, x) => {
    const better = dir === 'max'
      ? (x[key] > best[key] || (x[key] === best[key] && x.gamesPlayed > best.gamesPlayed))
      : (x[key] < best[key] || (x[key] === best[key] && x.gamesPlayed > best.gamesPlayed));
    return better ? x : best;
  });
}

export function buildPlayerDetail(name, matches, { minGames = 3, recent = 15 } = {}) {
  const sorted = validSorted(matches);
  const mine = sorted.filter(m => involvesPlayer(m, name));
  const partners = calculatePartnershipStats(name, sorted).sort((a, b) => b.winRate - a.winRate || b.gamesPlayed - a.gamesPlayed);
  const opponents = calculateOpponentStats(name, sorted).sort((a, b) => a.winRate - b.winRate || b.gamesPlayed - a.gamesPlayed);

  const { dates, endOfDate } = runElo(sorted);
  const myDates = new Set(mine.map(m => m.date));
  const eloHistory = dates.filter(d => myDates.has(d)).map(d => ({ date: d, elo: r2(endOfDate.get(d).get(name)) }));

  const placements = placementsByDate(sorted);
  const tournaments = [...myDates].sort((a, b) => b.localeCompare(a)).map(date => {
    const ranked = placements.get(date);
    const me = ranked.find(r => r.name === name);
    return { date, place: me.place, of: ranked.length, points: me.points, wins: me.wins, games: me.games };
  });

  const recentMatches = mine.slice(-recent).reverse().map(m => ({
    date: m.date,
    round: m.roundNumber,
    partner: getPartner(m, name),
    opponents: getOpponents(m, name),
    score: getPlayerTeamScore(m, name),
    oppScore: getOpponentTeamScore(m, name),
    won: getPlayerTeamScore(m, name) > getOpponentTeamScore(m, name),
  }));

  return {
    name,
    summary: generatePlayerSummary(name, sorted),
    eloHistory,
    partners,
    opponents,
    bestPartner: pickBy(partners, minGames, 'winRate', 'max'),
    worstPartner: pickBy(partners, minGames, 'winRate', 'min'),
    nemesis: pickBy(opponents, minGames, 'winRate', 'min'),
    favoriteVictim: pickBy(opponents, minGames, 'winRate', 'max'),
    tournaments,
    recentMatches,
  };
}

export function buildPairMatrix(matches, names, mode = 'partner') {
  const set = new Set(names);
  const raw = {};
  for (const a of names) raw[a] = {};
  for (const m of validSorted(matches)) {
    for (const a of namesOf(m)) {
      if (!set.has(a)) continue;
      const won = getPlayerTeamScore(m, a) > getOpponentTeamScore(m, a);
      const others = mode === 'partner' ? [getPartner(m, a)] : getOpponents(m, a);
      for (const b of others) {
        if (!set.has(b) || b === a) continue;
        const c = raw[a][b] || (raw[a][b] = { games: 0, wins: 0 });
        c.games++;
        if (won) c.wins++;
      }
    }
  }
  const cells = {};
  for (const a of names) {
    cells[a] = {};
    for (const b of names) {
      const c = a === b ? null : raw[a][b];
      cells[a][b] = c ? { games: c.games, wins: c.wins, winRate: pct(c.wins, c.games) } : null;
    }
  }
  return { names, cells };
}

export function buildHeadToHead(a, b, matches) {
  const against = { games: 0, aWins: 0, bWins: 0 };
  const together = { games: 0, wins: 0, winRate: 0 };
  for (const m of validSorted(matches)) {
    if (!involvesPlayer(m, a) || !involvesPlayer(m, b)) continue;
    const aWon = getPlayerTeamScore(m, a) > getOpponentTeamScore(m, a);
    if (getPartner(m, a) === b) {
      together.games++;
      if (aWon) together.wins++;
    } else {
      against.games++;
      if (aWon) against.aWins++; else against.bWins++;
    }
  }
  together.winRate = pct(together.wins, together.games);
  return { against, together };
}

export function eloMovers(matches, { date } = {}) {
  const sorted = validSorted(matches);
  const { dates, endOfDate } = runElo(sorted);
  const target = date || dates[dates.length - 1];
  const idx = dates.indexOf(target);
  if (idx < 0) return { date: target || null, rows: [] };
  const prev = idx > 0 ? endOfDate.get(dates[idx - 1]) : new Map();
  const after = endOfDate.get(target);
  const played = new Set(sorted.filter(m => m.date === target).flatMap(namesOf));
  const rows = [...played].map(name => {
    const before = prev.get(name) ?? INITIAL_ELO;
    const a = after.get(name);
    return { name, before: r2(before), after: r2(a), delta: r2(a - before) };
  }).sort((x, y) => y.delta - x.delta || x.name.localeCompare(y.name));
  return { date: target, rows };
}

function statusLabel(e) {
  if (e.isComplete) return 'Complete';
  if (e.completedCount > 0) return `${e.completedCount}/${e.matchCount}`;
  return 'Pending';
}

/** Tournaments index enriched with results from match history, newest first. */
export function buildTournamentRows(index, matches) {
  const sorted = validSorted(matches);
  const placements = placementsByDate(sorted);
  const counts = new Map();
  for (const m of sorted) {
    const c = counts.get(m.date) || { matches: 0, points: 0 };
    c.matches++;
    c.points += (Number(m.scoreTeam1) || 0) + (Number(m.scoreTeam2) || 0);
    counts.set(m.date, c);
  }
  return [...index]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(e => {
      const ranked = placements.get(e.date) || [];
      const c = counts.get(e.date) || { matches: 0, points: 0 };
      return {
        date: e.date,
        year: e.date.slice(0, 4),
        players: e.playerCount || ranked.length,
        rounds: e.roundCount || 0,
        matches: c.matches,
        totalPoints: c.points,
        winner: ranked[0]?.name ?? null,
        winnerPoints: ranked[0]?.points ?? null,
        runnerUp: ranked[1]?.name ?? null,
        status: statusLabel(e),
        isComplete: !!e.isComplete,
      };
    });
}
