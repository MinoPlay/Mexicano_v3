---
name: event-firings
description: >
  Reference and operational guide for the Mexicano PWA's outbound "event firings" — Telegram
  alerts, GitHub-backend writes, and Web Push notifications. Explains how each channel is wired,
  how to set it up, and the ordering/reliability rules that stop events from failing silently or
  racing (e.g. an alert firing while the GitHub write is lost). Use this whenever you add, change,
  debug, or review anything that sends a Telegram alert, writes to the GitHub data repo, or sends
  a push notification — including the attendance-confirm, tournament create/complete, and doodle
  save flows. Also use it when someone reports "I got the Telegram/notification but the backend
  didn't update" or any lost/duplicate/silent event. Keep this skill updated when these flows,
  their ordering, or newly discovered corner cases change.
---

# Event Firings

## Purpose
The app has **no server**. Every outbound side effect is a client-initiated "event firing" over
`api.github.com` using the user's PAT. There are three channels, and the recurring bug class is a
**timing/ordering race**: one channel fires while another is skipped, debounced away, or fails
silently. This skill is the single place that describes all three channels, how to set them up,
and the rules that keep them consistent.

The three channels:
1. **GitHub backend** — the source of truth. Writes JSON files to the data repo via the Contents API.
2. **Telegram alerts** — relayed: client fires a `repository_dispatch`, a data-repo workflow sends
   the actual message. See also the `tab-doodle` skill and `.github/features/telegram-alerts.md`.
3. **Web Push notifications** — also relayed via `repository_dispatch`; see the `push-notifications`
   skill and `.github/features/push-notifications.md`.

All three go through the same GitHub PAT, so if the backend is unreachable, all three are affected.

## The core principle: persist first, notify second, never fail silently
A notification (Telegram or Push) is a **promise to the user that the data was saved**. If the
notification can fire while the GitHub write is lost, users see "confirmed!" while the backend is
stale — the exact race we keep hitting. Three rules prevent it:

1. **Persist before you notify.** `await` the GitHub write, and only fire Telegram/Push **after**
   it resolves. Notifications are downstream of persistence, never parallel to it.
2. **Persist reliably, not on a debounce.** For user-visible confirmations, use an **immediate,
   verified, retried** write — not the 1.5s debounced auto-sync, which is cancellable and lost if
   the app closes or the route changes within the window.
3. **Never swallow failures.** Every firing is wrapped so a failure is (a) logged to console with a
   `[telegram]` / `[push] ` / `[github]` prefix, (b) surfaced to the user (toast / disabled button /
   dialog step), and (c) for critical GitHub writes, recorded via `logError()` so it appears in the
   admin **Logs** tab. A caught-and-ignored error is a silent failure — the bug we are fighting.

## GitHub backend — the two write paths
There are deliberately two ways to write, and picking the wrong one causes lost data.

### Debounced auto-sync (best-effort, batch)
`Store.set(key, value)` → `schedulePush(key)` → 1500ms debounce → `executePush()` → `pushAll()`.
- Serialised (`_pushInProgress` / `_pushPending`) and status-tracked (`onSyncStatus`).
- **Cancellable and loss-prone**: `cancelPendingSync()` clears the timer; a route change, tab close,
  or another `Store.set` resets it. Fine for low-stakes incremental state, **never** for something a
  user just got told "saved".
- `schedulePush` intentionally **skips `doodle_*` keys** — doodle is pushed explicitly.

### Immediate + verified (critical, single file)
Use these when the user is told the action succeeded:
- `pushTournamentDayFile(tournament, attempts=3)` — writes the day file, **reads it back to verify**,
  retries with backoff, keeps the date dirty on failure, throws after exhausting retries.
- `flushPush()` — bypasses the debounce and runs `executePush()` now (tournament create/complete).
- `pushDoodleNow(ym)` — writes the doodle month + changelog immediately, merging remote entries first.

Rule of thumb: **anything that triggers a Telegram/Push notification must be backed by an immediate
verified write, awaited before the notification fires.** Call `cancelPendingSync()` first so a stale
debounced `pushAll` can't clobber the fresh write with an older snapshot.

## Telegram — how it's wired
- Module: `js/services/telegram.js`. Every sender ends in `dispatchTelegramAlert(text, meta, target?)`,
  which POSTs `event_type: telegram_alert`, `client_payload: { text, kind, target? }` to
  `…/repos/{owner}/{repo}/dispatches`. **Success = HTTP 204** (GitHub accepted the dispatch); actual
  delivery happens in the data-repo workflow `telegram-relay.yml` using `TELEGRAM_BOT_TOKEN` /
  `TELEGRAM_CHAT_ID` secrets. A non-204 **throws** — callers must catch and surface it.
- Config comes from `Store.getGitHubConfig()` (`owner`/`repo`/`pat`); missing config throws
  `GitHub backend not configured — cannot relay Telegram alert`.
- Two groups: default, plus `target: 'tournaments'` (`TARGET_TOURNAMENTS`) for created/completed
  alerts only. The client sends a target **name**; chat ids live in the workflow.
- Senders: `sendDoodleAlert`, `sendTournamentConfirmationAlert`, `sendTournamentCreatedAlert`,
  `sendTournamentCompletedAlert`, `sendTelegramTestAlert`, `sendTournamentTestAlert`.
- Empty-diff guard: `sendDoodleAlert` no-ops when nothing was added/removed — don't fire noise.

## Web Push — how it's wired
- Module: `js/services/push.js`; see the `push-notifications` skill for full detail.
- Same relay shape: `repository_dispatch` (`web_push_subscribe` to register, `web_push` to send);
  the data-repo workflow signs and sends via VAPID. **Client success = HTTP 204**, not delivery.
- `sw.js` has the `push` and `notificationclick` listeners. `VAPID_PUBLIC_KEY` in `push.js` must match
  the data-repo secret.
- Senders: `sendTournamentCreatedPush`, `sendTournamentCompletedPush`, `sendPushNotification`,
  `subscribeToPush`. Fire-and-forget, but always `.catch` with a `[push] ` log.

## Event catalog — trigger point → persistence → notifications
Keep this table in sync; it is the quickest way to see if a flow is missing a channel or ordering guard.

| Trigger (file) | GitHub write (how) | Telegram | Push |
|---|---|---|---|
| Attendance confirm — `pages/tournament.js`, `pages/home.js` → `confirmAttendanceAndPush()` | `pushTournamentDayFile` (immediate, verified) — **awaited before alert** | `sendTournamentConfirmationAlert` (after write) | — |
| Doodle save — `pages/doodle.js` `DoodleEditSession.save()` | `pushDoodleNow(ym)` (immediate) — **awaited before alert** | `sendDoodleAlert` per changed player (after write) | — |
| Tournament create — `pages/create-tournament.js` | `triggerNewTournamentDayFile` (verified) then index; navigation waits on day file | `sendTournamentCreatedAlert` (after day file, skippable via checkbox) | `sendTournamentCreatedPush` |
| Tournament complete — `pages/tournament.js` → `completeTournament()` | `flushPush()` day file then `updateTournamentIndexEntry`, serialised; errors → `logError` (Logs tab) | `sendTournamentCompletedAlert` | `sendTournamentCompletedPush` |
| Settings test buttons — `pages/settings.js` | — | `sendTelegramTestAlert` / `sendTournamentTestAlert` | `sendPushNotification` |

## Setup
1. **GitHub backend/PAT**: Settings tab → owner/repo/PAT, stored as `github_config`. `testConnection()`
   validates. Without it, all three channels are disabled (and throw where awaited).
2. **Telegram**: data-repo secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (+ the tournament group
   chat id mapped in `telegram-relay.yml`). The client needs nothing beyond the PAT.
3. **Web Push**: data-repo secrets `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`; the public key must equal
   `VAPID_PUBLIC_KEY` in `js/services/push.js`. User opts in via Settings → "Enable push notifications".
4. **Verify end-to-end** with the Settings test buttons before trusting a real flow.

## Common failure modes & corner cases
Add newly discovered cases here — this list is the institutional memory for this bug class.

- **Alert fired but backend not updated (the classic race).** Cause: the write was on the debounced
  auto-sync (1.5s) and got cancelled/lost (app closed, route change, timer reset) while the alert
  fired independently. Fix: immediate verified write, awaited, alert gated on its success. This is
  exactly why `confirmAttendanceAndPush()` exists instead of `confirmAttendance()` + `Store.set`.
- **409 fast-forward conflict on GitHub.** Cause: two writes to the same branch concurrently (e.g.
  day file + index at once). Fix: **serialise** commits (day file, then index) and rely on
  `writeFile`'s one-shot 409 retry that re-reads the SHA.
- **Debounced push clobbers a fresh write.** Cause: a pending `pushAll` fires after an immediate write
  with an older in-memory snapshot. Fix: `cancelPendingSync()` before the immediate write.
- **"Success" that never delivered.** Telegram/Push client success is only HTTP 204 = *dispatch
  accepted*. If a message never arrives, look in the **data-repo workflow runs**, not the client.
- **Missing config throws mid-flow.** Guard early; treat a throw as a user-visible error, not a no-op.
- **Notification noise.** Skip empty diffs (`sendDoodleAlert`) and respect the create-tournament
  "Disable Telegram alert" checkbox.
- **Silent swallow.** Any `.catch(() => {})` around a firing hides failures. At minimum log with the
  channel prefix; for critical GitHub writes also call `logError()` so the Logs tab shows it.

## Checklist when adding or changing an event firing
1. Does a user get told "done"? If so, back it with an **immediate verified** GitHub write, not the
   debounce; `cancelPendingSync()` first.
2. `await` the GitHub write; fire Telegram/Push **only after** it resolves.
3. Show a **pending** state (disabled button / "Saving…" / dialog step) so the user knows not to close
   the page mid-write.
4. Catch every firing; log with `[telegram]` / `[push] ` / `[github]`; surface to the user; for
   critical GitHub writes call `logError()`.
5. Skip empty/no-op notifications; honour user opt-outs.
6. Add/adjust a **failing-first test** under `tests/**` (per the repo's TDD rule), then implement.
7. Update the **event catalog table**, feature docs, and this skill.

## Key files & symbols
- `js/services/telegram.js` — `dispatchTelegramAlert`, all `send*Alert` senders, `TARGET_TOURNAMENTS`.
- `js/services/push.js` — `sendPushNotification`, `send*Push`, `subscribeToPush`, `VAPID_PUBLIC_KEY`.
- `js/services/github.js` — `writeFile`/`readFile` (409 retry), `pushTournamentDayFile` (verified),
  `flushPush`, `pushDoodleNow`, `schedulePush`, `executePush`/`pushAll`, `cancelPendingSync`,
  `markMatchDateDirty`, `onSyncStatus`.
- `js/services/tournament.js` — `confirmAttendance`, `confirmAttendanceAndPush` (persist-then-alert),
  `completeTournament`, `triggerNewTournamentDayFile`, `saveTournamentState`.
- `js/services/round-log.js` — `logError` (surfaces to the admin Logs tab).
- `js/pages/create-tournament.js`, `js/pages/tournament.js`, `js/pages/home.js`, `js/pages/doodle.js`,
  `js/pages/settings.js` — the trigger sites.
- `sw.js` — `push` / `notificationclick` listeners; `APP_VERSION` cache bump.
- Data repo (`DataHub_Mexicano`) — `telegram-relay.yml`, the web-push relay workflow, and the secrets.

## Related docs & skills
- `.github/features/telegram-alerts.md`, `.github/features/push-notifications.md` — canonical channel specs.
- `push-notifications`, `tab-doodle`, `tab-settings`, `tab-logs` skills — the pages/services involved.

## Update protocol (keep this skill alive)
This skill must evolve with the code. Update it in the **same task** whenever you:
- add, remove, or re-order any event firing (a new sender, a new trigger site, changed ordering);
- change a persistence strategy (debounced ↔ immediate/verified) or the persist-before-notify gate;
- change the relay contract (event types, payload shape, target groups, success codes, secrets);
- discover a new corner case or failure mode — append it to **Common failure modes & corner cases**
  with cause and fix so it isn't rediscovered.
When you touch a flow, re-verify the **event catalog table** row and correct it. If a change alters
runtime behaviour, follow the repo TDD rule (failing test first) and bump `sw.js` `APP_VERSION`.
