---
name: tab-doodle
description: >
  Reference skill for the Doodle tab (route /doodle) of the Mexicano PWA — scheduling and
  availability with Telegram alerts. Covers purpose, rules, key files, data flow, and desktop sections.
  Use when working on the doodle page.
---

# Doodle tab

## Purpose
The Doodle tab is the month-by-month scheduling page at `#/doodle`. It lets the current user mark playable dates, inspect overall availability, view monthly participation, and review recent availability changes.

The desktop layout is two columns in a `dash-grid`: left `span-4` for My availability and Recent Changes, right `span-8` for Overall availability and Player Overview. Overall availability and Player Overview are both open by default.

## Rules / Logic
`renderDoodle(container, params = {})` builds the page. If `Store.getCurrentUser()` is empty, it shows a "No user selected" empty state.

Scheduling:

- The viewed month starts at the current month and changes with previous/next buttons in `renderNav()`.
- Valid dates are Tuesdays and Thursdays from `getAllDatesInMonth(year, month)`.
- Only playable dates today or later can be clicked. Past dates remain read-only.
- Availability toggles from `renderUserCalendar()` or editable rows in `renderMatrix()`. Members edit only themselves; admins (`Store.isAdministrator()`) can edit any player in the matrix. The personal calendar stays bound to the logged-in user.

Edits:

- Edits are staged in `DoodleEditSession`, not written immediately.
- Dirty cells get `doodle-pending`, including edits to other players by an admin. Checkmarks and totals reflect staged selections.
- A fixed save bar appears when the session is dirty. Save calls `DoodleEditSession.save()`; Cancel discards every player's staged changes, including entries not yet saved, and re-renders.
- Route changes and browser unload are blocked while dirty through `State.addRouteBlocker()` and `beforeunload`.

Saving:

Saving runs through `DoodleEditSession.save()`:
1. Prevent concurrent saves with `isSaving`.
2. Re-pull the latest month via `pullDoodleMonth(ym)` so edits are applied on top of the current Supabase state.
3. Apply only locally changed players' selections with `saveDoodle(playerName, year, month, selectedDates)`. Untouched players keep their freshly pulled remote selections.
4. Collect the returned changelog entries as pending Telegram alerts.
5. Push the month immediately with `pushDoodleNow(ym, changes)` — one batched `save_doodle` mutation carrying only the changed players' availability entries (members may write only their own) plus the new changelog entries.
6. Fire `sendDoodleAlert()` for each changed player after the write succeeds.
7. Call `cancelPendingSync()` and show `Doodle saved`.

Overall availability:

- For members, `renderMatrix()` builds one row per current user or player with future availability. Admins see every roster member from `Store.getMembers()` plus existing doodle players, including players with no future selections.
- Removing a player's last selection does not hide their row from admins.
- Per-date totals highlight best dates with `doodle-best`.
- Clicking a future total cell with at least one available player routes to `#/create-tournament?date=<date>&names=<names>`.
- Names for create-tournament are sorted by ELO from `buildEloMap()`.

Player Overview:

- `renderPlayerOverview()` shows actual monthly participation, MatchPadel IDs, and no-account costs.
- It combines `Store.getMonthlyOverview(ym)`, `Store.getMatches()`, `Store.getManualAttendance()`, and `buildMonthParticipation()`.
- Players with `matchPadelId === 0` show a money badge and `playedCount * 90kr`.

Changelog:

- `renderChangelog()` shows recent entries from `getChangelog(currentYear, currentMonth)`.
- It renders up to five rows collapsed and up to twenty expanded, with a details dialog for added/removed dates.

Route/month loading:

- `renderAll()` clears doodle session TTL, calls `pullDoodleMonth(ym)`, and emits `doodle-changed`.
- It also calls `pullMonthlyOverview(ym)` so Player Overview can refresh for the selected month.

## Key Files & Symbols
- `js/pages/doodle.js` — exports `renderDoodle`; defines `DoodleEditSession`, `buildEloMap`, `formatDay`, `renderNav`, `renderUserCalendar`, `renderMatrix`, `renderPlayerOverview`, `renderChangelog`, save bar, unsaved-change modal, and route-blocking cleanup.
- `js/services/doodle.js` — `getAllDatesInMonth`, `getDoodle`, `saveDoodle`, `deleteDoodle`, `logDoodleChange`, and `getChangelog`.
- `js/services/attendance.js` — `buildMonthParticipation` for Player Overview.
- `js/services/backend.js` — `pullDoodleMonth`, `pushDoodleNow`, `cancelPendingSync`, `clearSessionTTL`, and `pullMonthlyOverview`.
- `js/services/telegram.js` — `sendDoodleAlert`.
- `js/services/elo.js` — `calculateAllEloRankings` fallback for availability sorting.
- `js/store.js` — current user, administrator role, members, doodle data/changelog, players summary, monthly overview, matches, manual attendance, and Supabase config.
- `js/state.js` — `State.emit('doodle-changed')`, `State.on('doodle-changed')`, and `State.addRouteBlocker`.
- `js/app.js` — registers `/doodle`.
- `css/desktop.css` — `doodle-desktop`, `dash-grid`, `span-4`, `span-8`, `stack`, and panel styles.

## Data
Monthly doodle availability is stored under `doodle_<YYYY-MM>` and shaped as:

```json
[
  { "name": "Player Name", "selectedDates": ["2026-08-11"] }
]
```

`getDoodle(year, month)` adapts it to UI entries with `selected` date maps.

Monthly changelog entries contain `playerName`, `yearMonth`, `selectedAdded`, `selectedRemoved`, and `timestamp`.

Player Overview uses monthly overview rows, match rows, and manual attendance entries. Create Tournament shortcuts pass selected names through the URL query string.

## Sub-tabs / Sections
There are no route-level sub-tabs. Sections are:

- Header — current user identity.
- My availability — month nav and personal calendar.
- Recent Changes — collapsed/expanded changelog and details dialog.
- Overall availability — open-by-default matrix with create-tournament shortcut.
- Player Overview — open-by-default monthly participation table.
- Save bar and unsaved-changes modal — dirty edit controls.

## Related Feature Docs
- `.github/features/doodle-scheduling.md` — canonical doodle scheduling rules, data schema, and edge cases.
- `.github/features/telegram-alerts.md` — Telegram relay architecture and doodle alert behavior.
- `.github/features/desktop-ui.md` — Doodle two-column desktop layout.

## Update Protocol
Update this skill whenever `js/pages/doodle.js` scheduling logic, desktop sections, alerts, data shape, dirty-state handling, or routing changes, or when the linked feature MDs change.
