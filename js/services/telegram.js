import { Store } from '../store.js';
import { rankPlayers } from './ranking.js';

// Telegram alerts are relayed through GitHub Actions instead of being sent
// directly from the browser: many networks block api.telegram.org, but
// api.github.com stays reachable (the same endpoint used for all app data).
//
// The client fires a `repository_dispatch` event on the configured data repo;
// a workflow in that repo (`.github/workflows/telegram-relay.yml`) sends the
// actual Telegram message from a GitHub runner using repo secrets
// (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID).

const GH_API = 'https://api.github.com';
const GH_ACCEPT = 'application/vnd.github+json';
const GH_API_VERSION = '2022-11-28';
const DISPATCH_EVENT = 'telegram_alert';
const LOG_PREFIX = '[telegram]';

function log(level, message, details) {
  if (details === undefined) {
    console[level](`${LOG_PREFIX} ${message}`);
    return;
  }
  console[level](`${LOG_PREFIX} ${message}`, details);
}

function getHeaders(pat) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: GH_ACCEPT,
    'X-GitHub-Api-Version': GH_API_VERSION,
    'Content-Type': 'application/json',
  };
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
  const codeLine = code ? code : 'none';
  const lines = brackets.map((b, i) =>
    `Court ${i + 1}: ${b.team1.join(' & ')} vs ${b.team2.join(' & ')}`);
  return `🎾 New tournament — ${date}\n🔑 Code: ${codeLine}\nStarting brackets:\n${lines.join('\n')}`;
}

export function buildTournamentCompletedText(date, rankedPlayers = []) {
  const lines = rankedPlayers.map(p => `${p.rank}. ${p.name} — ${p.totalPoints} pts`);
  return `🏆 Tournament complete — ${date}\nFinal ranking:\n${lines.join('\n')}`;
}

async function dispatchTelegramAlert(text, meta) {
  const gh = Store.getGitHubConfig();
  if (!gh?.owner || !gh?.repo || !gh?.pat) {
    log('warn', 'GitHub backend not configured; alert not relayed.', meta);
    throw new Error('GitHub backend not configured — cannot relay Telegram alert');
  }

  const url = `${GH_API}/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}/dispatches`;
  const payload = { event_type: DISPATCH_EVENT, client_payload: { text, kind: meta.kind } };

  log('info', 'Relaying Telegram alert via GitHub dispatch.', { kind: meta.kind });
  const res = await fetch(url, {
    method: 'POST',
    headers: getHeaders(gh.pat),
    body: JSON.stringify(payload),
  });

  // repository_dispatch returns 204 No Content on success.
  if (res.status !== 204) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) detail = body.message;
    } catch { /* non-JSON error body */ }
    throw new Error(`Telegram relay dispatch failed: ${detail}`);
  }
  log('info', 'Telegram alert relayed.', { kind: meta.kind });
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
  const text = buildDoodleAlertText(playerName, yearMonth, selectedAdded, selectedRemoved);
  return dispatchTelegramAlert(text, meta);
}

export async function sendTournamentConfirmationAlert(playerName, tournamentDate) {
  const text = buildConfirmationText(playerName, tournamentDate);
  return dispatchTelegramAlert(text, { kind: 'tournament-confirmation', playerName, tournamentDate });
}

export async function sendTelegramTestAlert() {
  const currentUser = Store.getCurrentUser() || 'unknown';
  const timestamp = new Date().toISOString();
  const text = buildTestAlertText(currentUser, timestamp);
  return dispatchTelegramAlert(text, { kind: 'test', user: currentUser, timestamp });
}

export async function sendTournamentCreatedAlert(tournament) {
  const round1 = tournament.rounds?.find(r => r.roundNumber === 1);
  const brackets = (round1?.matches || []).map(m => ({
    team1: [m.player1.name, m.player2.name],
    team2: [m.player3.name, m.player4.name],
  }));
  const text = buildTournamentCreatedText(tournament.tournamentDate, tournament.accessCode, brackets);
  return dispatchTelegramAlert(text, { kind: 'tournament-created', date: tournament.tournamentDate });
}

export async function sendTournamentCompletedAlert(tournament) {
  const ranked = rankPlayers(tournament.players || []);
  const text = buildTournamentCompletedText(tournament.tournamentDate, ranked);
  return dispatchTelegramAlert(text, { kind: 'tournament-completed', date: tournament.tournamentDate });
}
