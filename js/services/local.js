/**
 * Local dev-server persistence service.
 * When running via server.js with a LOCAL_DATA_PATH configured,
 * writes saved data back to the local JSON files so changes survive reloads.
 * All functions are no-ops when the local server is not available.
 */

let _available = null;

async function isAvailable() {
  if (_available !== null) return _available;
  
  // Skip local persistence on deployed version
  const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (!isDev) { _available = false; return false; }
  
  try {
    const r = await fetch('/api/local-data/status');
    if (!r.ok) { _available = false; return false; }
    _available = !!(await r.json()).available;
  } catch { _available = false; }
  return _available;
}

async function writeLocal(relativePath, data) {
  if (!(await isAvailable())) return;
  const res = await fetch('/api/local-data/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: relativePath, data }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Local write failed (${res.status}): ${err.error || relativePath}`);
  }
}

export async function writeDoodle(year, month, entries) {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  await writeLocal(`${year}/${ym}/doodle_${ym}.json`, entries);
}

export async function writeTournamentDay(date, matches) {
  const year = date.slice(0, 4);
  const ym = date.slice(0, 7);
  const data = {
    backup_timestamp: new Date().toISOString(),
    match_date: date,
    match_count: matches.length,
    matches: matches.map(m => ({
      Date: m.date,
      RoundNumber: m.roundNumber,
      ScoreTeam1: m.scoreTeam1,
      ScoreTeam2: m.scoreTeam2,
      Team1Player1Name: m.team1Player1Name,
      Team1Player2Name: m.team1Player2Name,
      Team2Player1Name: m.team2Player1Name,
      Team2Player2Name: m.team2Player2Name,
    })),
  };
  await writeLocal(`${year}/${ym}/${date}.json`, data);
}
