# Doodle Scheduling

## Logic Flow
1. **User selects month** → navigate calendar with prev/next buttons
2. **System fetches valid dates** → `getAllDatesInMonth()` finds all Tuesdays/Thursdays in month
3. **Player toggles dates** → click playable dates (not past, not non-Tue/Thu) to select/deselect availability
4. **saveDoodle() persists** → validates dates in month, updates Store, writes to GitHub JSON via `writeDoodle()`, emits `doodle-changed` event
5. **GitHub sync** → `pushDoodleNow()` syncs to repo; `pullDoodleMonth()` pulls latest on page load

## Key Calculations
- **Valid dates only**: Tuesday (`dow=2`) OR Thursday (`dow=4`) only
- **Date format**: `YYYY-MM-DD` (always zero-padded, even day 1 = "01")
- **yearMonth key**: `YYYY-MM` format (e.g., "2025-04") — used as Store key + GitHub JSON filename
- **Days in month**: `new Date(year, month, 0).getDate()` (handles Feb 28/29 automatically)
- **Past date filtering**: compare `dateStr` string against `new Date().toISOString().slice(0, 10)`

## Data Schema

### Store structure
```
doodle[yearMonth] = [
  {
    name: string,                          // player name
    selectedDates: ["2025-04-01", "2025-04-03", ...]  // sorted YYYY-MM-DD strings
  },
  ...
]
```

### getDoodle() output
- Returns transformed entries with `selected` bool dict + `allowEdit` flag
- `selected` = map `date → boolean` for all valid month dates
- `allowEdit = true` only if `entry.name === currentUser`

### Local persistence path
- Stored as: `{year}/{yearMonth}/doodle_{yearMonth}.json`
- Example: `2025/2025-04/doodle_2025-04.json`

## Core Functions
- `getAllDatesInMonth(year, month)` → array of YYYY-MM-DD strings for valid Tues/Thurs
- `getDoodle(year, month)` → array with `{ name, selected: {date→bool}, allowEdit: bool }`
- `saveDoodle(playerName, year, month, selectedDates)` → validates, updates Store, persists, emits event
- `deleteDoodle(playerName, year, month)` → removes player entry
- `logDoodleChange(playerName, year, month, selectedDates)` → appends to changelog (max 20 items)
- `syncDoodleFromLocal(year, month)` → dev-server only, pulls local JSON and updates Store if changed
- `writeDoodle(year, month, entries)` → local persistence API call (no-op on deployed)

## Edge Cases
- **Date validation**: `saveDoodle()` throws if any date not in `allDates` (e.g., wrong month, wrong day-of-week)
- **Edit permission**: only player's own entry can be modified; others' entries read-only in matrix
- **Month boundaries**: Feb 28/29 handled by native `Date` API
- **No future data**: calendar only shows past/current month doodles; future months start empty
- **Past dates**: disabled in UI (read-only, grayed out), but included in matrix for reference
- **Concurrent edits**: GitHub sync via ETag; local Store updates immediately, GitHub eventual consistency

## Constraints
- **Monthly scope only** — no multi-month or seasonal doodles
- **Tues/Thurs hardcoded** — dow check `=== 2 || === 4`; no config
- **JSON keys use YYYY-MM** — Store keys, filenames, API params
- **Current user edit check** — enforced in `getDoodle()` + UI disable for readonly cells
- **Max 20 changelog entries** — older entries dropped
- **Dev-server only** — `writeDoodle()` + `syncDoodleFromLocal()` silent no-op on deployed (GitHub Pages)

## File References
- **Core**: `js/services/doodle.js` (logic, validation, events)
- **Persistence**: `js/services/local.js` → `writeDoodle()` (dev-server JSON writes)
- **GitHub sync**: `js/services/github.js` → `pushDoodleNow()`, `pullDoodleMonth()` (remote sync)
- **Store**: `js/store.js` → `getDoodle()`, `setDoodle()`, `getCurrentUser()`
- **UI**: `js/pages/doodle.js` (calendar grid + matrix table + changelog)
- **Events**: `js/state.js` → `doodle-changed` emitted on save

## UI Behavior
- **Calendar grid**: 7-column (Sun–Sat), clickable playable dates (Tue/Thu, not past)
- **Matrix**: player × date table, checkmarks for availability, totals row highlights best days
- **Total row**: clickable when count > 0, routes to create-tournament with available players sorted by ELO
- **Changelog**: last 20 changes listed with timestamp, player, selected dates
