---
name: tab-statistics
description: >
  Reference skill for the Statistics tab (route /statistics) of the Mexicano PWA, including the
  Statistics/Attendance sub-tabs and the player-profile Overview/Head-to-Head/Partners views.
  Covers purpose, rules, key files, data flow. Use when working on the statistics page.
---

# Statistics tab

## Purpose
The Statistics tab is the `/statistics` route for player performance and attendance. It renders two top-level sub-tabs: **Statistics** for ranked player stat tables and **Attendance** for attendance counts, charting, and attendance-date lookup. Clicking a player name in the statistics table opens the player-profile dialog, which loads pre-generated player summary data and shows Overview, Head-to-Head, and Partners views.

The page is implemented in `js/pages/statistics.js` and exported as `renderStatistics(container, params = {})`. The route is wired in `js/app.js` as `'/statistics': renderStatistics`.

## Rules / Logic
`renderStatistics` builds the page header, tab bar, Statistics panel, and Attendance panel. The active top-level tab is stored in `localStorage` as `stats_active_tab`; accepted values are `Statistics` and `Attendance`, with `Statistics` as fallback. When switching to Attendance, the page redraws the chart if its collapsible chart section is expanded.

The Statistics panel has a filter bar and a sortable table. Filter state is stored under `stats_active_filter` and defaults to `latest`. Supported filters are:

- `all` — all-time stats from `Store.getPlayersSummary()` / `players.json`; fallback computes from local matches.
- `latest` — stats for `getLatestCompleteTournamentDate()`.
- `YYYY-MM` — monthly overview from `Store.getMonthlyOverview(yearMonth)` / `players_overview.json`; fetched lazily with `pullMonthlyOverview` when GitHub is configured.
- `YYYY-MM-DD` — one tournament day from cached matches or `ensureDayMatchesLoaded(date)`.

The main table is rendered by `renderSortableTable(container, stats, onPlayerClick, columns = STAT_COLUMNS, defaultSort = 'average')`. `STAT_COLUMNS` defines `#`, `NAME`, `W/T`, `PTS`, `AVG`, `WIN`, `ELO`, and `WLO`. Default sort is `average` descending; `name` defaults to ascending when first selected. User header clicks use `getNextStatisticsSortState`, then `sortStatisticsRows`, which sorts by the selected column, then `wins` descending, then `name` ascending. `rank` is recalculated after sorting. The `rank` column is not clickable. Column resize handles support drag resize and double-click auto-fit.

Stats rows come from `calculatePlayerStatistics(matches)` for raw match data or from summary/overview mapping for precomputed data. `calculatePlayerStatistics` ignores matches where both scores are zero, calculates wins, losses, points, games played (`wl`), average points, win rate, and win categories, then assigns ranks by points descending and wins descending. `overviewToStats` converts monthly overview rows and computes monthly ELO change against the previous month. ELO can be attached from players summary, ELO snapshots, player history files, or embedded match ELO data through `attachEloFromSummary`, `attachEloFromSnapshots`, `attachEloFromPlayerHistoryFiles`, and `attachEloFromEmbeddedMatchData`.

Player names in the main statistics table call `showPlayerProfile(name)`. This dialog is defined inside `js/pages/statistics.js`, not by `js/components/player-profile.js` for the `/statistics` route. The dialog lazy-imports `readPlayerSummary` from `js/services/github.js` and reads `players_summaries/summary_<player>.json`. If no summary exists, it shows a GitHub/config-specific empty state telling the user to generate summaries.

The profile dialog sub-tab state is in local variables only. It starts on `Overview`, switches by re-rendering tab buttons and body content, and resets when the dialog is reopened. Head-to-Head and Partners each keep their own in-dialog sort state, defaulting to `gamesPlayed` descending. `Last 3` columns are rendered with `formatRecentResults` and are not sortable.

## Key Files & Symbols
- `js/pages/statistics.js` — route render and UI behavior: `renderStatistics`, `renderSortableTable`, `STAT_COLUMNS`, `sortStatisticsRows`, `getNextStatisticsSortState`, `showPlayerProfile`, `renderDayStatsInto`, `renderAttendanceSection`, `attachEloFromSummary`, `attachEloFromSnapshots`, `attachEloFromPlayerHistoryFiles`, `attachEloFromEmbeddedMatchData`.
- `js/services/statistics.js` — pure/stat helpers: `calculatePlayerStatistics`, `getMonthsForAttendanceFilter`, `computeAttendance`, `getPlayerAttendanceDates`, `formatRecentResults`, plus older local profile helpers such as `calculateOpponentStats`, `calculatePartnershipStats`, `generatePlayerSummary`, `sortHeadToHeadTable`, and `sortPartnersTable`.
- `js/services/elo.js` — ELO helpers used by the page: `calculateAllEloRankings`, `getEloSnapshots`, `getEloForDate`, `getEloForMonth`, `getEloFromEmbeddedMatches`.
- `js/services/github.js` — lazy data loading: `pullMonthlyOverview`, `pullMonthlyOverviewRaw`, `ensureDayMatchesLoaded`, `readPlayerSummary`, player ELO history loading.
- `js/store.js` — data access: `Store.getMatches`, `Store.getPlayersSummary`, `Store.getMonthlyOverviewMonths`, `Store.getTournamentDates`, `Store.getMonthlyOverview`, `Store.isMatchesFullyLoaded`, `Store.getManualAttendance`, `Store.getGitHubConfig`.
- `js/components/chart.js` — Attendance uses `drawBarChart` for the Canvas bar chart.
- `js/components/player-profile.js` — older standalone local-match profile dialog. Do not assume it powers `/statistics`; current `/statistics` uses `showPlayerProfile` in `js/pages/statistics.js`.
- `js/components/leaderboard.js` — generic leaderboard renderer used elsewhere; the Statistics route uses `renderSortableTable` instead.
- `js/state.js` — simple app pub/sub and route blockers. It is imported by `js/app.js`, but `js/pages/statistics.js` does not use `State` directly.
- `js/app.js` — route registration for `/statistics`.

## Data
Raw match rows are stored in `Store.getMatches()` and use flattened player/team fields such as `date`, `team1Player1Name`, `team1Player2Name`, `team2Player1Name`, `team2Player2Name`, `scoreTeam1`, and `scoreTeam2`. Raw match filters compute day/latest/all-time fallback stats with `calculatePlayerStatistics`.

All-time canonical data comes from `players.json`, exposed through `Store.getPlayersSummary()` as camelCase rows like `{ name, elo, previousElo, wins, losses, points, average, tournaments }`. The all-time table maps this to table fields and shows `eloChange` as `elo - 1000`.

Monthly data comes from `YYYY/YYYY-MM/players_overview.json`, exposed through `Store.getMonthlyOverview(yearMonth)` with rows containing values such as `name`, `wins`, `losses`, `totalPoints`, `average`, and `elo`. `overviewToStats` calculates `points`, `wl`, `winRate`, and ELO change against the previous month.

Attendance intentionally uses raw monthly overview arrays from `pullMonthlyOverviewRaw`, not `Store.getMonthlyOverview()`, because attendance needs each `ELO[].Date` entry. `computeAttendance(rawByMonth, filter, today, Store.getManualAttendance())` counts attendance by player, merges manual no-tournament attendance, excludes zero-count players, and sorts attendance descending then name ascending. `getPlayerAttendanceDates` returns unique matching dates sorted newest first for the attendance-date dialog.

Player-profile summary data is not computed on the page. `showPlayerProfile` loads a pre-generated summary object from GitHub. The expected object includes aggregate fields such as `totalTournaments`, `totalWins`, `totalLosses`, `totalPoints`, `tightWins`, `solidWins`, `dominatingWins`, `firstPlaceFinishes`, `secondPlaceFinishes`, `thirdPlaceFinishes`, plus `opponents` and `partners` arrays for the profile tables.

## Sub-tabs / Sections
- Statistics — Shows filter chips/selectors and the sortable player stat table. Columns are defined by `STAT_COLUMNS`: rank, name, wins/total games, points, average, win percentage, ELO, and ELO change. Header clicks sort with visual `sort-asc` / `sort-desc` classes. Clicking a player name opens `showPlayerProfile`.
- Attendance — Embedded attendance view inside `/statistics`. It has filter chips `Current`, `30`, `60`, `90`, and `120`, persisted as `stats_attendance_filter`. It shows an Attendance chart section expanded by default and an Attendance Table section collapsed by default. Collapse state lives in `stats-attendance-prefs`. Table row clicks open a dialog listing exact attended dates in a 4-column grid.
- Player profile dialog sub-tabs: Overview, Head-to-Head, Partners — `Overview` shows quick stat cards for tournaments, games, wins, losses, win rate, average points, win categories, total points, and podium finishes. `Head-to-Head` shows opponent rows with Opponent, Games, W, L, Win%, and Last 3. `Partners` shows Partner, Games, W, L, Avg Pts, and Last 3. Sub-tab switching re-renders the same dialog body; H2H and partner sort state persists while that dialog instance remains open.

## Related Feature Docs
- `.github/features/statistics.md` — Source of truth for Statistics page data sources, filters, default sorting, Attendance tab behavior, raw attendance data requirements, localStorage keys, collapsible sections, attendance date dialog, and profile-table sorting expectations.
- `.github/features/player-ranking.md` — Explains the ranking model used elsewhere in the app: points descending, wins descending, points per game descending, then name ascending, with tied ranks and rank gaps. Use it when comparing Statistics table ranking/sorting behavior to tournament/player ranking rules.

## Update Protocol
Update this skill whenever `js/pages/statistics.js` stat calculations, columns, sub-tabs, profile dialog, data shape, or routing changes, or when the linked feature MDs change.
