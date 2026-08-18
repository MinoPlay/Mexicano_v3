import { Store } from '../store.js';
import { rankPlayers } from './ranking.js';
import { calculateAllEloRankings } from './elo.js';
import { fetchWithRetry, FAST_TIMEOUTS } from './http.js';

const INITIAL_ELO = 1000;

// Web Push notifications are relayed through GitHub Actions instead of being sent
// directly from the browser, mirroring the Telegram relay (see telegram.js):
// the client fires `repository_dispatch` events on the configured data repo and a
// workflow there (`.github/workflows/web-push-relay.yml`) stores subscriptions and
// sends signed Web Push messages using VAPID secrets.

const GH_API = 'https://api.github.com';
const GH_ACCEPT = 'application/vnd.github+json';
const GH_API_VERSION = '2022-11-28';
const SUBSCRIBE_EVENT = 'web_push_subscribe';
const PUSH_EVENT = 'web_push';
const LOG_PREFIX = '[push]';

// Application server (VAPID) public key. Replace with the real key generated via
// `npx web-push generate-vapid-keys`; the matching private key lives only as a
// data-repo secret.
export const VAPID_PUBLIC_KEY = 'BNQYxg9XOvcBJdGoXWE6IDstxSA4guSGNHZBvn4o0Sa7583NEUmQVyJno4QcUEEj2f4TT764zf_G4eatlPQc4_I';

function log(level, message, details) {
  if (details === undefined) console[level](`${LOG_PREFIX} ${message}`);
  else console[level](`${LOG_PREFIX} ${message}`, details);
}

function getHeaders(pat) {
  return {
    Authorization: `token ${pat}`,
    Accept: GH_ACCEPT,
    'X-GitHub-Api-Version': GH_API_VERSION,
    'Content-Type': 'application/json',
  };
}

export function isPushSupported() {
  return (
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator &&
    typeof PushManager !== 'undefined' &&
    typeof Notification !== 'undefined'
  );
}

// Whether push is already enabled on this device (permission granted). Used to
// hide the "enable push" notification bell once the user has opted in.
export function isPushEnabled() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function buildSubscribePayload(subscription, user) {
  return { event_type: SUBSCRIBE_EVENT, client_payload: { subscription, user } };
}

export function buildPushAlertPayload(title, body, url = './', users = null) {
  const client_payload = { title, body, url };
  if (Array.isArray(users) && users.length > 0) client_payload.users = users;
  return { event_type: PUSH_EVENT, client_payload };
}

// Multi-recipient dispatch: each message carries its own `users` list plus a
// personalised title/body, so one dispatch can deliver a different notification
// to every participant.
export function buildPushMessagesPayload(messages) {
  return { event_type: PUSH_EVENT, client_payload: { messages } };
}

async function dispatch(payload, kind) {
  const gh = Store.getGitHubConfig();
  if (!gh?.owner || !gh?.repo || !gh?.pat) {
    log('warn', 'GitHub backend not configured; push not relayed.', { kind });
    throw new Error('GitHub backend not configured — cannot relay push');
  }

  const url = `${GH_API}/repos/${encodeURIComponent(gh.owner)}/${encodeURIComponent(gh.repo)}/dispatches`;
  log('info', 'Relaying push via GitHub dispatch.', { kind });
  // Bounded + retrying: see telegram.js — a stalled relay POST must not hang
  // the tournament-completion dialog.
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: getHeaders(gh.pat),
    body: JSON.stringify(payload),
  }, { timeouts: FAST_TIMEOUTS });

  // repository_dispatch returns 204 No Content on success.
  if (res.status !== 204) {
    let detail = `HTTP ${res.status}`;
    try {
      const errBody = await res.json();
      if (errBody?.message) detail = errBody.message;
    } catch { /* non-JSON error body */ }
    throw new Error(`Push relay dispatch failed: ${detail}`);
  }
  log('info', 'Push relayed.', { kind });
}

export async function dispatchSubscription(subscription) {
  const user = Store.getCurrentUser() || 'unknown';
  return dispatch(buildSubscribePayload(subscription, user), SUBSCRIBE_EVENT);
}

export async function sendPushNotification(title, body, url = './', users = null) {
  return dispatch(buildPushAlertPayload(title, body, url, users), PUSH_EVENT);
}

export async function sendPushMessages(messages) {
  return dispatch(buildPushMessagesPayload(messages), PUSH_EVENT);
}

export function buildTournamentCreatedPush(date) {
  return {
    title: '🎾 New tournament',
    body: `Tournament on ${date}`,
    url: `./tournament/${date}`,
  };
}

export function buildTournamentCompletedPush(date, rankedPlayers = []) {
  const winner = rankedPlayers[0]?.name;
  return {
    title: '🏆 Tournament complete',
    body: winner ? `${date} — Winner: ${winner}` : `Tournament on ${date}`,
    url: `./tournament/${date}`,
  };
}

// Per-player ELO after this tournament and the change it caused, derived by
// replaying the full match history with and without the tournament's own matches.
export function computeTournamentEloChanges(allMatches, date) {
  const matches = allMatches || [];
  if (matches.length === 0) return {};

  const { players: after } = calculateAllEloRankings(matches);
  const { players: before } = calculateAllEloRankings(matches.filter(m => m.date < date));

  const out = {};
  for (const [name, state] of Object.entries(after)) {
    const prev = before[name]?.elo ?? INITIAL_ELO;
    out[name] = {
      elo: Math.round(state.elo),
      eloChange: Math.round(state.elo - prev),
    };
  }
  return out;
}

// Personal result notification for one participant.
export function buildPlayerResultPush(date, player, totalPlayers) {
  const games = player.gamesPlayed || 0;
  const points = player.totalPoints || 0;
  const avg = (games > 0 ? points / games : 0).toFixed(1);
  const lines = [`Rank ${player.rank}/${totalPlayers} · ${points} pts · ${avg} avg`];
  if (player.elo != null) {
    const change = player.eloChange || 0;
    lines.push(`ELO ${player.elo} (${change >= 0 ? '+' : ''}${change})`);
  }
  return {
    users: [player.name],
    title: `🏆 Tournament complete — ${date}`,
    body: lines.join('\n'),
    url: `./tournament/${date}`,
  };
}

export function buildTournamentCompletedMessages(date, rankedPlayers = [], eloByPlayer = {}) {
  const total = rankedPlayers.length;
  return rankedPlayers
    .filter(p => p.name)
    .map(p => buildPlayerResultPush(date, { ...p, ...(eloByPlayer[p.name] || {}) }, total));
}

export async function sendTournamentCreatedPush(tournament) {
  const { title, body, url } = buildTournamentCreatedPush(tournament.tournamentDate);
  const users = (tournament.players || []).map(p => p.name).filter(Boolean);
  return sendPushNotification(title, body, url, users);
}

export async function sendTournamentCompletedPush(tournament, allMatches) {
  const ranked = rankPlayers(tournament.players || []);
  const date = tournament.tournamentDate;
  const matches = Array.isArray(allMatches) ? allMatches : (Store.getMatches?.() || []);
  const messages = buildTournamentCompletedMessages(
    date,
    ranked,
    computeTournamentEloChanges(matches, date),
  );

  // No participants (e.g. an empty tournament): keep the legacy broadcast so the
  // completion is still announced.
  if (messages.length === 0) {
    const { title, body, url } = buildTournamentCompletedPush(date, ranked);
    return sendPushNotification(title, body, url);
  }
  return sendPushMessages(messages);
}

// Silently re-register an already-granted subscription so its `user` tag is
// refreshed from the current profile. Runs on app startup (no permission prompt)
// so legacy subscriptions stored before targeted sends existed get back-filled
// with `mexicano_current_user`, without asking users to re-enable push.
export async function resyncPushSubscription() {
  if (!isPushSupported() || !isPushEnabled()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return false;
    await dispatchSubscription(sub.toJSON());
    return true;
  } catch (e) {
    log('warn', 'Push resync failed.', { error: e?.message });
    return false;
  }
}

export async function subscribeToPush() {
  if (!isPushSupported()) {
    throw new Error('Push notifications are not supported in this browser');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notification permission was not granted');
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  await dispatchSubscription(sub.toJSON());
  return sub;
}
