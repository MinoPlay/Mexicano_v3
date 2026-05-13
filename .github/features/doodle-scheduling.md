# Doodle Scheduling

## Logic Flow
1. **User selects month** → navigate calendar with prev/next buttons
2. **System fetches valid dates** → `getAllDatesInMonth()` finds all Tuesdays/Thursdays in month
3. **Player toggles dates** → click playable dates (not past, not non-Tue/Thu) to select/deselect availability
4. **saveDoodle() persists** → validates dates in month, updates Store, computes date diff (`selectedAdded`/`selectedRemoved`), writes to GitHub JSON via `writeDoodle()`, emits `doodle-changed` event
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

### Store changelog structure
```
doodle_changelog[yearMonth] = [
  {
    playerName: string,
    yearMonth: "2025-04",
    year: 2025,
    month: 4,
    selectedAdded: ["2025-04-01", ...],
    selectedRemoved: ["2025-04-03", ...],
    timestamp: "2025-04-01T12:34:56.000Z"
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
- Changelog stored as: `{year}/{yearMonth}/doodle_changelog_{yearMonth}.json`
- Example: `2025/2025-04/doodle_changelog_2025-04.json`

## Core Functions
- `getAllDatesInMonth(year, month)` → array of YYYY-MM-DD strings for valid Tues/Thurs
- `getDoodle(year, month)` → array with `{ name, selected: {date→bool}, allowEdit: bool }`
- `saveDoodle(playerName, year, month, selectedDates)` → validates, updates Store, persists, emits event
- `deleteDoodle(playerName, year, month)` → removes player entry
- `logDoodleChange(playerName, year, month, selectedAdded, selectedRemoved)` → appends month changelog entry when diff exists
- `writeDoodle(year, month, entries)` → local persistence API call (no-op on deployed)

## Edge Cases
- **Date validation**: `saveDoodle()` throws if any date not in `allDates` (e.g., wrong month, wrong day-of-week)
- **Edit permission**: only player's own entry can be modified; others' entries read-only in matrix
- **Month boundaries**: Feb 28/29 handled by native `Date` API
- **No future data**: calendar only shows past/current month doodles; future months start empty
- **Past dates**: disabled in UI (read-only, grayed out), but included in matrix for reference
- **Concurrent edits**: GitHub sync via ETag; local Store updates immediately, GitHub eventual consistency
- **Diff-only entries**: no changelog entry written if player save causes no added/removed dates
- **Missing changelog file**: `pushDoodleNow()` auto-creates `doodle_changelog_YYYY-MM.json` (empty `[]` if no entries yet)

## Constraints
- **Monthly scope only** — no multi-month or seasonal doodles
- **Tues/Thurs hardcoded** — dow check `=== 2 || === 4`; no config
- **JSON keys use YYYY-MM** — Store keys, filenames, API params
- **Current user edit check** — enforced in `getDoodle()` + UI disable for readonly cells
- **Per-month changelog scope** — each month has own backend changelog file, UI reads only active month
- **Unlimited month changelog entries** — no cap trimming in service
- **Dev-server only** — `writeDoodle()` silent no-op on deployed (GitHub Pages)

## File References
- **Core**: `js/services/doodle.js` (logic, validation, events)
- **Persistence**: `js/services/local.js` → `writeDoodle()` (dev-server JSON writes)
- **GitHub sync**: `js/services/github.js` → `pushDoodleNow()`, `pullDoodleMonth()` (remote sync)
- **Store**: `js/store.js` → `getDoodle()`, `setDoodle()`, `getDoodleChangelog()`, `setDoodleChangelog()`, `getCurrentUser()`
- **UI**: `js/pages/doodle.js` (calendar grid + matrix table + changelog)
- **Events**: `js/state.js` → `doodle-changed` emitted on save

## UI Behavior
- **Calendar grid**: 7-column (Sun–Sat), clickable playable dates (Tue/Thu, not past)
- **Matrix**: player × date table, checkmarks for availability, totals row highlights best days
- **Total row**: clickable when count > 0, routes to create-tournament with available players sorted by ELO
- **Save bar**: inline bar above "Recent Changes" section appears when user has unsaved changes (date toggled). Contains "Unsaved changes" label + Cancel (ghost) + Save (primary sm) buttons. Save disabled + shows "Saving…" during async save; re-enables on failure. Hidden on successful save or cancel.
- **Changelog**: month-specific "Recent Changes" collapsible section (collapsed by default). Shows last 5 entries when collapsed, up to 20 when expanded. Toggle with click on header (▶/▼ arrow). Each row is a one-liner: player name anchored left, timestamp anchored right. Click any row opens a native `<dialog>` with full details (month, added dates, removed dates, full timestamp).
