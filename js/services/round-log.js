import { Store } from '../store.js';

const LOG_KEY = 'mexicano_round_log';
const MAX_ENTRIES = 200;

export function logRoundResult(tournament, roundNumber) {
  if (!Store.isAdministrator() || !Store.isLogsEnabled()) return;

  const round = tournament.rounds.find(r => r.roundNumber === roundNumber);
  if (!round) return;

  const matches = round.matches.map(m => ({
    team1: [m.player1, m.player2],
    team2: [m.player3, m.player4],
    score1: m.team1Score,
    score2: m.team2Score,
  }));

  const entry = {
    ts: new Date().toISOString(),
    tournamentDate: tournament.tournamentDate,
    roundNumber,
    matches,
  };

  const log = getRoundLog();
  log.unshift(entry);
  if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;

  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch { /* quota exceeded — silently drop */ }
}

export function logError(context, error) {
  // Errors are captured for any admin, even when the Logs toggle is off, so
  // failures (e.g. a silent GitHub push failure on mobile) can be diagnosed
  // by enabling the Logs tab afterwards.
  if (!Store.isAdministrator()) return;

  const message = error instanceof Error
    ? (error.stack || error.message || String(error))
    : String(error);

  const entry = {
    ts: new Date().toISOString(),
    type: 'error',
    context: String(context || 'unknown'),
    message,
  };

  const log = getRoundLog();
  log.unshift(entry);
  if (log.length > MAX_ENTRIES) log.length = MAX_ENTRIES;

  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch { /* quota exceeded — silently drop */ }
}

export function getRoundLog() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY)) || [];
  } catch { return []; }
}

export function clearRoundLog() {
  localStorage.removeItem(LOG_KEY);
}
