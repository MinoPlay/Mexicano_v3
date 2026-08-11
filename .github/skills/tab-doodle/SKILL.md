---
name: tab-doodle
description: >
  Reference skill for the Doodle tab (route /doodle) of the Mexicano PWA — scheduling and
  availability with Telegram alerts. Covers purpose, rules, key files, data flow. Use when working on the doodle page.
---

# Doodle tab

## Purpose
The Doodle tab is the month-by-month scheduling page for player availability. It lets the current user mark which playable dates they can attend, see aggregate availability for all players, inspect actual tournament participation for the viewed month, and review recent availability changes.

The route is `/doodle`, wired in `js/app.js` to `renderDoodle()` from `js/pages/doodle.js`.

## Rules / Logic
`renderDoodle(container, params = {})` builds the page. If `Store.getCurrentUser()` is empty, it shows a "No user selected" empty state and does not render scheduling controls.

Scheduling is monthly. The viewed month starts at the current month and is changed with previous/next buttons. Month switches discard any active `DoodleEditSession` after cleanup.

Valid scheduling dates are hardcoded to Tuesdays and Thursdays:
- `getAllDatesInMonth(year, month)` in `js/services/doodle.js` returns only dates where `Date.getDay()` is `2` or `4`.
- Dates use zero-padded `YYYY-MM-DD`.
- Month keys use `YYYY-MM`.

Availability can be toggled from two places:
- the personal calendar grid in `renderUserCalendar()`;
- the current user's row in the overall availability matrix in `renderMatrix()`.

Only playable future dates can be clicked. The page compares ISO date strings against `new Date().toISOString().slice(0, 10)`; past dates are styled as past/read-only. Non-Tuesday/Thursday calendar cells are inactive. Other players' matrix cells are always read-only.

Toggles are staged in `DoodleEditSession`, not written immediately. The session captures `originalState` from `getDoodle()`, keeps `currentEdits` as player-to-`Set<date>` maps, exposes `isDirty()`, and marks changed cells with `doodle-pending`. A fixed bottom save bar appears only when the session is dirty.

Saving runs through `DoodleEditSession.save()`:
1. Prevent concurrent saves with `isSaving`.
2. Pull the latest remote month via `pullDoodleMonth(ym)`.
3. Merge remote player entries not already in local `Store.getDoodle(ym)`.
4. Apply the edited selections with `saveDoodle(playerName, year, month, selectedDates)`.
5. Collect returned changelog entries as pending Telegram alerts.
6. Push the month immediately with `pushDoodleNow(ym)`.
7. Fire `sendDoodleAlert()` for each changed player after the GitHub write succeeds.
8. Call `cancelPendingSync()` and show `Doodle saved`.

`saveDoodle()` validates every selected date against `getAllDatesInMonth()`, writes the normalized sorted `selectedDates` array to `Store.setDoodle()`, attempts a dev-server `writeDoodle()`, computes `selectedAdded` and `selectedRemoved`, appends a changelog entry through `logDoodleChange()` when the diff is non-empty, and emits `State.emit('doodle-changed', { year, month })`.

Cancel reverts the edit session to the captured Store state and re-renders the calendar/matrix. Route changes and browser unload are guarded while dirty with `State.addRouteBlocker()` and `beforeunload`; the unsaved-changes modal lets the user save or discard.

`renderMatrix()` aggregates all visible upcoming dates in the month. It builds one row per current user or player with future availability, computes per-date totals, highlights best dates with `doodle-best`, and makes a future total cell clickable when at least one player is available. Clicking a total routes to `#/create-tournament?date=<date>&names=<names>`, with available players sorted by ELO from `buildEloMap()`.

`renderPlayerOverview()` is separate from availability. It shows actual played counts for the viewed month using `Store.getMonthlyOverview(ym)`, `Store.getMatches()`, `Store.getManualAttendance()`, and `buildMonthParticipation()`. It also shows `MatchPadelId` from `Store.getPlayersSummary()`; players with `matchPadelId === 0` get a money badge and a `playedCount * 90kr` cost.

`renderChangelog()` displays recent entries from `getChangelog(currentYear, currentMonth)`: five collapsed rows, up to twenty expanded rows, and a dialog with full added/removed dates and timestamp.

Telegram alerts are fire-and-forget after successful GitHub commit. `sendDoodleAlert(playerName, yearMonth, selectedAdded, selectedRemoved)` skips empty diffs, formats the doodle update message, and relays it through a GitHub `repository_dispatch` event handled by the data repo workflow. Alert failures are logged with `[telegram] alert error:` and do not block the UI.

## Key Files & Symbols
- `js/pages/doodle.js` — exports `renderDoodle()`; defines `DoodleEditSession`, `buildEloMap()`, `formatDay()`, `renderUserCalendar()`, `renderMatrix()`, `renderPlayerOverview()`, `renderChangelog()`, save bar, unsaved-change modal, route blocker, and GitHub pull-on-render logic.
- `js/services/doodle.js` — `getAllDatesInMonth()`, `getDoodle()`, `saveDoodle()`, `deleteDoodle()`, `logDoodleChange()`, `getChangelog()`.
- `js/services/github.js` — `pullDoodleMonth()`, `pushDoodleNow()`, `cancelPendingSync()`, `clearSessionTTL()`, `pullMonthlyOverview()`, `ensureDayMatchesLoaded()`.
- `js/services/telegram.js` — `sendDoodleAlert()`, `buildDoodleAlertText()`, `dispatchTelegramAlert()`.
- `js/services/attendance.js` — `buildMonthParticipation()` for the Player Overview section.
- `js/store.js` — `Store.getDoodle()`, `Store.setDoodle()`, `Store.getDoodleChangelog()`, `Store.setDoodleChangelog()`, `Store.getCurrentUser()`, `Store.getGitHubConfig()`, `Store.getPlayersSummary()`, `Store.getMonthlyOverview()`, `Store.getManualAttendance()`, `Store.getMatches()`, `Store.getTournamentDates()`.
- `js/state.js` — `State.emit('doodle-changed')`, `State.on('doodle-changed')`, `State.addRouteBlocker()`.
- `js/app.js` — maps `/doodle` to `renderDoodle()`.

## Data
Local Store keys:
- `doodle_<YYYY-MM>` — monthly doodle entries.
- `doodle_changelog_<YYYY-MM>` — monthly changelog entries.
- `current_user` — active player name.
- `github_config` — `{ owner, repo, pat }`, used for GitHub sync and Telegram relay dispatch.
- `attendance_manual` — manual no-tournament attendance used by Player Overview.
- cached/read-only data used by this page includes `players_summary`, `monthly_<YYYY-MM>`, `tournament_dates`, and `matches`.

Raw monthly doodle JSON shape:
```json
[
  {
    "name": "Player Name",
    "selectedDates": ["2026-08-11", "2026-08-13"]
  }
]
```

`getDoodle(year, month)` transforms each raw entry for UI use:
```json
{
  "name": "Player Name",
  "selected": {
    "2026-08-11": true,
    "2026-08-13": true
  },
  "allowEdit": true
}
```

Monthly changelog shape:
```json
{
  "playerName": "Player Name",
  "yearMonth": "2026-08",
  "year": 2026,
  "month": 8,
  "selectedAdded": ["2026-08-11"],
  "selectedRemoved": ["2026-08-13"],
  "timestamp": "2026-08-11T11:51:25.386Z"
}
```

GitHub paths are derived from Store keys:
- `YYYY/YYYY-MM/doodle_YYYY-MM.json`
- `YYYY/YYYY-MM/doodle_changelog_YYYY-MM.json`
- `YYYY/YYYY-MM/players_overview.json`

Telegram does not store bot tokens or chat ids in the client. The client sends `repository_dispatch` to `https://api.github.com/repos/{owner}/{repo}/dispatches` with `event_type: "telegram_alert"` and `client_payload: { text, kind }`. The data repo workflow maps that to the actual Telegram Bot API call using repo secrets.

## Sub-tabs / Sections
There are no route-level sub-tabs. The page is a flat Doodle view with these main sections:
- Current user header and month navigation.
- Personal availability calendar grid.
- Collapsible "Overall availability" matrix with per-date totals and create-tournament shortcut.
- Collapsible "Player Overview" showing actual played counts, MatchPadel IDs, and no-account costs.
- Fixed dirty-state save bar with Save and Cancel.
- "Recent Changes" changelog with expandable rows and a details dialog.

## Related Feature Docs
- `.github/features/doodle-scheduling.md` — canonical scheduling rules, data schema, date validation, UI behavior, GitHub paths, and edge cases for doodle availability.
- `.github/features/telegram-alerts.md` — explains the GitHub Actions relay architecture, doodle trigger point, message format, dispatch payload, and fire-and-forget alert behavior.

## Update Protocol
Update this skill whenever js/pages/doodle.js scheduling logic, alerts, data shape, or routing changes, or when the linked feature MDs change.
