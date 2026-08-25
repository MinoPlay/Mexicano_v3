---
name: push-notifications
description: >
  Reference skill for Web Push notifications in the Mexicano PWA (subscribe, send, service
  worker handlers, GitHub-Actions relay in the data repo, VAPID keys). Use when adding,
  changing, testing, or debugging push notifications, the js/services/push.js module, the
  sw.js push/notificationclick handlers, or the DataHub_Mexicano web-push-relay workflow.
---

# Push Notifications

## Purpose
Native OS push notifications for users who installed the Mexicano PWA. Fired at tournament
create/complete and via an admin custom-broadcast box in Settings. There is **no server** —
sends are relayed through GitHub Actions exactly like the Telegram alerts.

## Architecture (relayed, no server)
Web Push needs a signed sender, so the client never sends pushes directly. Flow:

1. **Subscribe** — Settings → "Enable push notifications" → `subscribeToPush()` requests
   permission, `PushManager.subscribe({ userVisibleOnly:true, applicationServerKey })`
   returns a `PushSubscription`. Client fires GitHub `repository_dispatch`
   (`event_type: web_push_subscribe`, `client_payload: { subscription, user }`).
2. **Store** — data-repo workflow appends/dedupes (by `endpoint`) into
   `mexicano_v3/push-subscriptions.json`, tagging each record with `user`. A re-subscribe for
   an existing endpoint **updates the `user` tag** (does not skip), back-filling legacy subs.
3. **Send** — client fires `repository_dispatch` (`event_type: web_push`,
   `client_payload: { title, body, url }`). Same workflow reads the subscriptions file and
   sends signed Web Push via the `web-push` npm lib + VAPID secrets. 404/410 endpoints are
   **not** pruned (by design — see script comment); a dead endpoint just fails silently
   (`failed=N` in the log) until that user re-subscribes via Settings.
4. **Receive** — `sw.js` `push` listener → `showNotification`; `notificationclick` focuses
   an open client or opens `data.url`.

Client success = GitHub accepted the dispatch (HTTP 204); real delivery happens in the workflow.

## Key files & symbols
### Client (this repo, `MinoPlay/Mexicano_v3`)
- `js/services/push.js` — the module. Exports:
  - `VAPID_PUBLIC_KEY` — base64url app server key; **must match** the data-repo
    `VAPID_PUBLIC_KEY` secret. Currently `BNQYxg9X…Qc4_I`.
  - `isPushSupported()` — `serviceWorker` + `PushManager` + `Notification` all present.
  - `isPushEnabled()` — `Notification.permission === 'granted'`; used internally by
    `resyncPushSubscription()`. No longer used by the notification bell (it always renders).
  - `urlBase64ToUint8Array(base64)` — VAPID key → `Uint8Array` for `applicationServerKey`.
  - `buildSubscribePayload(subscription, user)` / `buildPushAlertPayload(title, body, url='./', users=null)`
    — pure `repository_dispatch` payload builders. `buildPushAlertPayload` adds a `users`
    array to `client_payload` only when a non-empty recipient list is passed (targeted send).
  - `buildPushMessagesPayload(messages)` / `sendPushMessages(messages)` — one dispatch,
    `client_payload.messages = [{ users, title, body, url }]`, a different notification per recipient.
  - `computeTournamentEloChanges(allMatches, date)` → `{ name: { elo, eloChange } }`; replays
    ELO with and without the tournament's matches via `calculateAllEloRankings`.
  - `buildPlayerResultPush(date, player, totalPlayers)` → personal message
    `{users:[name], title:'🏆 Tournament complete — <date>', body:'Rank r/n · p pts · a avg\nELO e (±c)', url}`.
    ELO line omitted when unknown.
  - `buildTournamentCompletedMessages(date, rankedPlayers, eloByPlayer)` → one message per participant.
  - `buildTournamentCreatedPush(date)` → `{title:'🎾 New tournament', body:'Tournament on <date>', url:'./#/tournament/<date>'}`.
    URLs must be `./#/...` (hash-based router, see `js/router.js`) — a bare `./tournament/<date>`
    path 404s because it's requested as a real static file, not routed by the SPA.
  - `buildTournamentCompletedPush(date, rankedPlayers)` → `{title:'🏆 Tournament complete',
    body:'<date> — Winner: <name>' | 'Tournament on <date>', url:'./#/tournament/<date>'}`.
  - `dispatchSubscription(subscription)` / `sendPushNotification(title, body, url='./', users=null)` —
    async; POST to `…/repos/<owner>/<repo>/dispatches`; resolve on 204, reject with the
    GitHub error message otherwise. Require configured backend or throw
    `GitHub backend not configured — cannot relay push`. Optional `users` targets recipients.
  - `sendTournamentCreatedPush(tournament)` / `sendTournamentCompletedPush(tournament, allMatches?)` —
    build from the tournament (`Completed` ranks `tournament.players` via `rankPlayers`) and
    dispatch. `Created` **targets only the tournament's players** (passes
    `tournament.players[].name` as `users`); `Completed` sends **one personalised message per
    participant** (rank/points/average/ELO/ELO change) through `sendPushMessages`, falling
    back to the legacy broadcast only when there are no players. `allMatches` defaults to
    `Store.getMatches()`.
  - `subscribeToPush()` — browser-only glue; checks support, requests permission, gets
    `navigator.serviceWorker.ready`, subscribes, dispatches `sub.toJSON()`.
  - `resyncPushSubscription()` — browser-only glue; **silent** startup re-tag. No-ops unless
    push supported + already granted; reads the existing `pushManager.getSubscription()` and
    re-dispatches it via `dispatchSubscription` so the data repo refreshes the record's `user`
    from `mexicano_current_user`. Never prompts; returns `true`/`false`, swallows errors.
    Called fire-and-forget from `js/app.js` `init()` to back-fill legacy subs.
- `js/components/notification-bell.js` — `renderNotificationBell()` (async) is mounted
  **inline in the Home page header** (`#home-header-right` in `js/pages/home.js`), not a
  global fixed overlay. **Always renders** (dropped the old `isPushEnabled()`
  hide-once-enabled behavior) and now shows **notification history**: an unread-count
  badge (`.notif-bell-badge`, from `getUnreadCount()`), and a popup (on click) listing
  stored history (title/body/date, newest first) with a "Clear all" button and an empty
  state. Opening the popup calls `markAllRead()`, clearing the badge. Listens for the SW
  `message` event (`{type:'mexicano-notification-added'}`) to live-refresh while mounted.
- `js/services/notification-store.js` — IndexedDB-backed history store shared by
  `sw.js` (writer) and the bell (reader), so notifications survive the app being fully
  closed. Exports `addNotification({title,body,url})` (prunes to newest `MAX_HISTORY`=30),
  `getNotifications()` (newest-first), `getUnreadCount()`, `markAllRead()`, `clearAll()`.
  All degrade to no-op/empty (never throw) when `indexedDB` is unavailable.
- `sw.js` — module service worker.
  - Listeners `push` (parses `event.data.json()` → **keeps** the native OS popup via
    `showNotification(title, { body, icon, badge, data:{ url } })` **and** persists the
    notification to history via `addNotification()` from
    `js/services/notification-store.js`, then `postMessage`s open clients
    `{type:'mexicano-notification-added'}` so an open Home tab live-refreshes its bell
    badge; history writing is best-effort and never blocks the native popup) and
    `notificationclick` (focus existing client or `clients.openWindow(url)`).
  - `js/services/push.js` and `js/services/notification-store.js` are listed in `ASSETS`
    for offline caching.
- `js/pages/settings.js` — "Push Notifications" section (`#push-enable-btn`,
  `subscribeToPush()`, disabled when unsupported) and admin-only "Send Custom Push" section
  (`#custom-push-section`, gated in `refreshAdminVisibility()` by `Store.isAdministrator()`;
  `#custom-push-recipient` (All devices / a single member) / `#custom-push-title` /
  `#custom-push-body` / `#custom-push-btn` → `sendPushNotification`, passing `[recipient]` as
  `users` when a member is chosen).
- `js/pages/create-tournament.js` — fires `sendTournamentCreatedPush(tournament)` after the
  day file syncs (fire-and-forget; **not** suppressed by the "Disable Telegram alert"
  checkbox). Targets only the tournament's players (their names go in `client_payload.users`).
- `js/pages/tournament.js` — fires `sendTournamentCompletedPush(tournament)` after
  `completeTournament()` (fire-and-forget, alongside the Telegram alert).

### Data repo (`../DataHub_Mexicano`, `MinoPlay/DataHub_Mexicano`)
- `.github/workflows/web-push-relay.yml` — `on: repository_dispatch: types: [web_push_subscribe, web_push]`,
  `permissions: contents: write`, installs `web-push`, runs the script, commits subscription
  changes. Env: `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` secrets, `VAPID_SUBJECT` var
  (default `mailto:admin@example.com`).
- `.github/scripts/web-push-relay.mjs` — subscribe (store+dedupe, attaches `user` to the sub
  and refreshes it on re-subscribe) / send (single `{title,body,url,users?}` or a
  `messages[]` list; optional `users` filter → only matching subs are contacted, else
  broadcast; one notification max per subscription; **404/410 failures are logged but the
  subscription is never deleted** — see the "Never delete subscriptions" comment in the
  script). State file:
  `mexicano_v3/push-subscriptions.json` (array of `PushSubscription` JSON, each with an added `user` field).

## Data shapes
- Dispatch (subscribe): `{ event_type:'web_push_subscribe', client_payload:{ subscription:{endpoint,keys:{p256dh,auth}}, user } }`.
- Dispatch (send): `{ event_type:'web_push', client_payload:{ title, body, url[, users] } }`
  or `{ event_type:'web_push', client_payload:{ messages:[{ users, title, body, url }] } }`.
  Optional `users` (array of player names) targets specific recipients; absent/empty = broadcast.
  With `messages`, each subscription receives at most the first message it matches.
- `mexicano_v3/push-subscriptions.json`: `[{ endpoint, expirationTime, keys:{ p256dh, auth }, user }]`.
  `user` is the subscriber's player name (may be `null` for legacy subs) and is used to match
  targeted sends. Legacy subs without `user` are excluded from targeted sends until re-subscribed.
- GitHub config comes from `Store.getGitHubConfig()` → `{ owner:'MinoPlay', repo:'DataHub_Mexicano', pat }`.

## VAPID keys
`npx web-push generate-vapid-keys` **once**. Public → `VAPID_PUBLIC_KEY` in `push.js` **and**
data-repo secret. Private → data-repo secret only, never in client. Regenerating breaks all
existing subscriptions.

## Tests
- `tests/services/push.test.js` — pure builders + dispatch/send via mocked `fetch` (204/403)
  and mocked `../../js/store.js`. Add hardcoded `input => expected` cases here (RED) before
  changing `push.js` (GREEN). Run `npx vitest run tests/services/push.test.js`.
- `tests/services/notification-store.test.js` — history CRUD via `fake-indexeddb/auto`
  (dev dependency), including the indexedDB-unavailable fallback.
- `tests/components/notification-bell.test.js` — badge/popup/history rendering with
  `js/services/notification-store.js` mocked (same style as the old push.js mock).
- Service worker handlers, the workflow, and the settings UI wiring are not unit-tested
  (browser/CI glue); validate them with the manual E2E below.

## Testing / debugging (E2E)
- Verify a subscription landed: `git -C ../DataHub_Mexicano pull` then read
  `mexicano_v3/push-subscriptions.json`.
- Fire a test send and watch the run:
  ```bash
  gh api repos/MinoPlay/DataHub_Mexicano/dispatches -f event_type=web_push \
    -F 'client_payload[title]=Mexicano 🎾' -F 'client_payload[body]=test' -F 'client_payload[url]=./'
  gh run watch --repo MinoPlay/DataHub_Mexicano \
    "$(gh run list --repo MinoPlay/DataHub_Mexicano --workflow 'Web Push Relay' -L1 --json databaseId -q '.[0].databaseId')" --exit-status
  ```
  Success log line: `Push complete. sent=<n> failed=<n> total=<n>`.
- `sent=N` means the push service accepted it; if a device shows nothing it is client-side
  (DND/muted, or iOS PWA not installed to home screen) — not the relay.
- `failed=N` with `HTTP 410`/`404` in the `::warning::` log = a dead endpoint for that
  subscription (uninstalled PWA, revoked permission, endpoint rotated). The subscription
  is **not** auto-removed; that user must re-enable push in Settings to refresh it.
- Keys mismatch (client `VAPID_PUBLIC_KEY` ≠ data-repo secret) → subscribe fails with
  `InvalidAccessError`/403.

## Constraints
- **iOS 16.4+**: only works when the PWA is installed to the home screen, not a Safari tab.
- HTTPS required (GitHub Pages OK); permission required (no silent enable).
- Subscription rot: endpoints expire and are **not** auto-pruned (intentional, see
  `web-push-relay.mjs`) — a dead endpoint keeps failing with 404/410 until the user
  re-subscribes.
- New client code needs one cold start per device to activate the new service worker before
  it ships (see `app-version.md` / `sw-fetch.js` network-first cache bypass).

## Related feature docs
- `.github/features/push-notifications.md` — truth for this feature. Read first.
- `.github/features/telegram-alerts.md` — the relay pattern this mirrors.
- `.github/features/pwa-installation.md` — install requirement (iOS).
- `.github/features/app-version.md` — SW update mechanism (network-first `cache:'reload'`).

## Update protocol
When you change push behavior, update **both** `.github/features/push-notifications.md`
(truth) and this skill in the same task. Keep in sync: `push.js` exports, `sw.js`
push/notificationclick handlers + `ASSETS`, `notification-store.js` shape, the bell's
mount point/behavior, settings UI ids/gating, trigger points, the data-repo
workflow/script, the subscriptions file path/shape, and VAPID key handling. Follow the
mexicano-tdd pipeline (RED test → GREEN in `js/**` → full `npx vitest run` → bump
`APP_VERSION` in `sw.js`).
