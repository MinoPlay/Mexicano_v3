---
name: tab-attendance
description: >
  Reference skill for the Attendance tab (route /attendance) of the Mexicano PWA, including the
  Calendar and Statistics sub-tabs. Covers purpose, rules, key files, data flow. Use when working on the attendance page.
---

# Attendance tab

## Purpose
The Attendance tab is the route `#/attendance` registered in `js/app.js` and rendered by `renderAttendance` from `js/pages/attendance.js`. It is reached by links or direct route navigation, not by the bottom navigation: `js/components/nav.js` does not include `/attendance` in `NAV_ITEMS`.

The page shows attendance derived from tournament matches and manual no-tournament attendance entries. It has two sub-tabs: Calendar for a month grid and Statistics for a sortable attendance table.

## Rules / Logic
`renderAttendance(container, params = {})` clears the container, loads `allMatches` from `Store.getMatches()`, chooses the initial month with `getInitialMonth(allMatches)`, and builds the page header and content area.

Month navigation is local to the page. `renderNav()` renders previous and next buttons around the current `MONTHS[currentMonth - 1] currentYear` label. Clicking previous decrements `currentMonth`, rolling from January to December and decrementing `currentYear`; clicking next increments `currentMonth`, rolling from December to January and incrementing `currentYear`. Each click calls `renderContent()`.

When no matches are loaded, the page checks `Store.getPlayersSummary().length > 0` and `Store.getGitHubConfig()?.pat`. If summary data and a PAT exist, it shows a loading state, dynamically imports `ensureAllMatchesLoaded` from `../services/github.js`, replaces `allMatches`, recalculates the initial month, and then calls `buildContent()`. If that load fails, it shows a failure empty state. Without loadable history it shows “No attendance data”.

Sub-tab switching is controlled by the local `activeTab` variable inside `buildContent()`. It starts as `'calendar'`. `renderTabsBar()` renders `Calendar` and `Statistics` buttons, marks the active one with the `active` class, and on click updates `activeTab`, then calls `renderTabsBar()` and `renderBody()`.

`renderBody()` decides which section to draw. For `activeTab === 'calendar'`, it calls `getMonthlyAttendance(currentYear, currentMonth)` and passes the result to `renderCalendar(body, currentYear, currentMonth, monthData)`. For the statistics tab, it calls `renderStatsTable(body, allMatches)`.

`renderCalendar(el, year, month, monthData)` builds weekday headers from `WEEKDAYS`, computes `daysInMonth(year, month)` and `firstWeekday(year, month)`, inserts leading empty cells, then creates one `.attendance-day` cell per day. Cells with attendance get `has-tournament`, a pointer cursor, a day number, and an attendance count; clicking opens `showDayPlayers(info.players, year, month, day)`. In the current page code, `renderCalendar` looks for `monthData.days` entries with `day`, `count`, and `players` fields.

`getMonthlyAttendance(year, month, manualEntries?)` lives in `js/services/attendance.js`. It reads matches from `Store.getMatches()`, defaults manual entries to `Store.getManualAttendance()`, calls `buildMonthParticipation(allMatches, manual, YYYY-MM)`, and returns sorted `{ date, players, playerCount }` rows. This service merges tournament matches and manual no-tournament attendance.

`showDayPlayers(players, year, month, day)` creates a modal overlay listing players for the selected day. It closes through the `dialog-close` button or by clicking the overlay background.

`renderStatsTable(el, allMatches)` calls `getAttendanceStatistics(allMatches)`, renders an empty state if no rows exist, otherwise creates a sortable table. The table columns in the page are `rank`, `name`, `attended`, `total`, and `rate`; clicking non-rank headers toggles `sortCol` and `sortDir`, then re-renders. The attendance service currently returns `{ playerName, attendanceCount, attendancePercentage, totalTournaments }`, so keep the page/table row shape in sync when changing this path.

Manual attendance is created outside this page by `showManualAttendanceDialog()` in `js/components/manual-attendance-dialog.js`. The dialog is opened from Settings → Attendance → “➕ Add Attendance”, not from `/attendance`. It validates against tournament dates from `Store.getMatches()`, only accepts real member names from `getMembers()`, calls `upsertManualEntry(Store.getManualAttendance(), { date, players }, tournamentDates())`, then saves with `Store.setManualAttendance(next)`.

## Key Files & Symbols
- `js/pages/attendance.js` — exports `renderAttendance`; contains `getInitialMonth`, `daysInMonth`, `firstWeekday`, `renderCalendar`, `showDayPlayers`, and `renderStatsTable`.
- `js/services/attendance.js` — exports `buildMonthParticipation`, `upsertManualEntry`, `getMonthlyAttendance`, and `getAttendanceStatistics`; merges tournament match attendance with manual attendance.
- `js/components/manual-attendance-dialog.js` — exports `showManualAttendanceDialog`; writes manual no-tournament attendance through `Store.setManualAttendance`.
- `js/store.js` — `Store.getMatches()`, `Store.getManualAttendance()`, and `Store.setManualAttendance(entries)` are the key data accessors.
- `js/services/github.js` — `keyToPath('attendance_manual')` maps to `data/attendance_manual.json`; `pullCoreData` reads that file into `localStorage` as `mexicano_attendance_manual`; `schedulePush`/`executePush` sync store writes.
- `js/app.js` — registers route `/attendance` to `renderAttendance` and gives it the page name `Attendance`.
- `js/components/nav.js` — bottom nav source; `/attendance` is intentionally absent from `NAV_ITEMS`.

## Data
The Attendance page reads tournament match data from `Store.getMatches()`. Match rows are expected to include `date` plus player name fields used by the attendance service: `team1Player1Name`, `team1Player2Name`, `team2Player1Name`, and `team2Player2Name`.

Manual no-tournament attendance is stored under the Store key `attendance_manual` and persisted to `data/attendance_manual.json`. The feature document defines the JSON shape as:

```json
[
  { "date": "YYYY-MM-DD", "players": ["Name", "..."], "note": "" }
]
```

`Store.getManualAttendance()` defaults to `[]`. `Store.setManualAttendance(entries)` writes the store key, which schedules a GitHub push because `attendance_manual` is allowlisted by `keyToPath`.

`buildMonthParticipation(matches, manualEntries, yearMonth)` builds `{ datePlayerMap, tournamentDates }`, where `datePlayerMap` maps each date to a `Set` of unique player names. `getMonthlyAttendance` converts that to sorted monthly rows. `getAttendanceStatistics` groups tournament and manual dates into session dates, counts player attendance, and computes attendance percentage over the number of sessions.

`State` is not imported or used directly by `js/pages/attendance.js`; this page relies on local render state (`currentYear`, `currentMonth`, `activeTab`) plus `Store` and service functions.

## Sub-tabs / Sections
- Calendar — month grid of attendance. It is rendered by `renderCalendar` through `renderBody()` when `activeTab` is `'calendar'`. Month controls remain above the tabs and affect this view by changing `currentYear` and `currentMonth`.
- Statistics — attendance stats table. It is rendered by `renderStatsTable` through `renderBody()` when `activeTab` is `'statistics'`. The table is sortable by player/stat columns.

Switching uses `activeTab`, `renderTabsBar()`, and `renderBody()`: tab button clicks update `activeTab`, redraw the tab bar so the active class is correct, and redraw only the body section.

## Related Feature Docs
- `.github/features/manual-attendance.md` — explains manual no-tournament attendance, the `data/attendance_manual.json` store file, validation rules, sync behavior, and all pages affected by manual entries, including `/attendance`.

## Update Protocol
Update this skill whenever `js/pages/attendance.js` calendar/stats logic, sub-tabs, data shape, or routing changes, or when the linked feature MD changes.
