# Tournament Confirmation Popup

## Purpose
On app open (Home page render), if there is an active tournament and the current user is one of its players, show a one-time modal pop-up asking them to confirm attendance. Fires once per tournament per user.

## Trigger Conditions (all must be true)
1. Active tournament exists (non-null, not completed)
2. Current user name (from `Store.getCurrentUser()`) matches a player in `activeTournament.players` (case-insensitive)
3. User has NOT already confirmed for this tournament. Backend is source of truth:
   the popup is suppressed when the matching `activeTournament.players[i].confirmed`
   is truthy (loaded from the day file), **or** when the local flag
   `Store.get('confirmed_tournament_' + date)` is set. This prevents the popup from
   re-appearing when the same user opens the app on a different browser/device where
   the local flag is absent but the backend already records the confirmation.

## UI
- Modal overlay centered on screen
- Title: "🎾 Active Tournament"
- Body: "You are registered for the tournament on {formatted date}. Please confirm your attendance."
- Single button: **[CONFIRM]** — on click:
  1. Store local flag: `Store.set('confirmed_tournament_' + date, true)`
  2. Persist to tournament file: `confirmAttendance(currentUser)` (see below)
  3. Send Telegram alert via `sendTournamentConfirmationAlert(playerName, tournamentDate)`
  4. Close/remove modal

## Persistence In Tournament File
Confirmation is stored on the tournament itself so **everyone** sees who confirmed
(not just the confirming user's local device):

- Shape: each `tournament.players[i]` gains an optional `confirmed: true`.
- Written into the day file (`YYYY/YYYY-MM/YYYY-MM-DD.json` → `tournament.players`) via
  `saveTournamentState()` → `markMatchDateDirty()` → GitHub push. Loaded back with the
  day file / `fetchActiveTournamentJson()`; render reads `player.confirmed`.

### Service (`js/services/tournament.js`)
- `markPlayerConfirmed(tournament, name)` — pure helper. Case-insensitive name match;
  sets `confirmed: true` on the matching player. Returns `{ tournament, changed }`.
  `changed` is false when the name is not a player or was already confirmed.
- `confirmAttendance(playerName)` — loads the active tournament, marks the player,
  persists via `saveTournamentState`. **NOT admin-gated** — self-confirmation is
  allowed for every player (admin and non-admin). Returns true when a change was made,
  false otherwise (no active tournament, name not a player, already confirmed).

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

Click → `confirmAttendance(currentUser)` → local flag + Telegram alert + re-render
(checkmark appears, button hides).

## Telegram Message Format
```
🎾 {playerName} confirmed attendance for tournament on {tournamentDate}
```

## WhatsApp Service
- New export in `js/services/whatsapp.js`: `sendTournamentConfirmationAlert(playerName, tournamentDate)`
- Loads config the same way as `sendDoodleAlert`
- Fire-and-forget (no throw on failure)

## Pure Helpers (home.js exports, testable)
- `shouldShowConfirmationPopup(activeTournament, currentUser, alreadyConfirmed)` → boolean
- `buildConfirmationAlertMessage(playerName, tournamentDate)` → string

## File References
- **Pop-up rendering**: `js/pages/home.js` — `renderHome()`, `shouldShowConfirmationPopup()`, `buildConfirmationAlertMessage()`; popup CONFIRM also calls `confirmAttendance()`.
- **Persistence + confirm button + checkmark**: `js/pages/tournament.js` (`renderMatchesTab`, `renderLeaderboardTab`).
- **Service**: `js/services/tournament.js` — `markPlayerConfirmed()`, `confirmAttendance()`.
- **Telegram service**: `js/services/telegram.js` — `sendTournamentConfirmationAlert()`
- **Tests**: `tests/pages/home-confirmation.test.js`, `tests/tournament/attendance-confirmation.test.js`
