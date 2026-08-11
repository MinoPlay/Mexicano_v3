---
name: tab-logs
description: >
  Reference skill for the Logs tab (route /logs, admin-gated) of the Mexicano PWA. Covers purpose,
  admin gating rules, key files, data flow. Use when working on the git-logs page.
---

# Logs tab (admin-gated)

## Purpose
The Logs tab shows local tournament round logs and admin diagnostic errors. It is rendered by
`renderLogs(container)` from `js/pages/git-logs.js` at route `/logs`. The page is intended for
administrators who need to review recently completed round results or inspect silent failures such
as post-completion GitHub push errors.

## Rules / Logic
The bottom navigation shows the `/logs` item only when:

```js
Store.isAdministrator() && Store.isLogsEnabled()
```

This gating lives in `renderNav()` in `js/components/nav.js`. The nav item is re-rendered when the
`mexicano:user-changed` event fires, which happens when the current user, administrator list, or logs
toggle changes.

The Logs page itself does not fetch from GitHub. It calls `getRoundLog()` from
`js/services/round-log.js` and renders the returned local entries newest-first. Normal round entries
show `tournamentDate`, `roundNumber`, and each match as `team1 score1 – score2 team2`. Error entries
(`type: 'error'`) are rendered with a red left border, a warning header, `context`, timestamp, and
escaped `message`.

The header includes a `#clear-logs-btn` button. Clicking it calls `clearRoundLog()`, empties
`#round-log-list`, and updates the count text to `0 entries · localStorage only`.

`logRoundResult(tournament, roundNumber)` writes normal round entries only when both
`Store.isAdministrator()` and `Store.isLogsEnabled()` are true. `logError(context, error)` writes
diagnostic error entries for any administrator even if the logs toggle is off, so failures can be
reviewed later after enabling the tab.

## Key Files & Symbols
- `js/pages/git-logs.js` — exported render fn `renderLogs(container)`, plus `renderEntries`,
  `renderMatch`, `renderErrorEntry`, and `esc`.
- `js/components/nav.js` — gating that hides/shows the nav item via `Store.isAdministrator() &&
  Store.isLogsEnabled()`.
- `js/store.js` — `isAdministrator`, `isLogsEnabled`, `setLogsEnabled`, `setCurrentUser`,
  `setAdministrators`.
- `js/services/round-log.js` — `logRoundResult`, `logError`, `getRoundLog`, `clearRoundLog`.
- `js/app.js` — imports `renderLogs` and registers route `'/logs': renderLogs`.

## Data
Logs are stored only in browser `localStorage`, not GitHub. `js/services/round-log.js` uses the raw
storage key `mexicano_round_log` and caps the array at `MAX_ENTRIES = 200`.

Normal round entry shape:

```json
{
  "ts": "2026-05-19T21:00:00.000Z",
  "tournamentDate": "2026-05-19",
  "roundNumber": 2,
  "matches": [
    {
      "team1": ["Alice", "Bob"],
      "team2": ["Carol", "Dave"],
      "score1": 14,
      "score2": 11
    }
  ]
}
```

Error entry shape:

```json
{
  "ts": "2026-08-11T07:00:00.000Z",
  "type": "error",
  "context": "post-complete GitHub push",
  "message": "Error: HTTP 409 ..."
}
```

The logs toggle is stored through `Store` under key `logs_enabled`, which maps to localStorage key
`mexicano_logs_enabled`. In current code, `Store.isLogsEnabled()` returns `false` when no value is
stored, otherwise it returns the boolean value. `Store.setLogsEnabled(enabled)` persists the boolean
and dispatches `mexicano:user-changed`.

Administrator names are loaded into Store with `Store.setAdministrators(list)` and compared
case-insensitively against `Store.getCurrentUser()` by `Store.isAdministrator()`.

GitHub data flow is adjacent but not used by the Logs page itself: round logs are local-only, while
tournament state and completed match data are pushed through `js/services/github.js` by the
tournament lifecycle described in `.github/features/data-flow.md`. Diagnostic errors may mention
GitHub push failures, but the log records remain in localStorage.

## Sub-tabs / Sections
None. The Logs tab is a flat single-section page with a count line and one log list.

## Related Feature Docs
- `.github/features/logs-toggle.md` — describes the admin setting, nav visibility, default toggle
  behavior, and acceptance cases for log writes.
- `.github/features/tournament-round-logs.md` — defines local round log storage, normal and error
  entry shapes, max entries, UI rendering, and access control.
- `.github/features/data-flow.md` — explains the wider localStorage and GitHub data flow around
  tournament lifecycle writes and GitHub push behavior that can produce diagnostic errors.

## Update Protocol
Update this skill whenever `js/pages/git-logs.js` logic, the nav gating, data shape, or routing
changes, or when the linked feature MDs change.
