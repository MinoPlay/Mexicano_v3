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
- With Supabase configured, `pullForRoute('#/')` (`loadHomeRoute`) fetches players ∥
  `tournament_index` ∥ active tournament ∥ `player_monthly_summary` (previous + current month,
  precomputed by DB triggers), then the latest completed tournament's matches ∥ its
  `player_tournament_elo` rows. No ELO replay (`get_player_elo`) and no month match downloads.
  If the summary tables are missing, it falls back to month + latest-day matches ∥
  `get_player_elo`. Never the full match history. See `.github/features/route-data-loading.md`.
- Home-specific matches (latest day only) and player summary are stored in `Cache` as `home_matches` and
  `home_players_summary`; the loaded days are merged into `Store.getMatches()`.
- Missing latest-day matches can still be loaded through `ensureDayMatchesLoaded(latestDate)`.
  Months with no summary rows (e.g. a month without tournaments yet) are retried through `pullMonthlyOverview()`.
- The title `#home-title` renders `🎾 Mexicano v<APP_VERSION>` and is clickable. After confirmation, it clears the in-memory `matches`, `matches_fully_loaded` and `active_tournament` cache entries, then reloads the page (which re-pulls everything from Supabase).
- The title also contains `#app-refresh-btn` (refresh icon `↻`). Its click stops propagation (so the clear-cache handler does not fire) and calls `refreshApp()` from `js/version.js`, which clears all caches and reloads.
- Tournament attendance confirmation is shown only when `shouldShowConfirmationPopup(activeTournament, currentUser)` returns true and no `#tournament-confirm-overlay` exists. Confirmation calls `confirmAttendanceAndPush(currentUser)` (which persists to Supabase), removes the overlay, and best-effort sends a Telegram alert.
- `State`, `calculateAllEloRankings`, and `getMembers` are imported in `home.js` but are not used by the current implementation.

## Key Files & Symbols
- `js/pages/home.js` — exports `renderHome(container, params)` plus `shouldShowConfirmationPopup(activeTournament, currentUser, alreadyConfirmed)` and `buildConfirmationAlertMessage(playerName, tournamentDate)`. Notable internal helpers: `getCurrentYearMonth()`, `getPrevYearMonth()`, `formatMonth()`, `overviewToStats()`, `formatDate()`, `attachEloToStats()`, `resolveCurrentMonthStats()`, `renderTable()`, and `renderCurrentMonthTable()`.
- `js/app.js` — imports `renderHome` and registers `'/'` in the route table.
- `js/cache.js` — holds the partial `home_matches` and `home_players_summary` projections.
- `js/store.js` — provides localStorage-backed and cache-backed reads used by the page: fallback
  matches, active tournament, current user, Supabase config, monthly overview, and tournaments
  index.
- `js/services/tournament.js` — provides `getActiveTournament()`, `getLatestCompleteTournamentDate()`, and `confirmAttendance(playerName)`.
- `js/services/statistics.js` — provides `calculatePlayerStatistics(matches)`, which ignores 0–0 matches, totals wins/losses/points, computes averages and win rate, sorts by points then wins, and assigns ranks.
- `js/services/elo.js` — provides `getEloSnapshots(matches)` and `getEloForDate(snapshots, latestDate)` as fallback ELO data for the latest tournament table.
- `js/services/backend.js` and `js/services/supabase.js` — route-scoped Home hydration,
  `ensureDayMatchesLoaded(date)`, and `pullMonthlyOverview(yearMonth)`.
- `js/services/telegram.js` — dynamically imported for `sendTournamentConfirmationAlert()` after attendance confirmation.

## Data
- Store/localStorage keys read directly or through helpers:
  - `matches` — array of match objects. Home uses `date`, player-name fields (`team1Player1Name`, `team1Player2Name`, `team2Player1Name`, `team2Player2Name`), and scores (`scoreTeam1`, `scoreTeam2`).
  - `active_tournament` — active tournament object. Home uses `tournamentDate`, `isCompleted`, and `players`.
  - `current_user` — current player name used for attendance confirmation.
  - `supabase_config` — enables route-scoped Supabase hydration.
  - cached `home_players_summary` — Home-only player rows with `name`, `elo`, and `previousElo`.
  - cached `monthly_YYYY-MM` — monthly overview rows (`name, wins, losses, totalPoints, average, elo`), read from `player_monthly_summary` on Home (or derived from matches + ELO elsewhere).
  - cached `tournaments_index` — entries with at least `date` and `isComplete`.
  - `confirmed` flag on each `active_tournament` player — hydrated from Supabase and used to suppress the confirmation popup.
- Monthly overview rows are derived from date-scoped canonical matches and runtime ELO:
  `{ name, totalPoints, wins, losses, average, elo }`.
- `overviewToStats()` converts monthly rows to table rows: `{ name, wins, losses, points, average, winRate, elo, eloChange }`.
- `calculatePlayerStatistics()` returns table-compatible rows from raw matches, including `{ rank, name, wins, losses, points, wl, average, winRate, ... }`.
- `ensureDayMatchesLoaded(date)` reuses or fetches the date-scoped Supabase tournament hydration
  and returns only that day's matches.

## Sub-tabs / Sections
Home has no sub-tabs, but it has distinct sections:

- **Page header** — shows the clickable `🎾 Mexicano v<APP_VERSION>` title with the `#app-refresh-btn` refresh icon, plus the `#home-header-right` container holding the notification bell (`renderNotificationBell()`, mounted async into that slot after render — see `push-notifications` skill). Clicking the title is a manual cache reset flow; clicking the icon refreshes to the latest version.
- **Active Tournament card** — renders only when there is a non-completed active tournament that is not marked complete in the tournaments index. It links to `#/tournament/<tournamentDate>` and shows formatted date plus player count.
- **Latest Tournament table** — shows stats for the latest completed tournament. If route data is
  missing and Supabase is configured, it temporarily displays `⏳ Loading…`, fetches the date's
  matches, then replaces the no-data element with the rendered table. If no data exists, it
  shows `No tournament data available`.
- **Current Month table** — shows current calendar month aggregate stats. It uses the route-scoped
  monthly overview first and cached match calculation second. It shows `No data for this month`
  when no rows are available.
- **Attendance confirmation popup** — modal overlay for a registered current user in an active tournament who has not already confirmed. The confirm button persists confirmation and triggers tournament save/push behavior through `confirmAttendance()`.

## Related Feature Docs
- `.github/features/home-current-month.md` — documents the Home page current-month table, its
  data sources, columns, sorting, and route-scoped Supabase hydration.
- `.github/features/player-ranking.md` — documents tournament/player ranking rules that are related to how match-derived player stats and ranks are produced elsewhere in the app.

## Update Protocol
Update this skill whenever js/pages/home.js render logic, data shape, sorting, sections, or routing changes, or when the linked feature MDs change. Keep it in sync with the page file and linked feature docs.
