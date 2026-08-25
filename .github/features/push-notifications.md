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
   appends/dedupes the subscription (by `endpoint`) into `mexicano_v3/push-subscriptions.json`,
   storing the subscriber's `user` name on the record. A re-subscribe for an existing
   endpoint **updates its `user` tag** (does not skip), so legacy subs stored before targeted
   sends get back-filled. Subscriptions never live in the client repo.
3. **Send (data repo).** At trigger points the client fires a `repository_dispatch`
   (`event_type: web_push`, `client_payload: { title, body, url, users? }` **or**
   `client_payload: { messages: [{ users, title, body, url }] }` for per-recipient sends).
   The same
   workflow reads `mexicano_v3/push-subscriptions.json` and sends signed Web Push messages
   using the `web-push` npm lib and **VAPID keys** (`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
   repo secrets, optional `VAPID_SUBJECT` repo variable). When `users` is a
   non-empty array the send is **targeted**: only subscriptions whose stored `user` matches
   a name in the list are contacted; subscriptions without a stored
   `user` are skipped. When `users` is absent/empty the send **broadcasts** to everyone
   (legacy behavior). With `messages`, each entry is resolved in order and a subscription
   receives at most the first message it matches (never two notifications for one dispatch).
   Subscriptions that return HTTP 404/410 are **not** pruned — a stored subscription is only
   ever added or updated (re-subscribe of an existing endpoint), never deleted on send
   failure, since silently pruning "expired" endpoints previously removed entries that later
   turned out to still be valid (transient failures / endpoint rotation), making push look
   like it kept "resetting". A 404/410 means that device's subscription is dead and the user
   must re-enable push in Settings to re-subscribe.
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
- `isPushEnabled()` — `true` when `Notification.permission === 'granted'` (push already
  opted in on this device). Used internally by `resyncPushSubscription()` to decide
  whether to silently re-tag; no longer used by the notification bell (the bell now
  always renders — see below).
- `urlBase64ToUint8Array(base64String)` — converts a base64url VAPID key to a `Uint8Array`
  for `applicationServerKey`. Pads to a multiple of 4, maps `-`→`+`, `_`→`/`.
- `buildSubscribePayload(subscriptionJson, user)` →
  `{ event_type: 'web_push_subscribe', client_payload: { subscription, user } }`.
- `buildPushAlertPayload(title, body, url, users)` →
  `{ event_type: 'web_push', client_payload: { title, body, url[, users] } }`. `url` defaults
  to `'./'`; `users` (recipient names) is only included when a non-empty array is passed.
- `buildTournamentCreatedPush(date)` → `{ title:'🎾 New tournament', body:'Tournament on <date>', url:'./#/tournament/<date>' }`.
  The `#` is required: the app is a hash-based SPA (`router.js`), so a bare path (no `#`)
  is requested as a real static file and 404s when the SW/browser navigates to it.
- `buildTournamentCompletedPush(date, rankedPlayers)` → `{ title:'🏆 Tournament complete',
  body:'<date> — Winner: <name>' (or 'Tournament on <date>' when empty), url:'./#/tournament/<date>' }`.
  Legacy broadcast summary, now only used as a no-players fallback.
- `buildPushMessagesPayload(messages)` → `{ event_type:'web_push', client_payload:{ messages } }`
  where each message is `{ users, title, body, url }` — one dispatch, a different
  notification per recipient.
- `computeTournamentEloChanges(allMatches, date)` → `{ <name>: { elo, eloChange } }`. Replays
  the full ELO history with and without the tournament's own matches (`calculateAllEloRankings`)
  and returns each player's post-tournament ELO plus the delta it caused (both rounded to
  whole numbers). Returns `{}` when there are no matches.
- `buildPlayerResultPush(date, player, totalPlayers)` → `{ users:[name],
  title:'🏆 Tournament complete — <date>', body:'Rank <r>/<n> · <pts> pts · <avg> avg\nELO <elo> (<±change>)',
  url:'./#/tournament/<date>' }`. The ELO line is omitted when the player has no ELO.
- `buildTournamentCompletedMessages(date, rankedPlayers, eloByPlayer)` → one
  `buildPlayerResultPush` message per ranked participant (players without a name are skipped).
- `dispatchSubscription(subscriptionJson)` (async) — POSTs a `web_push_subscribe`
  `repository_dispatch`; resolves on HTTP 204, rejects with the GitHub error message otherwise.
- `sendPushNotification(title, body, url, users)` (async) — POSTs a `web_push` dispatch;
  optional `users` targets specific recipients (see Send step); same 204/error contract.
- `sendPushMessages(messages)` (async) — POSTs a `web_push` dispatch carrying a
  `messages` array so each recipient gets their own title/body in a single dispatch.
- `sendTournamentCreatedPush(tournament)` / `sendTournamentCompletedPush(tournament, allMatches?)` (async) —
  build from the tournament (`sendTournamentCompletedPush` ranks `tournament.players` via
  `rankPlayers`). `sendTournamentCreatedPush` **targets only the tournament's players**
  (passes their names as `users`). `sendTournamentCompletedPush` sends **one personalised
  message per participant** via `sendPushMessages`; `allMatches` defaults to
  `Store.getMatches()`. It falls back to the legacy broadcast
  (`buildTournamentCompletedPush`) only when the tournament has no players.
- `subscribeToPush()` (async, browser-only glue) — checks support, requests permission,
  gets `navigator.serviceWorker.ready`, subscribes via `PushManager`, then calls
  `dispatchSubscription(sub.toJSON())`. Throws if unsupported or permission denied.
- `resyncPushSubscription()` (async, browser-only glue) — **silent** re-tag on startup:
  no-ops unless push is supported and already granted, reads the existing
  `pushManager.getSubscription()` and, if present, re-dispatches it via
  `dispatchSubscription` so the data repo refreshes the record's `user` tag from
  `mexicano_current_user`. Never prompts. Returns `true` when it dispatched, else `false`
  (and swallows errors). Called fire-and-forget from `js/app.js` `init()` so legacy
  subscriptions gain a `user` tag without users re-enabling push.

All dispatches require a configured GitHub backend (`owner`/`repo`/`pat`); missing config
throws `GitHub backend not configured — cannot relay push`.

## Notification bell — `js/components/notification-bell.js`
`renderNotificationBell()` (async) is mounted **inline in the Home page header**
(`js/pages/home.js`, appended into the `#home-header-right` slot), anchored to the right
of the `🎾 Mexicano v<ver>` title — same as before, but no longer a fixed top-right
overlay and no longer home-page-hidden logic tied to push state. It **always renders**
(no more `isPushEnabled()` gating/disappearing act) and now doubles as a **notification
history** bell:
- Shows an unread-count badge (`.notif-bell-badge`) from
  `getUnreadCount()` (`js/services/notification-store.js`).
- Clicking opens a popup listing stored history (`getNotifications()`): title, body,
  and a formatted date per entry, newest first, plus a **"Clear all"** button
  (`clearAll()`) and an empty state ("No notifications yet.") when there's none.
- Opening the popup calls `markAllRead()`, clearing the badge.
- Listens for a `message` event from the service worker
  (`{ type: 'mexicano-notification-added' }`) to live-refresh the badge while mounted.
- **Pinned announcements** (`js/services/pinned-announcements.js`,
  `PINNED_ANNOUNCEMENTS`) render above the history list, title-only (`.notif-item-pinned`,
  📌 icon), and are **never removed by "Clear all"** — they aren't part of the IndexedDB
  history at all, just a static in-code list rendered every time the popup opens.
  Clicking a pinned entry opens a second, centered detail popup (`.notif-detail-popup`)
  with the announcement's full body (`white-space: pre-line`, mobile-width capped). Each
  popup closes via its own `×` button **or** a click outside it; the outside-click
  listener is a single module-level handler (registered once, no-op while nothing is
  open) that dismisses one layer at a time — the detail popup first (if open), then the
  notifications list on a following outside click — so closing one never cascades into
  the other. Use this list for durable, must-see rules announcements (e.g. the fine-jar
  policy) that shouldn't be dismissible like normal push history.

## Pinned announcements — `js/services/pinned-announcements.js`
Exports `PINNED_ANNOUNCEMENTS`, an array of `{ id, title, body }`. `title` is the short
line shown in the bell's list; `body` is the full text shown only in the detail popup.
To add a new durable announcement, append an entry here — no store/IndexedDB involved,
so it survives `clearAll()` and app restarts by definition (it's code, not data).
Current entries:
- `fine-jar-2026` — "🎾 The fine jar is open!" — cancellation/lateness fine rules for
  Tuesday/Thursday morning mexicano.


## Notification history store — `js/services/notification-store.js`
IndexedDB-backed history (`mexicano-notifications` DB, `notifications` object store,
keyPath `id`), shared by `sw.js` (writer) and the bell (reader), so notifications
received while the app is fully closed are still visible next time it opens.
- `addNotification({ title, body, url })` — stores `{ id, title, body, url, receivedAt,
  seq, read:false }` and prunes down to the newest `MAX_HISTORY` (30) entries.
- `getNotifications()` — all entries, newest-first (`receivedAt` desc, `seq` desc
  tie-break for same-millisecond writes).
- `getUnreadCount()` — count of entries with `read: false`.
- `markAllRead()` — sets `read: true` on every entry.
- `clearAll()` — empties the store.
- All functions **degrade gracefully to a no-op / empty result** (never throw) when
  `indexedDB` is unavailable in the current context (e.g. private browsing).

## Service worker — `sw.js`
- `push` listener: parses `event.data.json()` → **keeps** the native OS popup
  (`showNotification(title, { body, icon, data:{ url } })`) **and** calls
  `addNotification({ title, body, url })` from `notification-store.js` to persist it to
  history, then `postMessage`s all open clients (`{ type: 'mexicano-notification-added' }`)
  so an open Home tab can live-refresh its bell badge. History writing is best-effort —
  failures there never block the native popup.
- `notificationclick` listener: closes the notification, focuses an existing client or
  opens `event.notification.data.url` (default `'./'`).
- `notification-store.js` is listed in `ASSETS` for offline caching, alongside `push.js`.

## Settings page — `js/pages/settings.js`
A "Push Notifications" section with an **Enable push notifications** button that calls
`subscribeToPush()` and shows status. Button disabled when `isPushSupported()` is false.

An admin-only "Send Custom Push" section (`#custom-push-section`, gated by
`Store.isAdministrator()` in `refreshAdminVisibility()`) with a recipient dropdown
(`#custom-push-recipient`: "All devices" or a single member), title/message inputs, and a
send button that calls `sendPushNotification(title, body, './', users)` — `users` is
`[recipient]` when a member is chosen, else `null` (broadcast to all).

## Trigger Points
- Tournament created — `js/pages/create-tournament.js` fires `sendTournamentCreatedPush(tournament)`
  after the day file syncs (fire-and-forget; independent of the "Disable Telegram alert" checkbox).
- Tournament completed — `js/pages/tournament.js` fires `sendTournamentCompletedPush(tournament)`
  after `completeTournament()` (fire-and-forget, alongside the Telegram alert). Only the
  tournament's participants are notified, each with their own rank/points/average/ELO result.
- Admin custom push — Settings "Send Custom Push" → `sendPushNotification(title, body, './', users)`;
  targets all devices or a single selected member.
- (Doodle / confirmation triggers from Telegram are not yet wired for push.)

## Constraints
- **iOS 16.4+**: Web Push works only when the PWA is installed to the home screen
  (see `pwa-installation.md`), not in a Safari tab.
- **HTTPS required** — satisfied by GitHub Pages.
- **Permission required** — no silent enable; user must grant.
- **Subscription rot** — endpoints expire; the relay workflow does **not** auto-prune 404/410
  responses (by design), so a user with a dead endpoint must re-enable push in Settings.
