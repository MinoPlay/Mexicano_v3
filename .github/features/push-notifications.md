# Web Push Notifications

## Purpose
Deliver native OS push notifications to users who installed the Mexicano PWA, so they
get alerted (tournament created/completed, doodle updates, confirmations) even when the
app is closed. Complements the existing Telegram alerts — same trigger points, same
GitHub-Actions relay pattern.

## Architecture — relayed through GitHub Actions (like Telegram)
The app has no server (GitHub-as-backend). Web Push needs a signed sender, so sends are
relayed exactly like `telegram-alerts.md`:

1. **Subscribe (client).** In Settings, the user grants notification permission. The
   service worker's `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`
   returns a `PushSubscription`. The client fires a GitHub `repository_dispatch`
   (`event_type: web_push_subscribe`, `client_payload: { subscription, user }`) on the
   configured data repo (`Store.getGitHubConfig()` → `owner`/`repo`/`pat`).
2. **Store subscription (data repo).** A workflow in the data repo
   (`.github/workflows/web-push-relay.yml`, logic in `.github/scripts/web-push-relay.mjs`)
   appends/dedupes the subscription (by `endpoint`) into `mexicano_v3/push-subscriptions.json`.
   Subscriptions never live in the client repo.
3. **Send (data repo).** At trigger points the client fires a `repository_dispatch`
   (`event_type: web_push`, `client_payload: { title, body, url }`). The same workflow reads
   `mexicano_v3/push-subscriptions.json` and sends signed Web Push messages using the
   `web-push` npm lib and **VAPID keys** (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` repo
   secrets, optional `VAPID_SUBJECT` repo variable). Subscriptions that return HTTP 404/410
   are pruned as expired and the file is committed back.
4. **Receive (service worker).** `sw.js` handles the `push` event →
   `self.registration.showNotification(...)`, and `notificationclick` → focus/open the app.

Success on the client only means GitHub accepted the dispatch (HTTP 204); actual delivery
happens in the data-repo workflow.

## VAPID keys
- Generated once with `npx web-push generate-vapid-keys`.
- Public key: shipped in the client as `VAPID_PUBLIC_KEY` in `js/services/push.js`.
- Private key: data-repo **secret** only; never in the client.

## Client module — `js/services/push.js`
Exported symbols (pure/testable unless noted):
- `VAPID_PUBLIC_KEY` — base64url application server key (placeholder until real key set).
- `isPushSupported()` — `true` when `serviceWorker`, `PushManager`, and `Notification`
  are all available in the current environment.
- `urlBase64ToUint8Array(base64String)` — converts a base64url VAPID key to a `Uint8Array`
  for `applicationServerKey`. Pads to a multiple of 4, maps `-`→`+`, `_`→`/`.
- `buildSubscribePayload(subscriptionJson, user)` →
  `{ event_type: 'web_push_subscribe', client_payload: { subscription, user } }`.
- `buildPushAlertPayload(title, body, url)` →
  `{ event_type: 'web_push', client_payload: { title, body, url } }`. `url` defaults to `'./'`.
- `buildTournamentCreatedPush(date)` → `{ title:'🎾 New tournament', body:'Tournament on <date>', url:'./tournament/<date>' }`.
- `buildTournamentCompletedPush(date, rankedPlayers)` → `{ title:'🏆 Tournament complete',
  body:'<date> — Winner: <name>' (or 'Tournament on <date>' when empty), url:'./tournament/<date>' }`.
- `dispatchSubscription(subscriptionJson)` (async) — POSTs a `web_push_subscribe`
  `repository_dispatch`; resolves on HTTP 204, rejects with the GitHub error message otherwise.
- `sendPushNotification(title, body, url)` (async) — POSTs a `web_push` dispatch; same
  204/error contract.
- `sendTournamentCreatedPush(tournament)` / `sendTournamentCompletedPush(tournament)` (async) —
  build from the tournament (`sendTournamentCompletedPush` ranks `tournament.players` via
  `rankPlayers`) and call `sendPushNotification`.
- `subscribeToPush()` (async, browser-only glue) — checks support, requests permission,
  gets `navigator.serviceWorker.ready`, subscribes via `PushManager`, then calls
  `dispatchSubscription(sub.toJSON())`. Throws if unsupported or permission denied.

All dispatches require a configured GitHub backend (`owner`/`repo`/`pat`); missing config
throws `GitHub backend not configured — cannot relay push`.

## Service worker — `sw.js`
- `push` listener: parses `event.data.json()` → `showNotification(title, { body, icon, data:{ url } })`.
- `notificationclick` listener: closes the notification, focuses an existing client or
  opens `event.notification.data.url` (default `'./'`).

## Settings page — `js/pages/settings.js`
A "Push Notifications" section with an **Enable push notifications** button that calls
`subscribeToPush()` and shows status. Button disabled when `isPushSupported()` is false.

An admin-only "Send Custom Push" section (`#custom-push-section`, gated by
`Store.isAdministrator()` in `refreshAdminVisibility()`) with title/message inputs and a
**Send to all devices** button that calls `sendPushNotification(title, body)`.

## Trigger Points
- Tournament created — `js/pages/create-tournament.js` fires `sendTournamentCreatedPush(tournament)`
  after the day file syncs (fire-and-forget; independent of the "Disable Telegram alert" checkbox).
- Tournament completed — `js/pages/tournament.js` fires `sendTournamentCompletedPush(tournament)`
  after `completeTournament()` (fire-and-forget, alongside the Telegram alert).
- Admin custom broadcast — Settings "Send Custom Push" → `sendPushNotification(title, body)`.
- (Doodle / confirmation triggers from Telegram are not yet wired for push.)

## Constraints
- **iOS 16.4+**: Web Push works only when the PWA is installed to the home screen
  (see `pwa-installation.md`), not in a Safari tab.
- **HTTPS required** — satisfied by GitHub Pages.
- **Permission required** — no silent enable; user must grant.
- **Subscription rot** — endpoints expire; the relay workflow prunes 404/410 responses.
