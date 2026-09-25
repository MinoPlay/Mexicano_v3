# Telegram Alerts

## Purpose
Notify a Telegram group via a Telegram bot whenever a doodle entry is saved/deleted,
when a player confirms tournament attendance, or when a manual test is triggered.

## Architecture — Supabase outbox relayed through GitHub Actions
Many networks (e.g. corporate WiFi) block `api.telegram.org`, so the browser cannot
send Telegram messages directly. Alerts remain relayed through DataHub GitHub Actions,
but the browser no longer holds a GitHub PAT:

1. A successful domain mutation commits a `notification_outbox` record in Supabase.
2. The server-side outbox dispatcher fires GitHub `repository_dispatch`
   (`event_type: telegram_alert`) using a GitHub token stored as a Supabase secret.
3. A workflow in the data repo (`.github/workflows/telegram-relay.yml`) receives the
   event and sends the message via the Telegram Bot API from a GitHub runner (not
   blocked). Bot token + chat id live as repo **secrets**, never in the client.

The client only receives confirmation that the outbox item was persisted. Delivery
attempts, retries, and permanent failures are tracked server-side.

## Trigger Points
- `DoodleEditSession.save()` in `js/pages/doodle.js` — after `pushDoodleNow()` commits, fires `sendDoodleAlert()` per changed player
- Tournament confirmation popup in `js/pages/home.js` — fires `sendTournamentConfirmationAlert()` when a player confirms
- Tournament creation in `js/pages/create-tournament.js` — after `startTournament()`, staggered fire-and-forget chain fires `sendTournamentCreatedAlert()`. Skipped when the "Disable Telegram alert" checkbox is checked.
- Tournament completion in `js/pages/tournament.js` — after `completeTournament()`, fires `sendTournamentCompletedAlert()`
- Settings "Send Test Alert" button — fires `sendTelegramTestAlert()` (default group)
- Settings "Test Tournament Group" button — fires `sendTournamentTestAlert()` (tournament group, `target: 'tournaments'`)

## Message Format
```
🎾 Doodle update — {playerName} ({yearMonth})
✅ Added: {selectedAdded.join(', ') || 'none'}
❌ Removed: {selectedRemoved.join(', ') || 'none'}
```
Confirmation:
```
🎾 {playerName} confirmed attendance for tournament on {tournamentDate}
```
Tournament created:
```
🔑 Code: {accessCode || 'none'}

🎾 New tournament — {tournamentDate}

Court 1: {p1} & {p2} vs {p3} & {p4}

Court 2: ...
```
Code sits on top, blank line, then each court match-up separated by a blank line for readability.
Tournament completed:
```
🏆 Tournament complete — {tournamentDate}
Final ranking:
1. {name} — {totalPoints} pts
2. ...
```
Test:
```
📞 Mexicano test alert
User: {currentUser}
Time: {ISO timestamp}
```

## Telegram Groups (two chats)
- **Default group** (`TELEGRAM_CHAT_ID`): doodle updates, attendance confirmations, test alerts.
- **Tournament group** `NotOfficialOfficialPadelClub` (id `-5458909914`, `TELEGRAM_CHAT_ID_TOURNAMENTS`): tournament **created** + **completed** alerts only.
- Routing: the client sends `client_payload.target` (a *name*, e.g. `'tournaments'`) — never a raw chat id. Both chat ids are **hardcoded/secret in the data-repo workflow**, which maps the target name to a chat id. When `target` is absent, the workflow uses the default group.
- **Data-repo workflow change required** (`.github/workflows/telegram-relay.yml` in `MinoPlay/DataHub_Mexicano`): map the target to the right chat id, e.g.
  ```yaml
  chat_id: ${{ github.event.client_payload.target == 'tournaments' && vars.TELEGRAM_CHAT_ID_TOURNAMENTS || secrets.TELEGRAM_CHAT_ID }}
  ```
  (or a `case`/`if` step). Store `-5458909914` as a repo variable/secret there.

## GitHub repository_dispatch
- Sent only by the Supabase `dispatch-outbox` function.
- URL: `POST https://api.github.com/repos/{owner}/{repo}/dispatches`
- Headers: `Authorization: Bearer {pat}`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`
- Body: `{ "event_type": "telegram_alert", "client_payload": { "text": "...", "kind": "...", "target": "<optional group name>" } }`
- Success: HTTP 204 No Content
- Browser has no GitHub credential.

## Workflow (data repo)
- File: `.github/workflows/telegram-relay.yml` in the data repo (`MinoPlay/DataHub_Mexicano`)
- Trigger: `on: repository_dispatch: types: [telegram_alert]`
- Sends `github.event.client_payload.text` to `https://api.telegram.org/bot{secret}/sendMessage`
- Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `chat_id` is the group id (negative, e.g. `-5375683887`; supergroups use `-100...`)

## Settings UI
- Section "Telegram Alerts" in Settings page (visible to all users)
- Test button always enabled; triggers a relay dispatch
- Shows explicit error when the outbox request is rejected

## Behavior
- Fire-and-forget for doodle/confirmation triggers: they `.catch` and log failures, never block UI
- Outbox insertion errors are surfaced by the test button
- Logs explicit skip reason when a doodle change has no added/removed dates
- Only fires on explicit user saves
- Doodle trigger happens post-commit: alerts are enqueued only after the Supabase mutation succeeds

## File References
- **Service (client)**: `js/services/telegram.js` — `sendDoodleAlert`, `sendTournamentConfirmationAlert`, `sendTournamentCreatedAlert`, `sendTournamentCompletedAlert`, `sendTelegramTestAlert`, `sendTournamentTestAlert`, `dispatchTelegramAlert`
- **Triggers**: `js/pages/doodle.js` — `DoodleEditSession.save()`; `js/pages/home.js` — confirmation popup; `js/pages/create-tournament.js` — creation; `js/pages/tournament.js` — completion
- **Settings UI**: `js/pages/settings.js`
- **Workflow (data repo)**: `.github/workflows/telegram-relay.yml`
