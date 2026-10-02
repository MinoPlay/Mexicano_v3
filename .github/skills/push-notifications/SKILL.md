---
name: push-notifications
description: Reference for Supabase-backed Web Push subscriptions, outbox sends, DataHub relay, and service-worker receipt.
---

# Push Notifications

## Architecture

1. `subscribeToPush()` requests permission and creates a browser `PushSubscription`.
2. `supabase.savePushSubscription()` upserts endpoint/key material into protected `push_subscriptions`.
3. Push senders enqueue `web_push` in `notification_outbox`.
4. Supabase `dispatch-outbox` sends a trusted DataHub `repository_dispatch`.
5. DataHub `web-push-relay.yml` loads active subscriptions directly from Supabase and sends with VAPID.
6. `sw.js` shows the notification and stores notification history.

The browser has no GitHub PAT. `push-subscriptions.json` is retired as a source of truth and push endpoint/key material is excluded from DataHub backups.

## Client API

`js/services/push.js` exports:

- `isPushSupported`, `isPushEnabled`
- `urlBase64ToUint8Array`
- payload/result builders used by unit tests
- `subscribeToPush`, `resyncPushSubscription`
- `sendPushNotification`, `sendPushMessages`
- `sendTournamentCreatedPush`, `sendTournamentCompletedPush`

Subscription writes call Supabase directly. Notification sends call `backend.enqueueNotification()` with an idempotency key.

Tournament-created pushes target roster names. Tournament-completed pushes are personalized per participant and prefer `Store.getPlayersSummary()` ELO, with replay only as fallback.

## Relay

DataHub files:

- `.github/workflows/web-push-relay.yml`
- `.github/scripts/web-push-relay.mjs`

Required secrets:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The relay supports:

```json
{ "title": "Title", "body": "Body", "url": "./#/", "users": ["Alex"] }
```

or:

```json
{ "messages": [{ "users": ["Alex"], "title": "Title", "body": "Body", "url": "./#/" }] }
```

Target names join through each subscription's `player_id`. Send failures update `last_failure`; subscriptions remain active so transient failures do not silently delete them.

## Service worker/history

`sw.js` handles `push` and `notificationclick`. `js/services/notification-store.js` keeps up to 30 IndexedDB history entries. `js/components/notification-bell.js` renders unread history and pinned announcements.

## Constraints

- HTTPS required.
- iOS 16.4+ requires installed PWA.
- Public VAPID key in `push.js` must match DataHub secret.
- Persist domain state before enqueueing event-related pushes.
- Never commit endpoint, `p256dh`, or auth key data to GitHub.

## Tests

- `tests/services/push.test.js`
- `tests/services/relay-dispatch-timeout.test.js`
- `tests/services/notification-store.test.js`
- `tests/components/notification-bell.test.js`

Update this skill and `.github/features/push-notifications.md` whenever subscription storage, payloads, trigger ordering, relay behavior, or service-worker handlers change.
