---
name: tab-home
description: >
  Reference skill for the Home dashboard (route /) of the Mexicano PWA. Covers purpose,
  rules, key files, data flow, and dashboard sections. Use when working on the home page.
---

# Home tab

## Purpose
The Home tab is the desktop dashboard for route `/`. It is available to all users and summarizes the current state in a `dash-grid`: KPI row, active tournament, latest tournament, current month, ELO movers, and Explore links.

The page is implemented by `renderHome(container, params)` in `js/pages/home.js` and registered in `js/app.js` as `'/'`. Player names in dashboard tables link to the Players hub with `#/players?p=<name>`.

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
- `renderKpis()` fills `#home-kpis` with latest winner, latest player count, month average leader, tournaments this month, and active players this month.
- `renderMovers()` fills `#home-movers` with a compact latest-tournament ELO delta bar list.
- `renderNotificationBell()` mounts asynchronously into `#home-header-right`.
- `State`, `calculateAllEloRankings`, and `getMembers` are imported in `home.js` but are not used by the current implementation.

## Key Files & Symbols
- `js/pages/home.js` — exports `renderHome`, `shouldShowConfirmationPopup`, and `buildConfirmationAlertMessage`; local helpers include `getCurrentYearMonth`, `getPrevYearMonth`, `formatMonth`, `overviewToStats`, `formatDate`, `renderKpis`, `renderMovers`, `renderTable`, and `renderCurrentMonthTable`.
- `js/app.js` — registers route `'/'` to `renderHome`.
- `js/cache.js` — stores `home_matches` and `home_players_summary`.
- `js/store.js` — supplies matches, active tournament, current user, Supabase config, monthly overview, tournaments index, and cache mutation helpers used by refresh flows.
- `js/services/tournament.js` — `getActiveTournament`, `getLatestCompleteTournamentDate`, and `confirmAttendanceAndPush`.
- `js/services/statistics.js` — `calculatePlayerStatistics`.
- `js/services/elo.js` — fallback ELO helpers `getEloSnapshots` and `getEloForDate`.
- `js/services/backend.js` — Home route hydration, `ensureDayMatchesLoaded`, and `pullMonthlyOverview`.
- `js/services/telegram.js` — `sendTournamentConfirmationAlert`.
- `js/components/notification-bell.js` — `renderNotificationBell`.
- `js/components/nav.js` — desktop `renderNav()` creates the left `nav.side-nav` shell used around this page.
- `css/desktop.css` — desktop layout classes used here, including `dash-grid`, `span-6`, `span-12`, `panel`, `kpi-row`, and `kpi`.

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
Home has no sub-tabs. It has these dashboard sections:

- Page header — title/version, refresh button, preview deploy id, and notification bell slot.
- KPI row — `renderKpis()` summary cards.
- Active Tournament — live tournament card linking to `#/tournament/<date>`.
- Latest Tournament — sortable table for latest completed day; player names link to `#/players?p=<name>`.
- Current Month — sortable current-month overview table; player names link to `#/players?p=<name>`.
- ELO movers — compact latest-tournament ELO gain/loss list with a link to ELO Charts.
- Explore — cards linking to Players, Statistics, ELO Charts, and Tournaments.
- Attendance confirmation popup — modal confirmation for a registered current user in an active tournament.

## Related Feature Docs
- `.github/features/home-current-month.md` — Home current-month table behavior and route-scoped loading.
- `.github/features/player-ranking.md` — related ranking expectations for match-derived player stats.
- `.github/features/desktop-ui.md` — desktop dashboard and shell layout changes.

## Update Protocol
Update this skill whenever `js/pages/home.js` dashboard render logic, data shape, sorting, sections, player links, or route hydration changes, or when the linked feature MDs change.
