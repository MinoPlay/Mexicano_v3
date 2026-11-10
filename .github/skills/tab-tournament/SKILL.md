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
- `isLoading` for on-demand Supabase loads.

Loading rules:

- If `getActiveTournament()` matches the route date, use it first.
- With Supabase configured, startup and navigation call `pullForRoute('#/tournament/:date')`. This
  route loads `tournament_index`, the active tournament, matches for only the requested date and
  the player summary (`player_totals_summary` + `player_current_elo`, precomputed; fallback `player_totals` + `get_current_elo`); no doodle or attendance data. Summary entries carry `eloDate` (tournament date of the player's latest ELO row) next to `elo` / `previousElo`.
- The completed route hydration is cached for the page session. The page's background
  `fetchActiveTournamentJson()` / `ensureDayMatchesLoaded(date)` calls reuse it instead of
  starting a second PostgREST batch.
- If Supabase has no in-progress tournament for the active local date, clear stale active state,
  call `readDayMatches(date)`, merge fetched matches into `mexicano_matches`, then rebuild with
  `loadTournamentByDate(date)`.
- If no active tournament exists, load completed local data via `loadTournamentByDate(date)`.
- If local data is missing and Supabase is configured, call `ensureDayMatchesLoaded(date)`, then
  retry `loadTournamentByDate(date)`.
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
- ELO change indicators: at the top of `renderMatchesTab()` the page calls `calculateTournamentMatchEloChanges(tournament, Store.getPlayersSummary())` (`js/services/elo.js`) once per render. For every **completed** match the local `nameWithElo()` helper adds `<span class="elo-change positive|negative|neutral">▲16.0</span>` (`▼15.3`, `–` for 0.0) inside the `.match-team-name` span, on the inner side of the name (left team `✅ Alice ▲16.0`, right team `▼15.3 Bob ✅`). Shown to admins and non-admins, for active and completed tournaments; nothing for unscored matches. Because they are recomputed on every `render()`, scoring or editing a result (including a past round) updates them. Baseline comes from the players summary via `resolvePreTournamentElo()` (`eloDate` rule, see `elo-rating-system.md`); if any player of a completed match has no known baseline (summary missing the player, or a later tournament already rewrote `eloDate`) no indicators are rendered for the tournament.
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
- `setMatchScore()` is admin-gated in the service layer, validates the 25-point total, updates the match, recalculates stats, refreshes the in-memory state via `saveTournamentState()`, and writes each score edit through to Supabase via `persistTournamentState()`.
- If editing a previous round (`roundNumber < tournament.currentRoundNumber`), `setMatchScore()` deletes later rounds, recalculates all player stats, and auto-generates the next round if the edited round is complete.
- `startNextRound(tournament)` requires admin access, current round existence, and round completion. It stamps `completedAt`, calls `recalculateAllPlayerStats()`, logs the completed round with `logRoundResult()`, ranks players with `rankPlayers()`, creates the next round with `createMexicanoMatches()`, saves state, and writes the generated round to Supabase via `persistTournamentState()`.
- Round 1 generation uses `createRound1Matches(players)`: groups players by fours and pairs `[0]+[3]` vs `[1]+[2]`.
- Later rounds use `createMexicanoMatches(rankedPlayers)`: ranked groups of four, also `[0]+[3]` vs `[1]+[2]`.
- `rankPlayers(players)` sorts by total points descending, wins descending, points per game descending, then name ascending.

End tournament and confirmation popup:

- Admins on the latest incomplete round see "Next Round" when the round is complete, "End Tournament", and "Delete Tournament".
- "End Tournament" computes unscored matches across all rounds. If any exist, the progress confirm message warns that they will be removed.
- `showProgressConfirmDialog(title, message, steps, onConfirm)` renders a modal checklist. The steps come from `COMPLETION_STEPS` (`js/services/tournament.js`): `finalize` (results and local ELO), `save` (saving the tournament to Supabase), `telegram`, and `notify`. There are no separate `push` or `index` steps.
- On confirm, unscored matches are removed, empty rounds are removed, then `runTournamentCompletion(tournament, (id, status, detail) => api.setStep(id, status, detail))` runs. The page no longer orchestrates the alerts itself.
- `runTournamentCompletion()` calls `completeTournament()`, then the Telegram alert, then the Web Push relay (`sendTournamentCompletedPush(tournament, Store.getMatches() || [])`), reusing the computed match cache. It never rejects: each failure is reported on its own step, any step left `pending`/`running` when the save fails is flipped to `error`, and failures are logged through `round-log.js`. A save failure does not skip either notification, and a Telegram failure does not skip Web Push. Both notifications are queued through Supabase `notification_outbox`.
- `completeTournament()` marks the tournament completed, logs the final round, resolves the pre-tournament ELO baseline with `resolveEloBaseline()` (no full-history pull), writes completed match entities to `Store.getMatches()`, updates the in-memory tournaments index, and snapshots post-tournament ELO to the in-memory `elo_baseline` cache key. It best-effort mirrors day matches and the index only in localhost dev-data mode, then calls `pushCompletedTournament(date, dayMatches, indexEntry)`.
- `pushCompletedTournament()` reports the single `save` step and uses the per-date write queue to submit one `save_tournament` mutation through the Supabase `domain-mutation` Edge Function. It persists `tournaments`, `tournament_players`, `matches`, and `match_players`; there are no separate GitHub day-file or index uploads. Database triggers rebuild the authoritative ELO and summary tables; the client-computed ELO only updates the immediate in-memory display.
- `resolveEloBaseline()` uses the same-session `elo_baseline` snapshot, cached player summary, previous tournament's embedded post-match ELO, or locally cached match replay. Loading the previous tournament's matches uses `readDayMatches()` and needs at most one extra date-scoped read; the completion flow does not pass a `FAST_TIMEOUTS` option.
- On save failure the in-memory copy is kept so the user can retry from the open page; calling `completeTournament()` again on an already-completed tournament re-saves it via `persistTournamentState()`. A successful save clears the active tournament from `Store`. Nothing is buffered on the device across a refresh.
- The simpler `showConfirmDialog()` is used for delete confirmation. Delete calls `deleteTournament(date)`, then navigates to `#/tournaments`.

Attendance confirmation:

- The Matches tab shows `#confirm-attendance-btn` when the tournament is not completed, the current user (`Store.getCurrentUser()`) is a player, and that player is not already confirmed.
- Clicking calls `confirmAttendanceAndPush(user)`, sends `sendTournamentConfirmationAlert(user, tournament.tournamentDate)`, shows a toast, refreshes `tournament` from `getActiveTournament()`, and re-renders. The confirmation is durable because the `confirm_attendance` mutation writes it to Supabase.
- `confirmAttendance(playerName)` is intentionally not admin-gated; any player can self-confirm.

Admin gating:

- UI mutation controls are hidden or inert unless `Store.isAdministrator()` is true.
- Service-layer mutation functions also guard admin writes: `setMatchScore()`, `startNextRound()`, `completeTournament()`, `deleteTournament()`, and `updateAccessCode()`.
- Non-admin users can view active/in-progress and completed tournaments read-only.

## Key Files & Symbols

- `js/pages/tournament.js` — exports `renderTournament(container, params)`; local helpers include `formatDate()`, `getStatusBadge()`, `renderMatchesTab()`, `renderLeaderboardTab()`, `openScoreSheet()`, `showConfirmDialog()`, `showProgressConfirmDialog()`, `esc()`, `nameWithCheck()`, `nameWithElo()` and `formatEloChange()`.
- `js/services/elo.js` — `calculateTournamentMatchEloChanges(tournament, summary)` and `resolvePreTournamentElo(summary, date, names)` feed the per-match ELO indicators; `processMatchElo()` is the shared algorithm.
- `js/app.js` — route table maps `'/tournament/:date'` to `renderTournament`.
- `js/services/tournament.js` — lifecycle and persistence symbols: `getActiveTournament()`, `setMatchScore()`, `startNextRound()`, `completeTournament()`, `runTournamentCompletion()`, `COMPLETION_STEPS`, `resolveEloBaseline()`, `ELO_BASELINE_KEY`, `loadTournamentByDate()`, `saveTournamentState()`, `persistTournamentState()`, `isTournamentEditable()`, `updateAccessCode()`, `deleteTournament()`, `confirmAttendance()`, `createRound1Matches()`, and `createMexicanoMatches()`. Pure shape helpers `isMatchComplete()`, `isRoundComplete()` and `recalculateAllPlayerStats()` live in `js/services/tournament-shape.js` and are re-exported here.
- `js/services/ranking.js` — `rankPlayers(players)` for player standings and next-round seeding.
- `js/services/backend.js` — Supabase adapter for `fetchActiveTournamentJson()`, `ensureDayMatchesLoaded()`, `readDayMatches()`, `pushTournamentDayFile()`, `pushCompletedTournament()`, `updateTournamentIndexEntry()`, `removeTournamentIndexEntry()`, and `deleteTournamentDayFile()`. Legacy file-oriented names do not imply GitHub writes.
- `js/services/supabase.js` — date-scoped hydration, read-cache invalidation, and Edge Function invocation (`invokeFunction()`).
- `js/services/round-log.js` — `logRoundResult()` records completed rounds; `logError()` records sync/Telegram failures for the Logs tab.
- `js/services/telegram.js` — `sendTournamentConfirmationAlert()` and `sendTournamentCompletedAlert()`.
- `js/services/push.js` — `sendTournamentCompletedPush(tournament, allMatches)` for the `notify` step.
- `js/pages/statistics.js` — `renderDayStatsInto()` renders the rich leaderboard; `showPlayerProfile()` opens player details.
- `js/store.js` — `Store` in-memory application-data and preferences facade: `getActiveTournament()`, `setActiveTournament()`, `clearActiveTournament()`, `getMatches()`, `setMatches()`, `getTournamentsIndex()`, `setTournamentsIndex()`, `getCurrentUser()`, `isAdministrator()`, `getSupabaseConfig()`, `set()`.
- `js/state.js` — `State.on('tournament-changed', ...)` subscription and `State.emit('tournament-changed', tournament)` updates.
- `js/components/match-card.js`, `js/components/score-input.js`, `js/components/leaderboard.js` — reusable components with similar UI patterns, but the current Tournament detail page renders match cards, score input, and fallback leaderboard inline instead of importing these components.

## Data

Store/in-memory cache keys:

- `active_tournament` (in-memory `Cache`) via `Store.getActiveTournament()` and `Store.setActiveTournament()`. Hydrated from Supabase by `hydrateActiveTournament()` on every pull; never persisted to localStorage.
- `matches` (in-memory `Cache`) via `Store.getMatches()` and `Store.setMatches()`.
- `elo_baseline` (in-memory `Cache`), `{ date, elo, previousElo }` snapshot of post-tournament ELO written by each completion so a follow-up completion in the same session resolves its baseline with zero network reads.
- Attendance confirmation is read from the Supabase-hydrated `player.confirmed` flag; there is no local confirmation flag.
- `mexicano_round_log` (localStorage), maintained by the round-log service for admin-only logs.

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

Completed match entity shape in the in-memory `matches` cache and optional local dev day files:

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

During the legacy Supabase import, completed files contribute top-level `matches[]`. A genuine
active file contributes nested `tournament.rounds[].matches[]`; stale unfinished snapshots older
than the latest completed index date are ignored.

Supabase and local cache data flow:

- `saveTournamentState(tournament)` updates the in-memory active tournament, rewrites completed match entities for that date, and emits `tournament-changed`; it does not itself write remotely.
- `persistTournamentState(tournament)` refreshes that local state and calls `pushTournamentDayFile(tournament)`, which queues a `save_tournament` mutation. The payload includes every generated round, with unplayed matches stored as 0-0 so pairings survive a reload.
- Individual score edits and `startNextRound()` call `persistTournamentState()` immediately. `cancelPendingSync()`, `markMatchDateDirty()`, and `flushPush()` are compatibility no-ops, not a deferred GitHub write mechanism.
- `completeTournament()` refreshes completed matches and the index locally, then calls `pushCompletedTournament(date, dayMatches, indexEntry)` for the single Supabase save. It never pulls the full match history.
- `deleteTournament(date)` refuses completed tournaments, removes local index/matches/active state, and calls `removeTournamentIndexEntry(date)` plus `deleteTournamentDayFile(date)`; both backend wrappers invoke the Supabase `delete_tournament` mutation.
- On-demand page load uses `ensureDayMatchesLoaded(date)` and `readDayMatches(date)` when local
  data is missing or stale. Both use the date-scoped Supabase hydration and share its in-flight
  or completed request state.

## Sub-tabs / Sections

- Matches — Shows the selected round, court labels, two-player teams, completed scores, confirmed-attendance checkmarks, and admin-only scoring/action controls. It renders previous/next round controls when multiple rounds exist. Admin score entry opens the inline `openScoreSheet()` bottom sheet and persists through `setMatchScore()`. Latest-round admin actions include `startNextRound()`, `completeTournament()`, and `deleteTournament()`.
- Leaderboard — `renderLeaderboardTab(content)` first checks `Store.getMatches().filter(m => m.date === date)`. If day match history exists, it calls `renderDayStatsInto(content, dayMatches, date, isLatest, name => showPlayerProfile(name))` where `isLatest = date === getLatestCompleteTournamentDate()`. Passing `isLatest=true` for the latest tournament makes the leaderboard use the authoritative `players_summary` ELO (`attachEloFromSummary`), so its ELO matches Home and Statistics "latest"; older tournaments pass `isLatest=false` and use the historical snapshot recompute. If no match history exists, it falls back to `rankPlayers(tournament.players)` and renders an inline table with `#`, `Name`, `Pts`, `W`, `L`, `PPG`, and `Win%`, including confirmation checkmarks for confirmed players.

Switching works through `data-tab` buttons in `#tournament-tabs`. The click handler finds the closest `.tab`, assigns `currentTab = tab.dataset.tab`, and calls `render()`. The tab selection is not deep-linked; reloading the route resets to Matches unless the loaded tournament is completed, in which case `initLoad()` sets `currentTab = 'leaderboard'`.

## Related Feature Docs

- `.github/features/tournament-management.md` — Defines the core tournament lifecycle, score rules, round generation, admin access policy, access-code behavior, read/write access, delete rules, leaderboard expectations, and Supabase integration.
- `.github/features/tournament-confirmation-popup.md` — Defines player attendance confirmation, persisted `players[].confirmed`, the green checkmark on the Tournament page, the in-page confirm button, and Telegram confirmation alerts.
- `.github/features/tournament-round-logs.md` — Defines local admin-only round logging and error logging. The Tournament page triggers round logs through `startNextRound()` and `completeTournament()`, and records completion/Telegram errors through `logError()`.

## Update Protocol

Update this skill whenever js/pages/tournament.js render/scoring/round logic, sub-tabs, data shape, or routing changes, or when the linked feature MDs change.
