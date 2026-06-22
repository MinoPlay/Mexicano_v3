# Tournament Confirmation Popup

## Purpose
On app open (Home page render), if there is an active tournament and the current user is one of its players, show a one-time modal pop-up asking them to confirm attendance. Fires once per tournament per user.

## Trigger Conditions (all must be true)
1. Active tournament exists (non-null, not completed)
2. Current user name (from `Store.getCurrentUser()`) matches a player in `activeTournament.players` (case-insensitive)
3. User has NOT already confirmed for this tournament (`Store.get('confirmed_tournament_' + date)` is falsy)

## UI
- Modal overlay centered on screen
- Title: "🎾 Active Tournament"
- Body: "You are registered for the tournament on {formatted date}. Please confirm your attendance."
- Single button: **[CONFIRM]** — on click:
  1. Store confirmation: `Store.set('confirmed_tournament_' + date, true)`
  2. Send WhatsApp alert via `sendTournamentConfirmationAlert(playerName, tournamentDate)`
  3. Close/remove modal

## WhatsApp Message Format
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
- **Pop-up rendering**: `js/pages/home.js` — `renderHome()`, `shouldShowConfirmationPopup()`, `buildConfirmationAlertMessage()`
- **WhatsApp service**: `js/services/whatsapp.js` — `sendTournamentConfirmationAlert()`
- **Tests**: `tests/pages/home-confirmation.test.js`
