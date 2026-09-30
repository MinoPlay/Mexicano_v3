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
- The dashboard reads a route-scoped match projection from `Cache.get('home_matches')` with `Store.getMatches()` as fallback, and player summary from `Cache.get('home_players_summary')` with `Store.getPlayersSummary()` as fallback.
- `getActiveTournament()` provides the active tournament card, but it is suppressed when `Store.getTournamentsIndex()` already marks the same date complete.
- Latest tournament stats use `getLatestCompleteTournamentDate()`, day matches, `calculatePlayerStatistics(dayMatches)`, and `attachEloToStats(stats)`.
- Current-month stats use the browser current `YYYY-MM`, `Store.getMonthlyOverview(currentYearMonth)`, `Store.getMonthlyOverview(prevYearMonth)`, and `overviewToStats()`. Local matches are a fallback.
- Latest and current-month tables keep independent local sort state. Sortable columns are name, W/T, points, average, win rate, ELO, and ELO delta.
- `renderKpis()` fills `#home-kpis` with latest winner, latest player count, month average leader, tournaments this month, and active players this month.
- `renderMovers()` fills `#home-movers` with a compact latest-tournament ELO delta bar list.
- With Supabase configured, the app route loader calls `pullForRoute('#/')`, which loads only Home-scoped data. Missing latest-day matches are fetched through `ensureDayMatchesLoaded(latestDate)`. Monthly overview data is refreshed with `pullMonthlyOverview(currentYearMonth, { route: '#/' })` and previous month.
- The header title shows `🎾 Mexicano v<APP_VERSION>` plus preview deploy id when present. Clicking the title clears in-memory domain caches and reloads; clicking `#app-refresh-btn` calls `refreshApp()`.
- `renderNotificationBell()` mounts asynchronously into `#home-header-right`.
- Attendance confirmation uses `shouldShowConfirmationPopup(activeTournament, currentUser)` and `confirmAttendanceAndPush(currentUser)`, then best-effort sends `sendTournamentConfirmationAlert()`.

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
Home reads these data shapes:

- Match rows: `date`, player-name fields, `scoreTeam1`, and `scoreTeam2`.
- Active tournament: `tournamentDate`, `isCompleted`, `players`, and `players[].confirmed`.
- Tournament index entries: `date`, `isComplete`, and current-month membership by date prefix.
- Monthly overview rows: `{ name, totalPoints, wins, losses, average, elo }`.
- Player summary rows: `name`, `elo`, and `previousElo`.

`overviewToStats()` maps monthly overview rows to `{ name, wins, losses, points, average, winRate, elo, eloChange }`. `calculatePlayerStatistics()` returns match-derived table rows with wins, losses, points, average, win rate, and rank-compatible fields.

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
