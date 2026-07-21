/**
 * Attendance tracking derived from match data.
 */
import { Store } from '../store.js';

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
    [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name]
      .filter(Boolean)
      .forEach(n => add(m.date, n));
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
  const allMatches = Store.getMatches();
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
    [m.team1Player1Name, m.team1Player2Name, m.team2Player1Name, m.team2Player2Name]
      .forEach(n => add(m.date, n));
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
