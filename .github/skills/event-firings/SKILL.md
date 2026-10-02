---
name: event-firings
description: Reference for Supabase mutations, Telegram alerts, GitHub relay dispatches, and Web Push.
---

# Event Firings

## Invariant

Supabase is canonical. Browser code never writes DataHub and never holds a GitHub PAT.

1. Persist the domain mutation through `js/services/backend.js`.
2. Only after persistence succeeds, enqueue Telegram/Web Push through `notification_outbox`.
3. `dispatch-outbox` sends trusted `repository_dispatch` events to DataHub.
4. Failures must be visible; never use an empty catch.

Offline writes are blocked before success UI or notification enqueueing.

## Channels

- **Domain data:** `backend.js` -> `supabase.js` -> `domain-mutation` Edge Function.
- **Telegram:** `telegram.js` -> `backend.enqueueNotification()` -> `notification_outbox` -> `dispatch-outbox` -> DataHub `telegram-relay.yml`.
- **Web Push:** subscription stored in protected `push_subscriptions`; sends use the same outbox/dispatcher path and DataHub `web-push-relay.yml`.
- **GitHub backup:** DataHub workflow exports Supabase Tuesday/Thursday at 08:15 Copenhagen. It is not a runtime write path.

Outbox rows carry an idempotency key and correlation ID. The dispatcher claims rows atomically via `claim_notification_outbox` (`FOR UPDATE SKIP LOCKED`), retries failures with backoff and records `last_error`.

`domain-mutation` authorizes every enqueue with `_shared/notifications.ts#authorizeNotification`:
- Only `telegram`/`telegram_alert` and `push`/`web_push` are accepted.
- Members may only enqueue Telegram `doodle` and `tournament-confirmation`; the server rebuilds their text from the bound player and structured fields (`yearMonth`/`selectedAdded`/`selectedRemoved`, `tournamentDate`) and ignores client text. No `target`.
- Everything else (test alerts, tournament created/completed, any push) requires admin.
- Idempotency keys are namespaced by user id. Doodle alert keys include a random suffix so every edit alerts.

## Event catalog

| Trigger | Canonical persistence | Notification |
|---|---|---|
| Attendance confirmation | `confirm_attendance` | Telegram confirmation |
| Doodle save | `save_doodle` | Telegram per changed player |
| Tournament create | `save_tournament` | Optional Telegram + targeted Web Push |
| Tournament complete | `save_tournament` | Telegram + personalized Web Push |
| Manual attendance | `save_manual_attendance` | None |
| Settings test | None | Explicit test outbox item |
| Push opt-in | `push_subscriptions` upsert | None |

Current trigger code preserves persist-before-enqueue ordering. A future change should combine the domain mutation and its outbox rows in one database RPC transaction; do not weaken the existing ordering meanwhile.

## Relay contracts

Telegram:

```json
{
  "event_type": "telegram_alert",
  "client_payload": {
    "text": "message",
    "kind": "tournament-completed",
    "target": "tournaments",
    "outbox_id": "uuid",
    "idempotency_key": "key",
    "correlation_id": "uuid"
  }
}
```

Web Push supports a single `{ title, body, url, users? }` payload or
`{ messages: [{ users, title, body, url }] }`. The DataHub relay loads active subscriptions from Supabase using server credentials. Subscription endpoints and keys are never committed to Git.

## Required secrets

Supabase Edge Functions:

- `GITHUB_RELAY_TOKEN`
- `GITHUB_RELAY_OWNER`
- `GITHUB_RELAY_REPO`
- `OUTBOX_DISPATCH_SECRET`

DataHub:

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## Tests

- `tests/services/push.test.js`
- `tests/services/relay-dispatch-timeout.test.js`
- `tests/supabase-edge-functions.test.js`

Any event behavior change requires a failing-first test, feature-doc update, this skill update, full Vitest, and final `sw.js` version bump.
