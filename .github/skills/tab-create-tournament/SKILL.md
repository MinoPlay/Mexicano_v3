---
name: tab-create-tournament
description: >
  Reference skill for the Create Tournament tab (route /create-tournament) of the Mexicano PWA.
  Covers purpose, rules, key files, data flow, sub-tabs. Use when working on the create-tournament page.
---

# Create Tournament tab

## Purpose
The Create Tournament page is the form behind route `#/create-tournament`. It is not part of the bottom navigation; users reach it from links on the tournament detail empty state, the tournaments page, the tournaments floating action button, or from Doodle with prefilled query parameters.

It creates a new Mexicano tournament for one date, a fixed player count, optional court numbers, and an optional access code. On successful local creation it starts round 1, creates the tournament day file on GitHub, navigates to `#/tournament/<date>`, updates the tournament index, optionally sends a Telegram alert, and refreshes the app.

## Rules / Logic
`renderCreateTournament(container, params = {})` in `js/pages/create-tournament.js` renders a flat form and owns all UI state for creation.

- Player count is selected from `PLAYER_COUNTS = [4, 8, 12, 16]`. Selecting a count calls `renderPlayerSlots(count)`, creates that many text inputs, and enables the Start Tournament button.
- Player suggestions come from `getRecentMembers()` in `js/services/members.js`. Suggestions exclude names already typed in the current slots, case-insensitively.
- `params.names` prepopulates player slots, mainly from Doodle. The page chooses the smallest valid count that fits the provided names, capped at 16, selects that count button, fills names in order, and keeps only names within the chosen count.
- `params.date` prepopulates the date input. Without it, `todayStr()` sets the date to today in `yyyy-MM-dd` format.
- Each player slot has ▲ and ▼ controls. `shiftDown(idx)` moves the selected player and the filled block below it one slot down if there is empty space after the block. `shiftUp(idx)` moves a player up only when the immediate slot above is empty. `refreshShiftButtons()` disables impossible moves.
- Start validation requires a selected count, a date, no existing tournament for the date from `loadTournamentByDate(date)`, no active tournament with the same date from `getActiveTournament()`, every player name filled, each name at most 50 characters, and no duplicate names case-insensitively.
- Court numbers are optional. If entered, `tournament-courts` is split on commas, every value must be numeric, and the count must equal `selectedCount / 4`. Values are stored as numbers.
- `accessCodeInput.value.trim() || null` becomes the tournament `accessCode`. The Disable Telegram checkbox only skips the created alert; it does not affect tournament data.
- Save flow calls `createTournament(date, names, accessCode, courts)` then `startTournament(tournament)`. After that, an async create pipeline runs: `triggerNewTournamentDayFile(tournament)` first, then navigate to `#/tournament/${date}`, then `triggerTournamentIndexEntry(tournament)`, then dynamic import of `sendTournamentCreatedAlert()` unless disabled, then dynamic import of `refreshApp()`.
- The day file write is intentionally awaited before navigation so the tournament page does not refresh against a missing GitHub day file and clear the active tournament.

## Key Files & Symbols
- `js/pages/create-tournament.js` — exports `renderCreateTournament(container, params = {})`; local helpers include `todayStr()`, `renderPlayerSlots()`, `updateSuggestions()`, `shiftDown()`, `shiftUp()`, and `refreshShiftButtons()`.
- `js/services/tournament.js` — `createTournament()`, `startTournament()`, `triggerNewTournamentDayFile()`, `triggerTournamentIndexEntry()`, `getActiveTournament()`, `loadTournamentByDate()`, `createRound1Matches()`.
- `js/services/members.js` — `getRecentMembers()` supplies datalist suggestions from current/previous month match participants, falling back to `Store.getMembers()`.
- `js/services/telegram.js` — `sendTournamentCreatedAlert()` is dynamically imported after GitHub day-file and index work unless Telegram alerts are disabled.
- `js/version.js` — `refreshApp()` is dynamically imported at the end of the create pipeline.
- `js/app.js` — maps route `/create-tournament` to `renderCreateTournament`.
- `js/pages/doodle.js` — links to `#/create-tournament?date=<date>&names=<comma-separated names>` for prefilled tournament creation.

## Data
The page does not write directly to `Store`; it delegates to `js/services/tournament.js`.

`createTournament(date, playerNames, accessCode = null, courts = null)` creates:

```javascript
{
  id,
  tournamentDate: "yyyy-MM-dd",
  players: [
    { id, name, totalPoints: 0, gamesPlayed: 0, wins: 0, losses: 0 }
  ],
  rounds: [],
  currentRoundNumber: 0,
  isStarted: false,
  isCompleted: false,
  startedAt: null,
  completedAt: null,
  accessCode,
  courts: number[] | null
}
```

`createTournament()` stores the object via `Store.setActiveTournament(tournament)` and emits `State.emit('tournament-changed', tournament)`. `startTournament()` sets `isStarted`, `startedAt`, and `currentRoundNumber = 1`, generates round 1 using `createRound1Matches(tournament.players)`, then saves tournament state.

Round 1 groups players in input order by fours. Each match is 2v2 using `player1 = group[0]`, `player2 = group[3]`, `player3 = group[1]`, and `player4 = group[2]`, with scores initialized to zero.

GitHub persistence is split:

- `triggerNewTournamentDayFile(tournament)` creates and verifies the `YYYY/YYYY-MM/YYYY-MM-DD.json` day file.
- `triggerTournamentIndexEntry(tournament)` updates `tournaments.json` with `date`, `playerCount`, `roundCount: 0`, `matchCount: 0`, `completedCount: 0`, and `isComplete: false`.

Member suggestions are read-only here. New member creation belongs to Settings and `addPlayerToPlayersJson(name)`; Create Tournament only consumes the roster/recent-member cache through `getRecentMembers()`.

## Sub-tabs / Sections
There are no sub-tabs on this route. The form sections are:

- Date picker.
- Courts and access code inputs in the info-box row.
- Disable Telegram alert checkbox.
- Number of Players selector.
- Player slot list with datalist suggestions and shift controls.
- Start Tournament button.

## Related Feature Docs
- `.github/features/tournament-management.md` — defines tournament creation constraints, player counts, duplicate-name rejection, access code behavior, round generation, store/state integration, GitHub sync, admin/write policy, and player slot shifting.
- `.github/features/add-member.md` — explains how Settings adds names to `players.json` and refreshes local member caches that later feed Create Tournament suggestions through `getRecentMembers()`.

## Update Protocol
Update this skill whenever js/pages/create-tournament.js form logic, validation, data shape, or routing changes, or when the linked feature MDs change.
