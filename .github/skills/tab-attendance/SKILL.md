---
name: tab-attendance
description: >
  Reference skill for the Attendance tab (route /attendance) of the Mexicano PWA, including the
  side-by-side Calendar and Statistics panels plus the Year overview heatmap. Covers purpose,
  rules, key files, data flow. Use when working on the attendance page.
---

# Attendance tab

## Purpose
The Attendance tab is the route `#/attendance` registered in `js/app.js` and rendered by `renderAttendance` from `js/pages/attendance.js`. It shows attendance derived from participation rows and manual no-tournament attendance.

The desktop page no longer uses Calendar/Statistics sub-tabs. It renders Calendar and Statistics side by side and adds a Year overview heatmap below them.

## Rules / Logic
`renderAttendance(container, params = {})` clears the container, reads `allMatches` from `getParticipationRows()`, chooses the initial month with `getInitialMonth(allMatches)`, and builds the page header/content.

Loading:

- `getParticipationRows()` prefers lightweight participation rows (`{ date, players }`) and falls back to full match rows.
- If no rows are loaded, or Supabase is configured and `Store.isParticipationComplete()` is false, the page shows "Loading match history…", imports `ensureParticipationLoaded()`, reloads participation rows, recalculates the initial month, and then builds content.
- If loading fails, it shows "Failed to load match history".

Layout:

- `buildContent()` adds `dash-grid` to content and creates three panels: Calendar (`span-6`), Statistics (`span-6 attendance-stats`), and Year overview (`span-12`).
- Month navigation is rendered into the Calendar panel header by `renderNav()`.
- Previous/next month buttons roll year boundaries and call `renderContent()`.

Calendar:

- `renderBody()` calls `getMonthlyAttendance(currentYear, currentMonth)` and `renderCalendar(body, currentYear, currentMonth, monthData)`.
- `renderCalendar()` builds weekday headers, leading blanks, and one `.attendance-day` per day.
- Cells with attendance get `has-tournament`, show count, and open `showDayPlayers(players, year, month, day)`.

Statistics:

- `renderStatsTable(statsBody, allMatches)` renders once from `getAttendanceStatistics(allMatches)`.
- Columns are rank, player, attended, total, and attendance percentage.
- Sorting is local to the table; default is attended descending.

Year overview:

- `renderYear()` calls `buildYearMatrix(allMatches, currentYear)`.
- It uses `heatColor(50 + (value / max) * 50)` for non-zero month cells.
- A year selector switches `currentYear` and re-renders.
- Month header buttons set `currentMonth` and re-render the calendar/year view.
- Player names in the heatmap link to `#/players?p=<name>`.

Manual attendance remains created outside this page through `showManualAttendanceDialog()` in Settings.

## Key Files & Symbols
- `js/pages/attendance.js` — exports `renderAttendance`; local helpers `getInitialMonth`, `daysInMonth`, `firstWeekday`, `renderCalendar`, `showDayPlayers`, `renderStatsTable`, `renderNav`, `renderBody`, `renderYear`, and `renderContent`.
- `js/services/attendance.js` — `getParticipationRows`, `buildMonthParticipation`, `upsertManualEntry`, `getMonthlyAttendance`, `getAttendanceStatistics`, and `buildYearMatrix`.
- `js/components/chart.js` — `heatColor` for the Year overview heatmap.
- `js/components/manual-attendance-dialog.js` — `showManualAttendanceDialog` writes manual attendance from Settings.
- `js/services/backend.js` — `ensureParticipationLoaded`, manual-attendance hydration and persistence helpers.
- `js/store.js` — participation rows, matches fallback, manual attendance, Supabase config, and participation completeness.
- `js/app.js` — registers `/attendance`.
- `css/desktop.css` — `dash-grid`, `span-6`, `span-12`, `panel`, and heatmap styles.

## Data
Attendance uses participation rows shaped as:

```js
{ date: 'YYYY-MM-DD', players: ['Name'] }
```

Manual no-tournament attendance remains:

```json
[
  { "date": "YYYY-MM-DD", "players": ["Name"], "note": "" }
]
```

`getMonthlyAttendance(year, month)` returns sorted rows `{ date, players, playerCount }`. `getAttendanceStatistics(allMatches)` returns `{ playerName, attendanceCount, attendancePercentage, totalTournaments }`.

`buildYearMatrix(rows, year)` returns `{ years, sessions, players }`, where each player has `months` (12 counts) and `total`.

## Sub-tabs / Sections
There are no sub-tabs. Sections are:

- Calendar — monthly attendance grid with month nav in the panel header.
- Statistics — sortable attendance table.
- Year overview — player x month heatmap with year select and clickable month headers.
- Day players dialog — list of players for a selected calendar day.

## Related Feature Docs
- `.github/features/manual-attendance.md` — manual no-tournament attendance schema, validation, sync behavior, and affected pages.
- `.github/features/desktop-ui.md` — side-by-side Attendance layout and Year overview heatmap.

## Update Protocol
Update this skill whenever `js/pages/attendance.js` calendar/stats/year logic, data shape, routing, or manual-attendance behavior changes, or when the linked feature MDs change.
