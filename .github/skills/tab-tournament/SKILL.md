---
name: tab-tournament
description: >
  Reference skill for the Tournament detail tab (route /tournament/:date) of the Mexicano PWA,
  including the Matches and Leaderboard sub-tabs. Covers purpose, rules, key files, data flow.
  Use when working on the tournament detail page.
---

# Tournament (detail) tab

## Purpose

The Tournament detail tab renders one tournament at `#/tournament/:date`, where `:date` is a `yyyy-MM-dd` tournament date. The route is mapped in `js/app.js` to `renderTournament(container, params)` from `js/pages/tournament.js`.

The page is the live tournament workspace and the historical tournament viewer. It loads an active in-progress tournament when available, falls back to cached or fetched day match data for completed tournaments, and exposes two sub-tabs:

- Matches — round navigation, match cards, scoring, attendance confirmation, round advancement, completion, access-code edit, and delete controls.
- Leaderboard — per-day standings, using rich Statistics-page rendering when match history exists and a local tournament-player fallback while a tournament is active.

## Rules / Logic

`renderTournament(container, params)` owns page-local state:

- `date` from `params.date`.
- `tournament`, loaded by `initLoad()` and refreshed by `loadTournament()`.
- `currentTab`, initially `'matches'`, but switched to `'leaderboard'` when a completed tournament loads.
- `viewingRound`, where `-1` means "latest round".
- `isLoading` for on-demand GitHub loads.

Loading rules:

- If `getActiveTournament()` matches the route date, use it first.
- With GitHub PAT configured (`Store.getGitHubConfig()?.pat`), perform a background refresh via `fetchActiveTournamentJson()`.
- If GitHub has no in-progress tournament for the active local date, clear stale active state, call `readDayMatches(date)`, merge fetched matches into `mexicano_matches`, then rebuild with `loadTournamentByDate(date)`.
- If no active tournament exists, load completed local data via `loadTournamentByDate(date)`.
- If local data is missing and GitHub is configured, call `ensureDayMatchesLoaded(date)`, then retry `loadTournamentByDate(date)`.
- Otherwise render "No tournament found" with a link to `#/create-tournament`.

Header and navigation rules:

- `getStatusBadge(tournament)` displays Completed, In Progress, or Not Started.
- Tournament prev/next buttons use `Store.getTournamentsIndex()`, sorted newest-first by date. All index entries are navigable; non-admins can read active tournaments.
- The access code appears in the tab row when `tournament.accessCode` exists.
- Admins (`Store.isAdministrator()`) see the ✎ access-code editor. Saving calls `updateAccessCode(date, codeToSave)`, shows a toast, and re-renders.

Sub-tab switching:

- The tab row is `#tournament-tabs`.
- Buttons have `data-tab="matches"` and `data-tab="leaderboard"`.
- Click handling reads `tab.dataset.tab`, assigns `currentTab`, and calls `render()`.
- `currentTab` is local closure state, not stored in `Store` or the URL.

Matches tab rules:

- `renderMatchesTab(content, roundIdx, totalRounds, isLatestRound)` renders only the selected round.
- `getViewingRoundIndex()` resolves `viewingRound === -1` to the latest round.
- Round navigation buttons mutate `viewingRound` and re-render.
- Editing a past round shows a warning: "Editing will regenerate subsequent rounds".
- Match cards are rendered inline in `js/pages/tournament.js`; the page does not import `js/components/match-card.js`.
- Court labels use `tournament.courts?.[idx] ?? idx + 1`.
- Confirmation checkmarks are computed from `tournament.players[].confirmed` and appended by the local `nameWithCheck()` helper.
- A non-completed match shows "Tap to score" only for admins and only when the tournament is not completed.
- Match-card click listeners are attached only for admins and incomplete tournaments.

Score entry:

- `openScoreSheet(roundIdx, matchIdx)` is an inline bottom sheet in `js/pages/tournament.js`; the page does not import `js/components/score-input.js`.
- Existing completed scores prefill the inputs.
- Score presets are `[9,16]`, `[10,15]`, `[11,14]`, `[12,13]`, `[13,12]`, `[14,11]`, `[15,10]`, `[16,9]`.
- Typing either score auto-fills the complement to 25 when the value is between 0 and 25.
- Confirm validation requires both scores to parse, both be non-negative, and `s1 + s2 === 25`.
- On success, it calls `setMatchScore(tournament, round.roundNumber, match.id, s1, s2)`, closes the sheet, re-renders, and emits `State.emit('tournament-changed', tournament)`.

Round generation and scoring logic live in `js/services/tournament.js`:

- `isMatchComplete(match)` is `match.team1Score + match.team2Score === 25`.
- `isRoundComplete(round)` requires every match to be complete.
- `setMatchScore()` is admin-gated in the service layer, validates the 25-point total, updates the match, recalculates stats, persists via `saveTournamentState()`, and cancels automatic sync so individual score edits are not pushed immediately.
- If editing a previous round (`roundNumber < tournament.currentRoundNumber`), `setMatchScore()` deletes later rounds, recalculates all player stats, and auto-generates the next round if the edited round is complete.
- `startNextRound(tournament)` requires admin access, current round existence, and round completion. It stamps `completedAt`, calls `recalculateAllPlayerStats()`, logs the completed round with `logRoundResult()`, ranks players with `rankPlayers()`, creates the next round with `createMexicanoMatches()`, saves state, cancels pending sync, and calls `flushPush()`.
- Round 1 generation uses `createRound1Matches(players)`: groups players by fours and pairs `[0]+[3]` vs `[1]+[2]`.
- Later rounds use `createMexicanoMatches(rankedPlayers)`: ranked groups of four, also `[0]+[3]` vs `[1]+[2]`.
- `rankPlayers(players)` sorts by total points descending, wins descending, points per game descending, then name ascending.

End tournament and confirmation popup:

- Admins on the latest incomplete round see "Next Round" when the round is complete, "End Tournament", and "Delete Tournament".
- "End Tournament" computes unscored matches across all rounds. If any exist, the progress confirm message warns that they will be removed.
- `showProgressConfirmDialog(title, message, steps, onConfirm)` renders a modal checklist. The steps come from `COMPLETION_STEPS` (`js/services/tournament.js`): `finalize`, `push`, `index`, `telegram`, and `notify`.
- On confirm, unscored matches are removed, empty rounds are removed, then `runTournamentCompletion(tournament, (id, status, detail) => api.setStep(id, status, detail))` runs. The page no longer orchestrates the alerts itself.
- `runTournamentCompletion()` calls `completeTournament()`, then the Telegram alert, then the Web Push relay (`sendTournamentCompletedPush(tournament, Store.getMatches())`). It never rejects: each failure is reported on its own step, any step left `pending`/`running` when the sync fails is flipped to `error`, and failures are logged through `round-log.js`.
- `completeTournament()` marks the tournament completed, logs the final round, resolves the pre-tournament ELO baseline with `resolveEloBaseline()` (no full-history pull), writes completed match entities to `Store.getMatches()`, updates the tournaments index, writes local dev files, snapshots post-tournament ELO to `mexicano_elo_baseline`, then calls `pushCompletedTournament(date, dayMatches, indexEntry)`.
- `pushCompletedTournament()` writes only the day file and `tournaments.json`, bypassing the debounced `pushAll()` queue (it cancels any pending sync first), using the `FAST_TIMEOUTS` ladder `2s → 3s` (5s total per request) from `js/services/http.js`. Telegram and Web Push dispatches use the same timed fetch.
- On sync failure the local copy is preserved (`mexicano_completion_marker`, date re-marked dirty) and `retryCompletedTournamentPush()` retries on reconnect.
- The simpler `showConfirmDialog()` is used for delete confirmation. Delete calls `deleteTournament(date)`, then navigates to `#/tournaments`.

Attendance confirmation:

- The Matches tab shows `#confirm-attendance-btn` when the tournament is not completed, the current user (`Store.getCurrentUser()`) is a player, and that player is not already confirmed.
- Clicking calls `confirmAttendance(user)`, stores `Store.set('confirmed_tournament_' + tournament.tournamentDate, true)`, sends `sendTournamentConfirmationAlert(user, tournament.tournamentDate)`, shows a toast, refreshes `tournament` from `getActiveTournament()`, and re-renders.
- `confirmAttendance(playerName)` is intentionally not admin-gated; any player can self-confirm.

Admin gating:

- UI mutation controls are hidden or inert unless `Store.isAdministrator()` is true.
- Service-layer mutation functions also guard admin writes: `setMatchScore()`, `startNextRound()`, `completeTournament()`, `deleteTournament()`, and `updateAccessCode()`.
- Non-admin users can view active/in-progress and completed tournaments read-only.

## Key Files & Symbols

- `js/pages/tournament.js` — exports `renderTournament(container, params)`; local helpers include `formatDate()`, `getStatusBadge()`, `renderMatchesTab()`, `renderLeaderboardTab()`, `openScoreSheet()`, `showConfirmDialog()`, `showProgressConfirmDialog()`, and `esc()`.
- `js/app.js` — route table maps `'/tournament/:date'` to `renderTournament`.
- `js/services/tournament.js` — lifecycle and persistence symbols: `getActiveTournament()`, `setMatchScore()`, `startNextRound()`, `completeTournament()`, `runTournamentCompletion()`, `COMPLETION_STEPS`, `resolveEloBaseline()`, `ELO_BASELINE_KEY`, `loadTournamentByDate()`, `saveTournamentState()`, `isMatchComplete()`, `isRoundComplete()`, `isTournamentEditable()`, `recalculateAllPlayerStats()`, `updateAccessCode()`, `deleteTournament()`, `confirmAttendance()`, `createRound1Matches()`, and `createMexicanoMatches()`.
- `js/services/ranking.js` — `rankPlayers(players)` for player standings and next-round seeding.
- `js/services/github.js` — imported lazily for `fetchActiveTournamentJson()`, `ensureDayMatchesLoaded()`, `readDayMatches()`, `markMatchDateDirty()`, `flushPush()`, `pushCompletedTournament()`, `updateTournamentIndexEntry()`, `removeTournamentIndexEntry()`, and `deleteTournamentDayFile()`.
- `js/services/http.js` — `fetchWithTimeout()`, `fetchWithRetry()`, and the `FAST_TIMEOUTS` (`2s → 3s`, 5s total) ladder used by every request in the completion flow.
- `js/services/round-log.js` — `logRoundResult()` records completed rounds; `logError()` records sync/Telegram failures for the Logs tab.
- `js/services/telegram.js` — `sendTournamentConfirmationAlert()` and `sendTournamentCompletedAlert()`.
- `js/services/push.js` — `sendTournamentCompletedPush(tournament, allMatches)` for the `notify` step.
- `js/pages/statistics.js` — `renderDayStatsInto()` renders the rich leaderboard; `showPlayerProfile()` opens player details.
- `js/store.js` — `Store` localStorage/cache facade: `getActiveTournament()`, `setActiveTournament()`, `clearActiveTournament()`, `getMatches()`, `setMatches()`, `getTournamentsIndex()`, `setTournamentsIndex()`, `getCurrentUser()`, `isAdministrator()`, `getGitHubConfig()`, `set()`.
- `js/state.js` — `State.on('tournament-changed', ...)` subscription and `State.emit('tournament-changed', tournament)` updates.
- `js/components/match-card.js`, `js/components/score-input.js`, `js/components/leaderboard.js` — reusable components with similar UI patterns, but the current Tournament detail page renders match cards, score input, and fallback leaderboard inline instead of importing these components.

## Data

Store/localStorage keys:

- `mexicano_active_tournament` via `Store.getActiveTournament()` and `Store.setActiveTournament()`.
- `mexicano_matches` via `Store.getMatches()` and `Store.setMatches()`.
- `mexicano_completion_marker`, set during completion until the completed tournament is successfully pushed.
- `mexicano_elo_baseline`, `{ date, elo }` snapshot of post-tournament ELO written by each completion so the next one resolves its baseline with zero network reads.
- `mexicano_confirmed_tournament_<date>`, local attendance-confirmation flag.
- `mexicano_round_log`, maintained by the round-log service for admin-only logs.

`State` events:

- `State.on('tournament-changed', ...)` is registered by `renderTournament()` and causes `loadTournament()` plus `render()`.
- `State.emit('tournament-changed', tournament)` is emitted after score saves and by service persistence.
- `State.emit('tournament-changed', null)` is emitted after delete.

Tournament object shape:

```js
{
  id,
  tournamentDate: 'yyyy-MM-dd',
  accessCode: string | null,
  courts: Array<number|string>,
  players: [
    { id, name, totalPoints, gamesPlayed, wins, losses, confirmed?: true }
  ],
  rounds: [
    {
      roundNumber: 1 | 2 | 3,
      matches: [
        {
          id,
          roundNumber,
          player1, player2, player3, player4,
          team1Score,
          team2Score,
          completedAt
        }
      ],
      completedAt
    }
  ],
  currentRoundNumber,
  isStarted,
  isCompleted,
  startedAt,
  completedAt
}
```

Completed match entity shape in `mexicano_matches` and day files:

```js
{
  date: 'yyyy-MM-dd',
  roundNumber,
  team1Player1Name,
  team1Player2Name,
  team2Player1Name,
  team2Player2Name,
  scoreTeam1,
  scoreTeam2,
  team1Player1Elo,
  team1Player2Elo,
  team2Player1Elo,
  team2Player2Elo,
  _key: 'yyyy-MM-dd_R<round>M<match>'
}
```

GitHub data flow:

- `saveTournamentState(tournament)` stores active tournament state, rewrites completed match entities for that date, emits `tournament-changed`, and calls `markMatchDateDirty(tournament.tournamentDate)`.
- Individual score edits call `cancelPendingSync()` after saving, so partial score changes are not pushed one-by-one.
- `startNextRound()` saves and then calls `flushPush()` to push the completed round.
- `completeTournament()` writes all completed matches, updates the tournaments index, and calls `pushCompletedTournament(date, dayMatches, indexEntry)` — day file first, then `tournaments.json`, bypassing the debounced `pushAll()` queue. It never pulls the full match history.
- `deleteTournament(date)` removes local index/matches/active state and calls `removeTournamentIndexEntry(date)` plus `deleteTournamentDayFile(date)`.
- On-demand page load uses `ensureDayMatchesLoaded(date)` and `readDayMatches(date)` when local data is missing or stale.

## Sub-tabs / Sections

- Matches — Shows the selected round, court labels, two-player teams, completed scores, confirmed-attendance checkmarks, and admin-only scoring/action controls. It renders previous/next round controls when multiple rounds exist. Admin score entry opens the inline `openScoreSheet()` bottom sheet and persists through `setMatchScore()`. Latest-round admin actions include `startNextRound()`, `completeTournament()`, and `deleteTournament()`.
- Leaderboard — `renderLeaderboardTab(content)` first checks `Store.getMatches().filter(m => m.date === date)`. If day match history exists, it calls `renderDayStatsInto(content, dayMatches, date, isLatest, name => showPlayerProfile(name))` where `isLatest = date === getLatestCompleteTournamentDate()`. Passing `isLatest=true` for the latest tournament makes the leaderboard use the authoritative `players_summary` ELO (`attachEloFromSummary`), so its ELO matches Home and Statistics "latest"; older tournaments pass `isLatest=false` and use the historical snapshot recompute. If no match history exists, it falls back to `rankPlayers(tournament.players)` and renders an inline table with `#`, `Name`, `Pts`, `W`, `L`, `PPG`, and `Win%`, including confirmation checkmarks for confirmed players.

Switching works through `data-tab` buttons in `#tournament-tabs`. The click handler finds the closest `.tab`, assigns `currentTab = tab.dataset.tab`, and calls `render()`. The tab selection is not deep-linked; reloading the route resets to Matches unless the loaded tournament is completed, in which case `initLoad()` sets `currentTab = 'leaderboard'`.

## Related Feature Docs

- `.github/features/tournament-management.md` — Defines the core tournament lifecycle, score rules, round generation, admin access policy, access-code behavior, read/write access, delete rules, leaderboard expectations, and GitHub integration.
- `.github/features/tournament-confirmation-popup.md` — Defines player attendance confirmation, persisted `players[].confirmed`, the green checkmark on the Tournament page, the in-page confirm button, and Telegram confirmation alerts.
- `.github/features/tournament-round-logs.md` — Defines local admin-only round logging and error logging. The Tournament page triggers round logs through `startNextRound()` and `completeTournament()`, and records completion/Telegram errors through `logError()`.

## Update Protocol

Update this skill whenever js/pages/tournament.js render/scoring/round logic, sub-tabs, data shape, or routing changes, or when the linked feature MDs change.
