import { Store } from '../store.js';
import { rankPlayers } from './ranking.js';
import { enqueueNotification } from './backend.js';

const DISPATCH_EVENT = 'telegram_alert';
const LOG_PREFIX = '[telegram]';
const TARGET_TOURNAMENTS = 'tournaments';

function log(level, message, details) {
  if (details === undefined) {
    console[level](`${LOG_PREFIX} ${message}`);
    return;
  }
  console[level](`${LOG_PREFIX} ${message}`, details);
}

export function buildDoodleAlertText(playerName, yearMonth, selectedAdded = [], selectedRemoved = []) {
  const added = selectedAdded.length ? selectedAdded.join(', ') : 'none';
  const removed = selectedRemoved.length ? selectedRemoved.join(', ') : 'none';
  return `🎾 Doodle update — ${playerName} (${yearMonth})\n✅ Added: ${added}\n❌ Removed: ${removed}`;
}

export function buildConfirmationText(playerName, tournamentDate) {
  return `🎾 ${playerName} confirmed attendance for tournament on ${tournamentDate}`;
}

export function buildTestAlertText(user, timestamp) {
  return `📞 Mexicano test alert\nUser: ${user}\nTime: ${timestamp}`;
}

export function buildTournamentCreatedText(date, code, brackets = []) {
  const codeLine = code || 'none';
  const courts = brackets.map((bracket, index) =>
    `Court ${index + 1}: ${bracket.team1.join(' & ')} vs ${bracket.team2.join(' & ')}`);
  return `🔑 Code: ${codeLine}\n\n🎾 New tournament — ${date}\n\n${courts.join('\n\n')}`;
}

export function buildTournamentCompletedText(date, rankedPlayers = []) {
  const lines = rankedPlayers.map((player) => `${player.rank}. ${player.name} — ${player.totalPoints} pts`);
  return `🏆 Tournament complete — ${date}\nFinal ranking:\n${lines.join('\n')}`;
}

async function dispatchTelegramAlert(text, meta, target) {
  const payload = { text, kind: meta.kind };
  if (target) payload.target = target;
  const idempotencyKey = [
    'telegram',
    meta.kind,
    meta.tournamentDate || meta.date || meta.yearMonth || meta.timestamp || Date.now(),
    meta.playerName || meta.user || '',
  ].join(':');
  log('info', 'Enqueuing Telegram alert.', { kind: meta.kind });
  await enqueueNotification('telegram', DISPATCH_EVENT, payload, idempotencyKey);
  log('info', 'Telegram alert enqueued.', { kind: meta.kind });
}

export async function sendDoodleAlert(playerName, yearMonth, selectedAdded = [], selectedRemoved = []) {
  const meta = {
    kind: 'doodle',
    playerName,
    yearMonth,
    addedCount: selectedAdded.length,
    removedCount: selectedRemoved.length,
  };
  if (!selectedAdded.length && !selectedRemoved.length) {
    log('info', 'Skipping alert: no doodle changes detected.', meta);
    return;
  }
  return dispatchTelegramAlert(
    buildDoodleAlertText(playerName, yearMonth, selectedAdded, selectedRemoved),
    meta,
  );
}

export async function sendTournamentConfirmationAlert(playerName, tournamentDate) {
  return dispatchTelegramAlert(
    buildConfirmationText(playerName, tournamentDate),
    { kind: 'tournament-confirmation', playerName, tournamentDate },
  );
}

export async function sendTelegramTestAlert() {
  const currentUser = Store.getCurrentUser() || 'unknown';
  const timestamp = new Date().toISOString();
  return dispatchTelegramAlert(
    buildTestAlertText(currentUser, timestamp),
    { kind: 'test', user: currentUser, timestamp },
  );
}

export async function sendTournamentTestAlert() {
  const currentUser = Store.getCurrentUser() || 'unknown';
  const timestamp = new Date().toISOString();
  const text = `🧪 Tournament group test — ${currentUser}\n${timestamp}\n\n`
    + 'This is a test of the tournament created/completed channel.';
  return dispatchTelegramAlert(
    text,
    { kind: 'tournament-test', user: currentUser, timestamp },
    TARGET_TOURNAMENTS,
  );
}

export async function sendTournamentCreatedAlert(tournament) {
  const round1 = tournament.rounds?.find((round) => round.roundNumber === 1);
  const brackets = (round1?.matches || []).map((match) => ({
    team1: [match.player1.name, match.player2.name],
    team2: [match.player3.name, match.player4.name],
  }));
  return dispatchTelegramAlert(
    buildTournamentCreatedText(tournament.tournamentDate, tournament.accessCode, brackets),
    { kind: 'tournament-created', date: tournament.tournamentDate },
    TARGET_TOURNAMENTS,
  );
}

export async function sendTournamentCompletedAlert(tournament) {
  return dispatchTelegramAlert(
    buildTournamentCompletedText(tournament.tournamentDate, rankPlayers(tournament.players || [])),
    { kind: 'tournament-completed', date: tournament.tournamentDate },
    TARGET_TOURNAMENTS,
  );
}
