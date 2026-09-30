/**
 * Attendance tracking derived from match data.
 */
import { Store } from '../store.js';

/**
 * Rows describing who played when. Prefers the lightweight participation rows
 * ({ date, players }) loaded for attendance; falls back to full match rows.
 */
export function getParticipationRows() {
  const participation = Store.getParticipation();
  return participation.length ? participation : Store.getMatches();
}

/** Names of everyone in a participation row or a match row. */
function participantsOf(row) {
  if (Array.isArray(row.players)) return row.players;
  return [row.team1Player1Name, row.team1Player2Name, row.team2Player1Name, row.team2Player2Name];
}

/** Normalize manual attendance entries to a clean array. */
function normalizeManual(manualEntries) {
  return (manualEntries || []).filter(
    e => e && typeof e.date === 'string' && Array.isArray(e.players) && e.players.length
  );
}

/**
 * Build per-date participation for a single month from matches + manual entries.
 * Returns { datePlayerMap: {date -> Set<name>}, tournamentDates: sorted string[] }.
 * Used by the doodle Player Overview and the attendance calendar.
 */
export function buildMonthParticipation(matches, manualEntries, yearMonth) {
  const datePlayerMap = {};
  const add = (date, name) => {
    if (!name) return;
    if (!datePlayerMap[date]) datePlayerMap[date] = new Set();
    datePlayerMap[date].add(name);
  };

  for (const m of matches || []) {
    if (!m.date || !m.date.startsWith(yearMonth)) continue;
    participantsOf(m).filter(Boolean).forEach(n => add(m.date, n));
  }

  for (const entry of normalizeManual(manualEntries)) {
    if (!entry.date.startsWith(yearMonth)) continue;
    entry.players.forEach(n => add(entry.date, n));
  }

  return { datePlayerMap, tournamentDates: Object.keys(datePlayerMap).sort() };
}

/**
 * Insert/replace a manual attendance entry.
 * Rejects tournament dates and empty player lists; dedupes players; sorts by date.
 * Pure — returns a new entries array.
 */
export function upsertManualEntry(entries, { date, players }, tournamentDates = []) {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('A valid date (YYYY-MM-DD) is required');
  }
  if ((tournamentDates || []).includes(date)) {
    throw new Error(`${date} already has a tournament — manual attendance not allowed`);
  }
  const cleaned = [...new Set((players || []).map(p => (p || '').trim()).filter(Boolean))].sort();
  if (!cleaned.length) {
    throw new Error('At least one player is required');
  }
  const rest = (entries || []).filter(e => e.date !== date);
  return [...rest, { date, players: cleaned }].sort((a, b) => a.date.localeCompare(b.date));
}

export function getMonthlyAttendance(year, month, manualEntries) {
  const allMatches = getParticipationRows();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const manual = manualEntries === undefined ? Store.getManualAttendance() : manualEntries;

  const { datePlayerMap } = buildMonthParticipation(allMatches, manual, prefix);

  return Object.entries(datePlayerMap)
    .map(([date, playerSet]) => ({
      date,
      players: [...playerSet].sort(),
      playerCount: playerSet.size
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getAttendanceStatistics(matches, cutoffDate = null, manualEntries) {
  const filtered = cutoffDate
    ? matches.filter(m => m.date <= cutoffDate)
    : matches;
  const manual = manualEntries === undefined ? Store.getManualAttendance() : manualEntries;

  // Group by date to find unique session dates (tournaments + manual)
  const datePlayerMap = {};
  const add = (date, name) => {
    if (!name) return;
    if (!datePlayerMap[date]) datePlayerMap[date] = new Set();
    datePlayerMap[date].add(name);
  };

  for (const m of filtered) {
    participantsOf(m).forEach(n => add(m.date, n));
  }
  for (const entry of normalizeManual(manual)) {
    if (cutoffDate && entry.date > cutoffDate) continue;
    entry.players.forEach(n => add(entry.date, n));
  }

  const totalTournaments = Object.keys(datePlayerMap).length;

  // Count per player
  const playerCounts = {};
  for (const [, players] of Object.entries(datePlayerMap)) {
    for (const name of players) {
      playerCounts[name] = (playerCounts[name] || 0) + 1;
    }
  }

  return Object.entries(playerCounts)
    .map(([playerName, attendanceCount]) => ({
      playerName,
      attendanceCount,
      attendancePercentage: totalTournaments > 0
        ? Math.round((attendanceCount / totalTournaments) * 100 * 100) / 100
        : 0,
      totalTournaments
    }))
    .sort((a, b) => b.attendanceCount - a.attendanceCount || a.playerName.localeCompare(b.playerName));
}

/**
 * Per-player attendance counts by month for one year (distinct dates per player).
 * @returns {{ years:number[], sessions:number[], players:{name,months:number[],total}[] }}
 */
export function buildYearMatrix(rows, year) {
  const years = new Set();
  const dates = new Set();
  const byPlayer = new Map();
  const seen = new Set();
  for (const r of rows || []) {
    if (!r?.date) continue;
    const y = Number(r.date.slice(0, 4));
    years.add(y);
    if (y !== Number(year)) continue;
    dates.add(r.date);
    const mi = Number(r.date.slice(5, 7)) - 1;
    for (const name of r.players || []) {
      const k = `${name}|${r.date}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!byPlayer.has(name)) byPlayer.set(name, { name, months: new Array(12).fill(0), total: 0 });
      const p = byPlayer.get(name);
      p.months[mi]++;
      p.total++;
    }
  }
  const sessions = new Array(12).fill(0);
  for (const d of dates) sessions[Number(d.slice(5, 7)) - 1]++;
  return {
    years: [...years].sort((a, b) => b - a),
    sessions,
    players: [...byPlayer.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
  };
}
