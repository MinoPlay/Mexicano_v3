---
name: tab-tournament
description: >
  Reference skill for the Tournament detail tab (route /tournament/:date) of the Mexicano PWA,
  including the side-by-side Matches and Leaderboard panels. Covers purpose, rules, key files,
  data flow. Use when working on the tournament detail page.
---

# Tournament (detail) tab

## Purpose
The Tournament detail tab renders one tournament at `#/tournament/:date`, where `:date` is a `yyyy-MM-dd` tournament date. The route is mapped in `js/app.js` to `renderTournament(container, params)` from `js/pages/tournament.js`.

The desktop page is a live tournament workspace and historical viewer with Matches and Leaderboard visible side by side in `.tournament-desktop`. It no longer uses route-level or in-page Matches/Leaderboard tabs.

## Rules / Logic
`renderTournament(container, params)` owns page-local state: `date`, `tournament`, `matchesOrder` (`'desc'` = last round first; `'asc'` = first round first, the default; not persisted), `isLoading`, and the `State.on('tournament-changed')` subscription.

Loading rules:

- If `getActiveTournament()` matches the route date, use it first.
- With Supabase configured, startup and navigation call `pullForRoute('#/tournament/:date')`. This
  route loads `tournament_index`, the active tournament, matches for only the requested date and
  the player summary (`player_totals_summary` + `player_current_elo`, precomputed; fallback `player_totals` + `get_current_elo`); no doodle or attendance data.
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

Header rules:

- Previous/next buttons navigate across `Store.getTournamentsIndex()` sorted newest-first.
- Header subtitle is `N rounds` (`1 round`, `No rounds`).
- `getStatusBadge(tournament)` renders Completed, In Progress, or Not Started.
- Access code appears in the toolbar. Admins see the inline access-code editor and saving calls `updateAccessCode(date, codeToSave)`.

Matches panel rules:

- `renderMatchesPanel()` renders the player filter (`renderPlayerFilter(names)` into `#matches-player-filter`), the order control (`renderOrderToggle()` into `#matches-order`, both in the panel header) and then `renderMatchesTab(content)`. Changing the order re-renders the panel; changing the filter re-renders only the match list. Neither reloads the Leaderboard.
- Every round is shown at once as a `.round-section` (all inside one `.round-list`, admin actions included): `.round-label` (`.round-title` = `Round N`, on the left, vertically centered against the round's courts; there is no header row above the cards) + `.round-matches` (the court cards). No round navigation or per-round view. Order control: `Last round first` (`data-order="desc"`) / `First round first` (`data-order="asc"`, default), `aria-pressed` on the active one, rendered only with 2+ rounds. Only round sections flip; courts inside a round keep Court 1→N.
- Player filter: page-local `playerFilter` (`''` = all). `#matches-player-filter` lists `All players` + every player with a match that day (`getPlayerNames()`, alphabetical), shown with 1+ rounds. A picked player keeps only the cards where they play in any seat; rounds they sit out are hidden. Cards keep their original `data-round-idx` / `data-match-idx` and court label. The pick survives re-renders (`tournament-changed`) and resets to `All players` if the name is no longer in the list. Not persisted across visits.
- Matches render as one-line `.match-card` entries (with `data-round-idx` / `data-match-idx`) inside `.round-matches`: `.match-court` | `.match-team-left` (2 names) | `.match-score` (`18 vs 7`, `vs` when unscored, `.match-hint` "Tap to score" for admins on unscored cards) | `.match-team-right`. `js/components/match-card.js` is not imported here. `css/desktop.css` makes `.round-list` one grid sized from the panel (`max-content` label | court | `minmax(0, auto)` team 1 | `max-content` score | `minmax(0, auto)` team 2); `.round-section`, `.round-matches` and each card use `subgrid`, so all rows fill the panel and line up. No fixed widths, no JS measuring; names ellipsize only when the panel is narrower than the longest teams.
- Court labels use `tournament.courts?.[idx] ?? idx + 1`.
- Confirmation checkmarks are computed from `tournament.players[].confirmed`.
- Admins can click any match card of an in-progress tournament to open `openScoreSheet(roundIdx, matchIdx)` for that exact round/match. Non-admins and completed tournaments are read-only. One `⚠ Editing a previous round will regenerate subsequent rounds` card shows on top, only for admins on in-progress tournaments with 2+ rounds.
- Score validation requires non-negative numbers totaling 25. Saving calls `setMatchScore(tournament, round.roundNumber, match.id, s1, s2)`, closes the sheet, re-renders, and emits `State.emit('tournament-changed', tournament)`.
- Admin actions (`.round-actions`: Next Round when the latest round is fully scored, End Tournament, Delete Tournament) render right after the **latest** round section in either order, and stay in that slot (computed from all rounds) even when the player filter hides the latest round. Ending uses `showProgressConfirmDialog()` with `COMPLETION_STEPS` and `runTournamentCompletion()`.
- Any current user who is a player and not confirmed sees `#confirm-attendance-btn`; clicking calls `confirmAttendanceAndPush(user)` and best-effort sends `sendTournamentConfirmationAlert()`.

Leaderboard panel rules:

- `renderLeaderboardTab(content)` renders the right panel every time the page renders.
- If day match history exists in `Store.getMatches()`, it calls `renderDayStatsInto(content, dayMatches, date, isLatest, name => { window.location.hash = '/players?p=...' })`.
- If no match history is loaded, it falls back to `rankPlayers(tournament.players)` and renders inline standings from active/in-progress player stats.
- Leaderboard player names navigate to the Players hub rather than opening the old Statistics profile dialog.

## Key Files & Symbols
- `js/pages/tournament.js` — exports `renderTournament`; local helpers include `fitNamesToMaxWidth`, `formatDate`, `getStatusBadge`, `renderMatchesPanel`, `getPlayerNames`, `renderPlayerFilter`, `renderOrderToggle`, `renderMatchesTab`, `renderLeaderboardTab`, `openScoreSheet`, `showConfirmDialog`, `showProgressConfirmDialog`, and `esc`.
- `js/pages/statistics.js` — `renderDayStatsInto` renders the rich completed-day leaderboard.
- `js/services/tournament.js` — `getActiveTournament`, `setMatchScore`, `startNextRound`, `runTournamentCompletion`, `COMPLETION_STEPS`, `loadTournamentByDate`, `getLatestCompleteTournamentDate`, `updateAccessCode`, `deleteTournament`, `confirmAttendanceAndPush`, `isMatchComplete`, and `isRoundComplete`.
- `js/services/ranking.js` — `rankPlayers` for fallback active-tournament standings.
- `js/services/backend.js` — lazy active/day hydration (`fetchActiveTournamentJson`, `ensureDayMatchesLoaded`, `readDayMatches`).
- `js/services/telegram.js` — `sendTournamentConfirmationAlert`.
- `js/store.js` — active tournament, matches, tournaments index, current user, admin state, and Supabase config.
- `js/state.js` — `State.on` and `State.emit` for tournament changes.
- `js/app.js` — registers `/tournament/:date`.
- `css/desktop.css` — `tournament-desktop`, `tournament-side`, `panel`, and desktop match layout classes (`round-list`, `round-section`, `round-label`, `round-matches`, `round-actions`).

## Data
The page reads active tournament objects with `tournamentDate`, `accessCode`, `courts`, `players`, `rounds`, `currentRoundNumber`, `isStarted`, and `isCompleted`.

Completed match rows use flattened fields:

```js
{
  date,
  roundNumber,
  team1Player1Name,
  team1Player2Name,
  team2Player1Name,
  team2Player2Name,
  scoreTeam1,
  scoreTeam2
}
```

Store/cache sources include active tournament, completed matches, tournaments index, current user, admin state, and Supabase route hydration. The route load for `#/tournament/:date` remains date-scoped unless the page explicitly needs the requested day.

## Sub-tabs / Sections
There are no sub-tabs. The page sections are:

- Header — prev/next navigation, date, round count (`N rounds`), and status badge.
- Toolbar — access code display/editor.
- Matches panel — player filter + round-order control (panel header), all rounds with one-line match cards, score sheet, confirmation button, and admin actions.
- Leaderboard side panel — completed-day rich stats or active-player fallback.
- Dialogs/sheets — score bottom sheet, delete/overwrite confirmation, and completion progress dialog.

## Related Feature Docs
- `.github/features/tournament-management.md` — tournament lifecycle, scoring, admin/write policy, access code, and GitHub/Supabase integration.
- `.github/features/tournament-confirmation-popup.md` — player attendance confirmation and alerts.
- `.github/features/tournament-round-logs.md` — completion/error logging contract.
- `.github/features/desktop-ui.md` — side-by-side Tournament detail layout.
- `.github/features/tournament-matches-panel.md` — all-rounds Matches panel, round label on the left, one-line court rows on one shared subgrid, player filter, round-order control.

## Update Protocol
Update this skill whenever `js/pages/tournament.js` render/scoring/round logic, side-by-side layout, leaderboard navigation, data shape, or routing changes, or when the linked feature MDs change.
