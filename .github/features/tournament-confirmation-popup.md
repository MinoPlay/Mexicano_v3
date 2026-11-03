# Tournament Confirmation Popup

## Purpose
On app open (Home page render), if there is an active tournament and the current user is one of its players, show a one-time modal pop-up asking them to confirm attendance. Fires once per tournament per user.

## Trigger Conditions (all must be true)
1. Active tournament exists (non-null, not completed)
2. Current user name (from `Store.getCurrentUser()`) matches a player in `activeTournament.players` (case-insensitive)
3. User has NOT already confirmed for this tournament. Supabase is the single
   source of truth: the popup is suppressed when the matching
   `activeTournament.players[i].confirmed` is truthy. That flag is hydrated from
   `tournament_players.confirmed` on every pull, so the popup stays suppressed on
   every browser/device the player uses.

## UI
- Modal overlay centered on screen
- Title: "🎾 Active Tournament"
- Body: "You are registered for the tournament on {formatted date}. Please confirm your attendance."
- Single button: **[CONFIRM]** — on click:
  1. Persist the confirmation: `confirmAttendanceAndPush(currentUser)` (see below)
  2. Send Telegram alert via `sendTournamentConfirmationAlert(playerName, tournamentDate)`
  3. Close/remove modal

## Persistence In Tournament File
Confirmation is stored on the tournament itself so **everyone** sees who confirmed
(not just the confirming user's local device):

- Shape: each `tournament.players[i]` gains an optional `confirmed: true`.
- **Written server-side by GitHub Actions, not by a direct browser commit.** The app
  optimistically mutates the local Store copy (`markPlayerConfirmed`, so the UI updates
  immediately) and fires a `repository_dispatch` event (`confirm_attendance`,
  `client_payload: { date, name }`) at the data repo (MinoPlay/DataHub_Mexicano). Its
  `.github/workflows/confirm-attendance.yml` workflow runs
  `mexicano_v3/scripts/confirm_attendance.py`, which finds the day file
  (`YYYY/YYYY-MM/YYYY-MM-DD.json`), sets `tournament.players[i].confirmed = true` for
  the exact-matching player name, and commits + pushes it. This mirrors how Telegram
  alerts are relayed (`js/services/telegram.js`) — the browser only needs to reach
  `api.github.com`, not the workflow runner.
- Loaded back with the day file / `fetchActiveTournamentJson()`; render reads
  `player.confirmed`.

### Service (`js/services/tournament.js`)
- `markPlayerConfirmed(tournament, name)` — pure helper. Case-insensitive name match;
  sets `confirmed: true` on the matching player. Returns `{ tournament, changed }`.
  `changed` is false when the name is not a player or was already confirmed.
- `confirmAttendance(playerName)` — loads the active tournament and marks the player
  in the in-memory copy (optimistic UI update) via `markPlayerConfirmed`. **NOT
  admin-gated** — self-confirmation is allowed for every player (admin and
  non-admin). Returns true when a change was made, false otherwise (no active
  tournament, name not a player, already confirmed).
- `confirmAttendanceAndPush(playerName)` — calls `confirmAttendance`, then
  `dispatchConfirmAttendance(date, playerName)` (`js/services/backend.js`), which
  invokes the `domain-mutation` edge function with the `confirm_attendance`
  operation. That is the durable write; the optimistic local change is discarded on
  the next pull and replaced by the hydrated Supabase value. Rejects if the mutation
  fails, so the caller can withhold the Telegram alert and show an error dialog
  (`js/components/error-dialog.js`).

## Green Checkmark (Tournament Page)
A green `✅` (`span.confirm-check`, `color:var(--color-success)`,
`title="Confirmed attendance"`) is shown next to a confirmed player's name in
`js/pages/tournament.js`:
- **Matches tab** — appended to each confirmed player name in the match cards
  (via a `confirmedNames` Set + `nameWithCheck()` helper).
- **Leaderboard fallback table** — appended to the `name-cell` when `p.confirmed`
  (the `tournament.players[]`-based table used for active/in-progress tournaments).
- NOTE: the stats-based leaderboard (completed tournaments with match history, rendered
  by the shared `renderDayStatsInto` from the Statistics page) is not decorated —
  confirmation is an attendance signal for the upcoming/active tournament.

## Confirm Button (Tournament Page)
The Matches tab shows a **"✅ Confirm attendance"** button (`btn btn-success btn-block`,
id `confirm-attendance-btn`) when all are true:
- Tournament is not completed.
- Current user (`Store.getCurrentUser()`) is one of `tournament.players` (case-insensitive).
- That player has not yet confirmed.

Click → `confirmAttendanceAndPush(currentUser)` → Supabase write + Telegram alert +
re-render (checkmark appears, button hides). On failure, an error dialog
(`showErrorDialog`) reports the actual error message and the button/popup resets so
the user can retry.

## Telegram Message Format
```
🎾 {playerName} confirmed attendance for tournament on {tournamentDate}
```

## WhatsApp Service
- New export in `js/services/whatsapp.js`: `sendTournamentConfirmationAlert(playerName, tournamentDate)`
- Loads config the same way as `sendDoodleAlert`
- Fire-and-forget (no throw on failure)

## Pure Helpers (home.js exports, testable)
- `shouldShowConfirmationPopup(activeTournament, currentUser)` → boolean
- `buildConfirmationAlertMessage(playerName, tournamentDate)` → string

## File References
- **Pop-up rendering**: `js/pages/home.js` — `renderHome()`, `shouldShowConfirmationPopup()`, `buildConfirmationAlertMessage()`; popup CONFIRM calls `confirmAttendanceAndPush()`.
- **Confirm button + checkmark**: `js/pages/tournament.js` (`renderMatchesTab`, `renderLeaderboardTab`).
- **Service**: `js/services/tournament.js` — `markPlayerConfirmed()`, `confirmAttendance()`, `confirmAttendanceAndPush()`.
- **Supabase mutation**: `js/services/backend.js` — `dispatchConfirmAttendance()`;
  `supabase/functions/domain-mutation/index.ts` — `confirmAttendance` operation.
- **Telegram service**: `js/services/telegram.js` — `sendTournamentConfirmationAlert()`
- **Error dialog**: `js/components/error-dialog.js` — `showErrorDialog()`
- **Tests**: `tests/pages/home-confirmation.test.js`, `tests/tournament/attendance-confirmation.test.js`
