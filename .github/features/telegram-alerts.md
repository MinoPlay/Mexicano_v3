# Telegram Alerts

## Purpose
Notify a Telegram group via a Telegram bot whenever a doodle entry is saved/deleted,
when a player confirms tournament attendance, or when a manual test is triggered.

## Architecture — relayed through GitHub Actions
Many networks (e.g. corporate WiFi) block `api.telegram.org`, so the browser cannot
send Telegram messages directly. `api.github.com` stays reachable (it is the app's
data backend). Therefore alerts are **relayed**:

1. Client fires a GitHub `repository_dispatch` event (`event_type: telegram_alert`,
   `client_payload.text`) on the configured data repo (`Store.getGitHubConfig()` →
   `owner`/`repo`/`pat`).
2. A workflow in the data repo (`.github/workflows/telegram-relay.yml`) receives the
   event and sends the message via the Telegram Bot API from a GitHub runner (not
   blocked). Bot token + chat id live as repo **secrets**, never in the client.

The client no longer contacts Telegram and no longer reads `config.json`
`telegram_alerts`. Success on the client only means GitHub accepted the dispatch
(HTTP 204); actual delivery happens in the workflow.

## Trigger Points
- `DoodleEditSession.save()` in `js/pages/doodle.js` — after `pushDoodleNow()` commits, fires `sendDoodleAlert()` per changed player
- Tournament confirmation popup in `js/pages/home.js` — fires `sendTournamentConfirmationAlert()` when a player confirms
- Tournament creation in `js/pages/create-tournament.js` — after `startTournament()`, fires `sendTournamentCreatedAlert()`
- Tournament completion in `js/pages/tournament.js` — after `completeTournament()`, fires `sendTournamentCompletedAlert()`
- Settings "Send Test Alert" button — fires `sendTelegramTestAlert()`

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
- URL: `POST https://api.github.com/repos/{owner}/{repo}/dispatches`
- Headers: `Authorization: Bearer {pat}`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`
- Body: `{ "event_type": "telegram_alert", "client_payload": { "text": "...", "kind": "...", "target": "<optional group name>" } }`
- Success: HTTP 204 No Content
- PAT needs push (Contents write) access to the data repo — the app's existing PAT already has it

## Workflow (data repo)
- File: `.github/workflows/telegram-relay.yml` in the data repo (`MinoPlay/DataHub_Mexicano`)
- Trigger: `on: repository_dispatch: types: [telegram_alert]`
- Sends `github.event.client_payload.text` to `https://api.telegram.org/bot{secret}/sendMessage`
- Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- `chat_id` is the group id (negative, e.g. `-5375683887`; supergroups use `-100...`)

## Settings UI
- Section "Telegram Alerts" in Settings page (visible to all users)
- Test button always enabled; triggers a relay dispatch
- Shows explicit error when GitHub is not configured or the dispatch is rejected

## Behavior
- Fire-and-forget for doodle/confirmation triggers: they `.catch` and log failures, never block UI
- Client dispatch rejects with the GitHub API `message` on non-204 responses (surfaced by the test button)
- Logs explicit skip reason when a doodle change has no added/removed dates
- Only fires on explicit user saves
- Doodle trigger happens post-commit: alerts start only after the GitHub write of the monthly doodle + changelog succeeds

## File References
- **Service (client)**: `js/services/telegram.js` — `sendDoodleAlert`, `sendTournamentConfirmationAlert`, `sendTournamentCreatedAlert`, `sendTournamentCompletedAlert`, `sendTelegramTestAlert`, `dispatchTelegramAlert`
- **Triggers**: `js/pages/doodle.js` — `DoodleEditSession.save()`; `js/pages/home.js` — confirmation popup; `js/pages/create-tournament.js` — creation; `js/pages/tournament.js` — completion
- **Settings UI**: `js/pages/settings.js`
- **Workflow (data repo)**: `.github/workflows/telegram-relay.yml`
