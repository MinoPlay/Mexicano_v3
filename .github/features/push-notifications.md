# Web Push Notifications

## Purpose

Deliver native notifications to installed Mexicano PWAs for tournament creation/completion and admin custom messages.

## Architecture

1. Settings requests permission and creates a browser `PushSubscription`.
2. The authenticated client upserts endpoint, `p256dh`, auth key, device owner, and selected player into Supabase `push_subscriptions`.
3. Push senders insert a durable `notification_outbox` row through the backend facade.
4. The Supabase `dispatch-outbox` Edge Function sends `repository_dispatch` event `web_push` to DataHub using a server-held GitHub token.
5. DataHub `web-push-relay.yml` loads active subscriptions directly from Supabase and sends signed notifications using VAPID secrets.
6. `sw.js` displays the notification and stores local IndexedDB history.

The browser never receives a GitHub PAT, service-role key, or VAPID private key. Push endpoint/key material is never backed up to GitHub.

## Payloads

Single/broadcast or targeted:

```json
{
  "title": "Tournament created",
  "body": "Tournament on 2026-01-06",
  "url": "./#/tournament/2026-01-06",
  "users": ["Alex"]
}
```

Personalized batch:

```json
{
  "messages": [
    {
      "users": ["Alex"],
      "title": "Tournament complete",
      "body": "Rank 1/8 · 95 pts",
      "url": "./#/tournament/2026-01-06"
    }
  ]
}
```

Each logical outbox item has an idempotency key and correlation ID. A targeted message matches subscription `player_id` through the player's name.

## Behavior

- Tournament-created push targets roster players.
- Tournament-completed push creates one personalized result per participant.
- Completion ELO prefers the authoritative `players_summary`; full replay is fallback only.
- Admin custom push may broadcast or target one player.
- Re-enabling push unsubscribes the existing browser subscription first, then creates and stores a fresh endpoint.
- Relay failures update `push_subscriptions.last_failure`; subscriptions remain active rather than being silently deleted.
- Domain-event pushes are enqueued only after the related Supabase mutation succeeds.

## Client files

- `js/services/push.js`
- `js/services/supabase.js`
- `js/services/backend.js`
- `js/pages/settings.js`
- `js/components/notification-bell.js`
- `js/services/notification-store.js`
- `sw.js`

## DataHub files

- `.github/workflows/web-push-relay.yml`
- `.github/scripts/web-push-relay.mjs`

DataHub secrets:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The public VAPID key in `js/services/push.js` must match `VAPID_PUBLIC_KEY`.

## Acceptance

- Subscription permission granted => protected Supabase row is created/updated.
- No active access grant => subscription/outbox write is denied.
- Tournament save fails => no push is enqueued.
- Targeted push => only subscriptions bound to listed players receive it.
- Personalized batch => each endpoint receives at most one matching message.
- Relay delivery fails => failure is visible and subscription data remains canonical in Supabase.
- DataHub backup => contains no push endpoint, `p256dh`, or auth key.
- Push click => existing app is focused or the hash URL opens.
