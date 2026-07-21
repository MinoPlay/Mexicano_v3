# Manual (No-Tournament) Attendance

Record attendance for a day that has **no tournament**. Manual entries affect ONLY:
- **Stats → Attendance** (Statistics page chart + table).
- **/attendance** page (calendar + statistics table).
- **Doodle → Player Overview** (player list + "Played" count + 90kr cost).

They do NOT touch ELO, tournaments, Home, ELO charts, or the Statistics leaderboard.

## Data
- Single global synced file: `data/attendance_manual.json`.
- Store key: `attendance_manual`.
- Shape: `[{ "date": "YYYY-MM-DD", "players": ["Name", ...], "note": "" }]` (sorted by date, one entry per date, players deduped + sorted).
- Sync: reuses the `SYNCED_DATA_KEYS` allowlist → `keyToPath` → `schedulePush`/`executePush`.
  Read once at `pullCoreData` (step 2b). App-writable (unlike `players_overview.json`).

## Why not just edit `players_overview.json`?
- The app is **read-only** for `players_overview.json`: it is Python-generated and
  re-pulled fresh on every load (`pullMonthlyOverviewRaw`) — edits get overwritten.
- Doodle "Played" count comes from `Store.getMatches()`, not the overview, so an
  overview edit would list the player but not add a played date.

## Store helpers (`js/store.js`)
- `Store.getManualAttendance()` → array (default `[]`).
- `Store.setManualAttendance(entries)` → persists + schedules GitHub push.

## Service (`js/services/attendance.js`)
- `buildMonthParticipation(matches, manualEntries, yearMonth)` → `{ datePlayerMap, tournamentDates }`.
  Shared by the doodle Player Overview and the attendance calendar.
- `upsertManualEntry(entries, { date, players }, tournamentDates)` → validated, pure insert/replace.
  Rejects tournament dates and empty player lists; dedupes + sorts.
- `getMonthlyAttendance(year, month, manualEntries?)` and
  `getAttendanceStatistics(matches, cutoffDate?, manualEntries?)` merge manual dates;
  a manual date counts as a **session** (increments the Attendance% denominator).

## Stats page (`js/services/statistics.js`)
- `computeAttendance(rawByMonth, filter, today, manualEntries?)` adds each manual date's
  players (+1) within the filter window / cutoff. Page passes `Store.getManualAttendance()`.

## UI (`js/components/manual-attendance-dialog.js`)
- `showManualAttendanceDialog()` opens a modal popup. Reached via a
  **Settings → Attendance → "➕ Add Attendance"** button (Mino-only section).
- Fields: date (defaults to today), and a dynamic list of autocomplete player rows.
  Each row is a text input with a custom themed autocomplete dropdown (in-flow, no
  native `<datalist>` overlay): filters `getMembers()` as you type, keyboard-navigable
  (↑/↓/Enter/Esc). Only real member names are accepted — free text is cleared on blur.
  A name already chosen in another row disappears from the suggestions (reappears if
  that row is removed), so each player can be added only once. Row has a "−" button to
  remove and a "＋" button to add another row below.
  Save collects all non-blank inputs (dedupe handled by `upsertManualEntry`).
- Save → `upsertManualEntry(Store.getManualAttendance(), { date, players }, tournamentDates)`
  → `Store.setManualAttendance(next)` (persists + schedules GitHub push) → toast + close.
  Tournament dates and empty player lists are rejected (toast shows the error).
- No dedicated page/route and no bottom-nav entry.

## Validation
- Date must be `YYYY-MM-DD` and NOT already a tournament date (`Store.getMatches()`).
- At least one player; blanks trimmed; players deduped.
