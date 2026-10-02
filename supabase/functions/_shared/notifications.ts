// Server-side rules for what each role may enqueue into notification_outbox.
// Pure (no Deno APIs) so it can be unit-tested with vitest.

export type Caller = {
  role: 'member' | 'admin';
  playerName: string | null;
  userId: string;
};

export type NotificationRequest = {
  channel?: unknown;
  event_type?: unknown;
  idempotency_key?: unknown;
  payload?: any;
};

export type AuthorizedNotification = {
  channel: 'telegram' | 'push';
  event_type: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
};

const TELEGRAM_EVENT = 'telegram_alert';
const PUSH_EVENT = 'web_push';
const MEMBER_TELEGRAM_KINDS = new Set(['doodle', 'tournament-confirmation']);
const ADMIN_TELEGRAM_KINDS = new Set(['test', 'tournament-test', 'tournament-created', 'tournament-completed']);
const TELEGRAM_TARGETS = new Set(['tournaments']);
const YEAR_MONTH = /^\d{4}-\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 31 || !value.every((d) => typeof d === 'string' && DATE.test(d))) {
    throw new Error('Invalid doodle notification dates');
  }
  return value as string[];
}

// Text formats mirror js/services/telegram.js builders.
function memberTelegramPayload(caller: Caller, payload: any): Record<string, unknown> {
  if (!caller.playerName) throw new Error('Select a player before sending notifications');
  if (payload.kind === 'doodle') {
    if (typeof payload.yearMonth !== 'string' || !YEAR_MONTH.test(payload.yearMonth)) {
      throw new Error('Invalid doodle notification month');
    }
    const added = dateList(payload.selectedAdded ?? []);
    const removed = dateList(payload.selectedRemoved ?? []);
    return {
      kind: 'doodle',
      text: `🎾 Doodle update — ${caller.playerName} (${payload.yearMonth})\n`
        + `✅ Added: ${added.length ? added.join(', ') : 'none'}\n`
        + `❌ Removed: ${removed.length ? removed.join(', ') : 'none'}`,
    };
  }
  if (typeof payload.tournamentDate !== 'string' || !DATE.test(payload.tournamentDate)) {
    throw new Error('Invalid confirmation notification date');
  }
  return {
    kind: 'tournament-confirmation',
    text: `🎾 ${caller.playerName} confirmed attendance for tournament on ${payload.tournamentDate}`,
  };
}

export function authorizeNotification(caller: Caller, request: NotificationRequest): AuthorizedNotification {
  const key = typeof request.idempotency_key === 'string' ? request.idempotency_key.trim() : '';
  if (!key || key.length > 200) throw new Error('A valid idempotency key is required');
  // Namespaced per user so nobody can pre-claim (and thereby suppress) another user's key.
  const idempotencyKey = `${caller.userId}:${key}`;
  const payload = request.payload && typeof request.payload === 'object' ? request.payload : {};
  const isAdmin = caller.role === 'admin';

  if (request.channel === 'telegram' && request.event_type === TELEGRAM_EVENT) {
    const kind = payload.kind;
    if (payload.target !== undefined && !TELEGRAM_TARGETS.has(payload.target)) {
      throw new Error('Unsupported Telegram target');
    }
    if (MEMBER_TELEGRAM_KINDS.has(kind) && !isAdmin) {
      if (payload.target !== undefined) throw new Error('Admin access is required for Telegram targets');
      return { channel: 'telegram', event_type: TELEGRAM_EVENT, idempotency_key: idempotencyKey, payload: memberTelegramPayload(caller, payload) };
    }
    if (!MEMBER_TELEGRAM_KINDS.has(kind) && !ADMIN_TELEGRAM_KINDS.has(kind)) {
      throw new Error('Unsupported Telegram notification kind');
    }
    if (!isAdmin) throw new Error('Admin access is required for this notification');
    if (typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 4000) {
      throw new Error('Invalid Telegram notification text');
    }
    const out: Record<string, unknown> = { kind, text: payload.text };
    if (payload.target !== undefined) out.target = payload.target;
    return { channel: 'telegram', event_type: TELEGRAM_EVENT, idempotency_key: idempotencyKey, payload: out };
  }

  if (request.channel === 'push' && request.event_type === PUSH_EVENT) {
    if (!isAdmin) throw new Error('Admin access is required for push notifications');
    return { channel: 'push', event_type: PUSH_EVENT, idempotency_key: idempotencyKey, payload };
  }

  throw new Error('Unsupported notification channel or event type');
}
