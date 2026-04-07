/**
 * Attendance tracking derived from match data.
 */
import { Store } from '../store.js';

export function getMonthlyAttendance(year, month) {
  const allMatches = Store.getMatches();
  const prefix = `${year}-${String(month).padStart(2, '0')}`;

  const dateMap = {};
  for (const m of allMatches) {
    if (!m.date || !m.date.startsWith(prefix)) continue;
    if (!dateMap[m.date]) dateMap[m.date] = new Set();
    dateMap[m.date].add(m.team1Player1Name);
    dateMap[m.date].add(m.team1Player2Name);
    dateMap[m.date].add(m.team2Player1Name);
    dateMap[m.date].add(m.team2Player2Name);
  }

  return Object.entries(dateMap)
    .map(([date, playerSet]) => ({
      date,
      players: [...playerSet].sort(),
      playerCount: playerSet.size
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getAttendanceStatistics(matches, cutoffDate = null) {
  const filtered = cutoffDate
    ? matches.filter(m => m.date <= cutoffDate)
    : matches;

  // Group by date to find unique tournament dates
  const datePlayerMap = {};
  for (const m of filtered) {
    if (!datePlayerMap[m.date]) datePlayerMap[m.date] = new Set();
    datePlayerMap[m.date].add(m.team1Player1Name);
    datePlayerMap[m.date].add(m.team1Player2Name);
    datePlayerMap[m.date].add(m.team2Player1Name);
    datePlayerMap[m.date].add(m.team2Player2Name);
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
