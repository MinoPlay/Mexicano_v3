# Doodle Scheduling

## Logic Flow
1. **User selects month** → navigate calendar with prev/next buttons
2. **System fetches valid dates** → `getAllDatesInMonth()` finds all Tuesdays/Thursdays in month
3. **Player toggles dates** → click playable dates (not past, not non-Tue/Thu) to stage availability changes. Members edit only themselves; admins can edit any player's row in Overall availability.
4. **Save applies changed players only** → re-pull the latest month, then call `saveDoodle()` only for players whose staged selections differ from the original snapshot. It validates dates, updates Store, computes date diffs (`selectedAdded`/`selectedRemoved`), and emits `doodle-changed`. Untouched players retain the latest remote selections.
5. **Supabase sync** → `pushDoodleNow()` sends one `save_doodle` mutation with the changed players and their new changelog entries. Telegram alerts fire per changed player only after persistence succeeds. `pullDoodleMonth()` loads the latest month on page load.

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
- `allowEdit = true` if `Store.isAdministrator()` or `entry.name === currentUser`

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
- **Edit permission**: members can modify only their own entry; admins can modify every player's future selections in the matrix. Supabase enforces the same role distinction.
- **Empty selections**: admins also see every roster member and existing doodle entry, even with no future selections. Removing a player's last selection keeps the row visible.
- **Cancel**: discard all staged player changes, including selections for players without a saved doodle entry.
- **Month boundaries**: Feb 28/29 handled by native `Date` API
- **No future data**: calendar only shows past/current month doodles; future months start empty
- **Past dates**: disabled in UI (read-only, grayed out), but included in matrix for reference
- **Concurrent edits**: re-pull Supabase before saving and apply only locally changed players; do not replay untouched players' stale snapshots
- **Diff-only entries**: no changelog entry written if player save causes no added/removed dates
- **No changelog history**: new changelog entries are appended through the Supabase mutation; no existing changelog file is required

## Constraints
- **Monthly scope only** — no multi-month or seasonal doodles
- **Tues/Thurs hardcoded** — dow check `=== 2 || === 4`; no config
- **JSON keys use YYYY-MM** — Store keys, filenames, API params
- **Role-aware edit check** — `getDoodle()` and matrix cells allow the current user or an admin; past dates remain read-only
- **Per-month changelog scope** — Supabase changelog entries are scoped by `year_month`; UI reads only the active month
- **Unlimited month changelog entries** — no cap trimming in service
- **Dev-server only** — `writeDoodle()` silent no-op on deployed (GitHub Pages)

## File References
- **Core**: `js/services/doodle.js` (logic, validation, events)
- **Persistence**: `js/services/local.js` → `writeDoodle()` (dev-server JSON writes)
- **Supabase sync**: `js/services/backend.js` → `pushDoodleNow()`, `pullDoodleMonth()` (remote sync)
- **Store**: `js/store.js` → `getDoodle()`, `setDoodle()`, `getDoodleChangelog()`, `setDoodleChangelog()`, `getCurrentUser()`
- **UI**: `js/pages/doodle.js` (calendar grid + matrix table + changelog)
- **Events**: `js/state.js` → `doodle-changed` emitted on save

## UI Behavior
- **Calendar grid**: 7-column (Sun–Sat), clickable playable dates (Tue/Thu, not past)
- **Matrix**: player × date table, checkmarks for availability, totals row highlights best days. Admins see all roster members plus existing doodle players and can toggle any future cell; members retain the current-user/players-with-future-availability view. Staged admin edits immediately update checkmarks, pending styling, and totals. My availability remains the logged-in user's calendar.
- **Total row**: clickable when count > 0, routes to create-tournament with available players sorted by ELO
- **Save bar**: fixed top banner (non-blocking, `position:fixed;top:0`) appears when dirty. Appended to `document.body`. Contains "Unsaved changes" label + Cancel (ghost) + Save (primary sm). User can still toggle dates freely while bar is visible. Save disabled + "Saving…" during async save. Hidden on success or cancel. Removed from DOM on page unload.
- **Changelog**: month-specific "Recent Changes" collapsible section (collapsed by default). Shows last 5 entries when collapsed, up to 20 when expanded. Toggle with click on header (▶/▼ arrow). Each row is a one-liner: player name anchored left, timestamp anchored right. Click any row opens a native `<dialog>` with full details (month, added dates, removed dates, full timestamp).
- **Player Overview**: collapsible `<details>` section below "Overall availability". Shows actual tournament participation for the current month. Players sourced from `Store.getMonthlyOverview(ym)` (players_overview.json), unioned with participants of match + **manual attendance** dates; falls back to participants when no overview. Participation (columns + played count) built by `buildMonthParticipation(matches, Store.getManualAttendance(), ym)` — merges `Store.getMatches()` with manual (no-tournament) attendance entries for the month. ✓ where player actually played. ID column shows `MatchPadelId` from players_summary; for `MatchPadelId === 0` players the ID cell shows `playedCount × 90kr` cost instead (manual dates count toward played + cost). 💰 emoji shown inline next to name for players without a MatchPadel account. Date columns collapsible via "◀/▶ Dates" toggle button (`.dates-hidden` CSS class).

## Admin Editing Acceptance Pairs
- Admin Alice, Bob selected `2026-11-12`, click Bob's `2026-11-12` cell => Bob stays visible with an unselected pending cell; Save persists Bob with `selectedDates: []`, logs the removal, and alerts for Bob rather than Alice.
- Admin Alice, roster member Charlie has no doodle entry, click Charlie's `2026-11-19` cell => Charlie has exactly one selected pending cell; Save creates Charlie's selection.
- Admin Alice stages changes for Bob and Charlie, then Cancel => original checkmarks and totals return, no pending cells or save bar remain, and no remote write occurs.
- Member Alice clicks Bob's `2026-11-12` cell => no change; Alice's own future cells remain editable. An expired admin grant behaves as a member.
- Today `2026-11-11`, admin clicks calendar days 10 (past Tuesday) or 11 (Wednesday) => no staged changes.
- Alice edits Bob and Charlie while Diana's remote selection changes from `2026-11-12` to `2026-11-24` => Save sends only Bob and Charlie; Diana keeps `["2026-11-24"]` and receives no changelog entry or alert from Alice's save.
