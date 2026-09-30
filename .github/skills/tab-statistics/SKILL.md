---
name: tab-statistics
description: >
  Reference skill for the Statistics tab (route /statistics) of the Mexicano PWA, including the
  desktop stats, attendance, and pair-matrix panels. Covers purpose, rules, key files, data flow.
  Use when working on the statistics page.
---

# Statistics tab

## Purpose
The Statistics tab is the `/statistics` route for player performance, attendance, and pair analysis. It is now a desktop dashboard grid, not a Statistics/Attendance tabbed page.

`renderStatistics(container, params = {})` in `js/pages/statistics.js` renders three panels: Player statistics (`span-7`), Attendance (`span-5`), and Pair matrix (`span-12`). Clicking a player name in the statistics table navigates to `#/players?p=<name>`; the old profile modal is no longer used from the table.

## Rules / Logic
The page builds one `dash-grid` under `.page-content`.

Player statistics panel:

- Filter state is stored in `localStorage` under `stats_active_filter`; default is `latest`.
- Filters are All Time, Latest, month (`YYYY-MM`), and date (`YYYY-MM-DD`).
- All Time prefers `Store.getPlayersSummary()` and falls back to `calculatePlayerStatistics(Store.getMatches())` plus `calculateAllEloRankings`.
- Month filters lazy-load current and previous monthly overview with `pullMonthlyOverview()` so ELO delta can be computed by `overviewToStats(overview, prevOverview)`.
- Date/latest filters use locally cached day matches when available, otherwise `ensureDayMatchesLoaded(targetDate)`.
- `renderDayStatsInto(container, matches, targetDate, isLatest, onPlayerClick)` is shared with Tournament detail and renders rich day stats.
- `renderSortableTable()` renders columns from `STAT_COLUMNS` and handles sortable/resizable headers. Default sort is `average` descending.

Attendance panel:

- `renderAttendanceSection(panel)` is embedded inside Statistics.
- Attendance filter is stored as `stats_attendance_filter`; values are `latest`, `30`, `60`, `90`, and `120`.
- Collapse prefs live under `stats-attendance-prefs`. The chart section is expanded by default and the Attendance Table section is collapsed by default.
- It loads raw participation for needed months with `pullMonthlyOverviewRaw`, then calls `computeAttendance(raw, attFilter, today, Store.getManualAttendance())`.
- `drawBarChart()` renders the chart. Table row clicks open an attendance-date dialog using `getPlayerAttendanceDates()`.

Pair matrix panel:

- `renderPairHeatmap(heatPanel)` from `js/components/pair-heatmap.js` renders partner/opponent win-rate heatmaps.
- The heatmap picks the most active players with `pickActivePlayers(buildPlayerRows(matches), size)`.
- It needs full match history. If Supabase is configured and `Store.isMatchesFullyLoaded()` is false, it shows a "Load full history" button that calls `pullForRoute('#/__full__')`.
- Heatmap player names link to `#/players?p=<name>`.

`showPlayerProfile(playerName)` still exists in `js/pages/statistics.js` for older/local callers, but the current Statistics table passes `openPlayerInHub`, not the modal.

## Key Files & Symbols
- `js/pages/statistics.js` — exports `renderStatistics`, `renderSortableTable`, `sortStatisticsRows`, `getNextStatisticsSortState`, `showPlayerProfile`, `attachEloFromSummary`, `attachEloFromSnapshots`, `attachEloFromPlayerHistoryFiles`, `attachEloFromEmbeddedMatchData`, and `renderDayStatsInto`; local `STAT_COLUMNS`, `overviewToStats`, `renderAttendanceSection`, and `openPlayerInHub`.
- `js/components/pair-heatmap.js` — `renderPairHeatmap` and `pickActivePlayers`.
- `js/components/chart.js` — `drawBarChart` and `heatColor` support Attendance and heatmaps.
- `js/services/player-insights.js` — `buildPlayerRows` and `buildPairMatrix` support the heatmap.
- `js/services/statistics.js` — `calculatePlayerStatistics`, `getMonthsForAttendanceFilter`, `computeAttendance`, `getPlayerAttendanceDates`, and `formatRecentResults`.
- `js/services/elo.js` — ELO fallback helpers.
- `js/services/backend.js` — `pullMonthlyOverview`, `pullMonthlyOverviewRaw`, `ensureDayMatchesLoaded`, and full-history `pullForRoute`.
- `js/store.js` — matches, players summary, monthly overviews, tournament dates, manual attendance, full-match state, and Supabase config.
- `js/app.js` — registers `/statistics`.
- `css/desktop.css` — `dash-grid`, `span-7`, `span-5`, `span-12`, `panel`, and heatmap layout.

## Data
The Statistics page uses:

- Match rows for date/latest fallback and full-history calculations.
- `Store.getPlayersSummary()` for All Time summary rows.
- `Store.getMonthlyOverview(yearMonth)` for monthly rows with `{ name, wins, losses, totalPoints, average, elo }`.
- Raw monthly attendance arrays loaded by `pullMonthlyOverviewRaw`.
- Manual attendance from `Store.getManualAttendance()`.
- Pair-matrix rows derived from full match history by `buildPlayerRows()` and `buildPairMatrix()`.

`STAT_COLUMNS` are rank, name, W/T, points, average, win rate, ELO, and WLO/ELO change. Player clicks are route navigations to the Players hub.

## Sub-tabs / Sections
There are no top-level sub-tabs. Sections are:

- Player statistics — filter bar and sortable/resizable player stats table.
- Attendance — filter chips, collapsible chart, collapsible table, and attendance-date dialog.
- Pair matrix — partner/opponent heatmap with mode chips, Top N selector, full-history loader, and player profile links.
- Legacy player profile dialog — code remains for callers of `showPlayerProfile`, with Overview, Head-to-Head, and Partners internal tabs, but it is not opened by the current Statistics table.

## Related Feature Docs
- `.github/features/statistics.md` — Statistics data sources, filters, attendance behavior, and profile-table expectations.
- `.github/features/player-ranking.md` — related player/tournament ranking rules.
- `.github/features/desktop-ui.md` — dashboard grid and pair-matrix desktop layout.

## Update Protocol
Update this skill whenever `js/pages/statistics.js` panels, filters, stat columns, attendance, pair heatmap integration, player navigation, data shape, or routing changes, or when the linked feature MDs change.
