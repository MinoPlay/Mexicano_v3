---
name: tab-home
description: >
  Reference skill for the Home tab (route /) of the Mexicano PWA. Covers purpose,
  rules, key files, data flow, and sub-sections. Use when working on the home page.
---

# Home tab

## Purpose
The Home tab is the landing page for route `/`. It is available to all users and gives a quick overview of the current app state: an active tournament link when one exists, the latest completed tournament table, and the current calendar month table. If the current user is registered for an active tournament and has not confirmed attendance, the page can also show a confirmation popup.

## Rules / Logic
- Routing is registered in `js/app.js`: route `'/'` maps to `renderHome`.
- `renderHome(container, params)` is the exported page renderer. `params` is not used.
- The page reads the active tournament with `getActiveTournament()`, then suppresses it if `Store.getTournamentsIndex()` already marks the same `tournamentDate` as complete. This prevents stale `active_tournament` localStorage data from appearing as live.
- Latest tournament selection uses `getLatestCompleteTournamentDate()`. That function prefers complete entries from the tournaments index and falls back to locally cached match dates, excluding an in-progress active tournament date.
- Latest tournament stats are built from `Store.getMatches().filter(m => m.date === latestDate)` and `calculatePlayerStatistics(dayMatches)`.
- Latest tournament ELO is attached by `attachEloToStats(stats)`. It prefers `Store.getPlayersSummary()` (`elo` and `previousElo`) and falls back to `getEloSnapshots(Store.getMatches())` plus `getEloForDate(snapshots, latestDate)`.
- Current month is calculated from the browser date as `YYYY-MM`; previous month is derived with `getPrevYearMonth(yearMonth)`.
- Current-month stats are resolved by `resolveCurrentMonthStats()`. Primary source is `Store.getMonthlyOverview(currentYearMonth)`, converted by `overviewToStats(overview, prevOverview)`. Fallback source is local matches whose `date` starts with the current `YYYY-MM`.
- `overviewToStats()` maps monthly overview rows to table stats and computes month-over-month `eloChange` by comparing current and previous monthly overview ELO values by player name.
- Both tables have independent client-side sort state:
  - latest tournament: `sortCol`, `sortDir`, initially `average` / `desc`. The rendered column key is `avg`, so the first render keeps the `calculatePlayerStatistics()` order until the user clicks a sortable header;
  - current month: `sortCol2`, `sortDir2`, initially `avg` / `desc`.
- Sortable columns are `name`, `wl`, `pts`, `avg`, `win`, `elo`, and `change`. Clicking the active sort column toggles direction; clicking a new column sorts names ascending and other columns descending.
- Current-month sorting has an additional tie-breaker: wins descending, then name ascending.
- With a configured GitHub PAT (`Store.getGitHubConfig()?.pat`), the page lazy-loads missing latest-day matches through `ensureDayMatchesLoaded(latestDate)` and always refreshes current plus previous monthly overviews with `pullMonthlyOverview()`.
- The title `#home-title` is clickable. After confirmation, it removes `matches`, `matches_fully_loaded`, `active_tournament`, and `completion_marker`, then reloads the page.
- Tournament attendance confirmation is shown only when `shouldShowConfirmationPopup(activeTournament, currentUser, alreadyConfirmed)` returns true and no `#tournament-confirm-overlay` exists. Confirmation stores `confirmed_tournament_<date>`, calls `confirmAttendance(currentUser)`, removes the overlay, and best-effort sends a Telegram alert.
- `State`, `calculateAllEloRankings`, and `getMembers` are imported in `home.js` but are not used by the current implementation.

## Key Files & Symbols
- `js/pages/home.js` — exports `renderHome(container, params)` plus `shouldShowConfirmationPopup(activeTournament, currentUser, alreadyConfirmed)` and `buildConfirmationAlertMessage(playerName, tournamentDate)`. Notable internal helpers: `getCurrentYearMonth()`, `getPrevYearMonth()`, `formatMonth()`, `overviewToStats()`, `formatDate()`, `attachEloToStats()`, `resolveCurrentMonthStats()`, `renderTable()`, and `renderCurrentMonthTable()`.
- `js/app.js` — imports `renderHome` and registers `'/'` in the route table.
- `js/store.js` — provides localStorage-backed and cache-backed reads used by the page: matches, active tournament, current user, GitHub config, players summary, monthly overview, and tournaments index.
- `js/services/tournament.js` — provides `getActiveTournament()`, `getLatestCompleteTournamentDate()`, and `confirmAttendance(playerName)`.
- `js/services/statistics.js` — provides `calculatePlayerStatistics(matches)`, which ignores 0–0 matches, totals wins/losses/points, computes averages and win rate, sorts by points then wins, and assigns ranks.
- `js/services/elo.js` — provides `getEloSnapshots(matches)` and `getEloForDate(snapshots, latestDate)` as fallback ELO data for the latest tournament table.
- `js/services/github.js` — dynamically imported for `ensureDayMatchesLoaded(date)` and `pullMonthlyOverview(yearMonth)` when GitHub sync is configured.
- `js/services/telegram.js` — dynamically imported for `sendTournamentConfirmationAlert()` after attendance confirmation.

## Data
- Store/localStorage keys read directly or through helpers:
  - `matches` — array of match objects. Home uses `date`, player-name fields (`team1Player1Name`, `team1Player2Name`, `team2Player1Name`, `team2Player2Name`), and scores (`scoreTeam1`, `scoreTeam2`).
  - `active_tournament` — active tournament object. Home uses `tournamentDate`, `isCompleted`, and `players`.
  - `current_user` — current player name used for attendance confirmation.
  - `github_config` — must contain `pat` for lazy GitHub fetches.
  - `players_summary_cache` / cached `players_summary` — player rows with `name`, `elo`, and `previousElo`.
  - cached `monthly_YYYY-MM` — monthly overview rows from `players_overview.json`.
  - cached `tournaments_index` — entries with at least `date` and `isComplete`.
  - `confirmed_tournament_<YYYY-MM-DD>` — local flag that suppresses the confirmation popup after the user confirms.
- Monthly overview source file shape starts as `YYYY/YYYY-MM/players_overview.json` from GitHub. `pullMonthlyOverview()` maps raw PascalCase fields to camelCase rows: `{ name, totalPoints, wins, losses, average, elo }`.
- `overviewToStats()` converts monthly rows to table rows: `{ name, wins, losses, points, average, winRate, elo, eloChange }`.
- `calculatePlayerStatistics()` returns table-compatible rows from raw matches, including `{ rank, name, wins, losses, points, wl, average, winRate, ... }`.
- `ensureDayMatchesLoaded(date)` reads cached `mexicano_matches` first, fetches the day from GitHub if missing, appends fetched matches to localStorage, and returns the day matches.

## Sub-tabs / Sections
Home has no sub-tabs, but it has distinct sections:

- **Page header** — shows the clickable `🎾 Mexicano` title and an empty `#home-header-right` container. Clicking the title is a manual cache reset flow.
- **Active Tournament card** — renders only when there is a non-completed active tournament that is not marked complete in the tournaments index. It links to `#/tournament/<tournamentDate>` and shows formatted date plus player count.
- **Latest Tournament table** — shows stats for the latest completed tournament. If local data is missing and GitHub is configured, it temporarily displays `⏳ Loading…`, fetches the date's matches, then replaces the no-data element with the rendered table. If no data exists, it shows `No tournament data available`.
- **Current Month table** — shows current calendar month aggregate stats. It uses cached monthly overview data first, local match calculation second, then refreshes current and previous monthly overviews from GitHub when possible. It shows `No data for this month` when no rows are available.
- **Attendance confirmation popup** — modal overlay for a registered current user in an active tournament who has not already confirmed. The confirm button persists confirmation and triggers tournament save/push behavior through `confirmAttendance()`.

## Related Feature Docs
- `.github/features/home-current-month.md` — documents the Home page current-month table, its data sources, columns, sort behavior, and GitHub lazy fetch.
- `.github/features/player-ranking.md` — documents tournament/player ranking rules that are related to how match-derived player stats and ranks are produced elsewhere in the app.

## Update Protocol
Update this skill whenever js/pages/home.js render logic, data shape, sorting, sections, or routing changes, or when the linked feature MDs change. Keep it in sync with the page file and linked feature docs.
