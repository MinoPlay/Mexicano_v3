# Statistics Page — Data Sources

The Statistics page (`/statistics`) shows player performance tables filtered by time period.
Each filter uses a different pre-computed data source.

---

## Filter → Data Source Mapping

| Filter | Source file | Store key | Notes |
|--------|------------|-----------|-------|
| **All Time** | `players.json` | `players_summary` | Authoritative all-time stats; generated after every tournament |
| **Monthly** (pick month) | `YYYY/YYYY-MM/players_overview.json` | `monthly_YYYY-MM` | Stats for players active that month; lazy-fetched on demand |
| **Latest** / **per-date** | `YYYY/YYYY-MM/YYYY-MM-DD.json` | in-memory `allMatches` | Computed on the fly from raw match data for that day |

---

## All Time — Canonical Source

**`players.json` is the only source for All Time stats.** It is always used directly.

- **Never** aggregates monthly `players_overview.json` files for All Time
- `players.json` is updated automatically after every `completeTournament()` and via the Settings → "Generate players.json" button
- Contains: `[{ Name, ELO, PreviousELO, Wins, Losses, TotalPoints, Average, Tournaments }]`
- Stored in `Store` as `players_summary` (camelCase: `{ name, elo, previousElo, wins, losses, points, average, tournaments }`)

**Fallback** (local-only / no GitHub backend): if `players.json` is not loaded, stats are computed on the fly from `allMatches` in localStorage. This only occurs when there is no GitHub backend configured.

---

## Monthly — `players_overview.json`

Each monthly file contains stats only for players who were active during that month:
- Contains: `[{ Name, Total_Points, Wins, Losses, Average, ELO }]`
- Lazy-fetched from GitHub the first time a month is selected
- ELO delta shown as change vs. the previous month's ELO

---

## Per-Date — Match Day Files

When a specific date is selected from the "Pick date…" dropdown:
- Reads `YYYY/YYYY-MM/YYYY-MM-DD.json` (lazy-fetched if not cached)
- Stats computed from raw match data for that single day

---

## Filter Persistence

Active filter is saved to `localStorage` under key `stats_active_filter`.
Restored on page load. Falls back to `'latest'` if not set.

---



- Default sorting for all statistics filters (**All Time**, **Latest**, **Monthly**, and specific **date**) is:
  1. `AVG` descending
  2. `Wins` descending (tie-break)
  3. `Name` ascending (final tie-break)

---

## File References

- **Page logic**: `js/pages/statistics.js` — `renderTable()` function
- **Data fetch**: `js/services/github.js` — `pullCoreData()`, `pullMonthlyOverview()`
- **Store**: `js/store.js` — `getPlayersSummary()`, `getMonthlyOverview(yearMonth)`

---

## Sub-Feature: Attendance Bar Chart + Table

### Overview
A new section appended inside `content` div (after `tableContainer`) in `renderStatistics()`.
Two collapsible elements: a **bar chart** (canvas) and a **table** (Name / Attendance columns).
Both share one filter row (separate from the existing stats filter bar).

### Filters
| Filter label | Semantic |
|---|---|
| **Latest** | Current month only (`YYYY-MM` of `new Date()`) |
| **30** | Last 30 days ending today (cutoff = today − 30 days) |
| **60** | Last 60 days |
| **90** | Last 90 days |
| **120** | Last 120 days |

Filter value persisted at `localStorage` key `stats_attendance_filter` (plain `localStorage.setItem/getItem`, same pattern as `stats_active_filter`).

### Data Source
- **File**: `YYYY/YYYY-MM/players_overview.json`
- **Fetch function**: `pullMonthlyOverview(yearMonth)` exported from `js/services/github.js`
- **Cache key**: `monthly_YYYY-MM` (in-memory `Cache`)
- **Feed `computeAttendance` the RAW overview arrays** (`[{Name, ELO:[{Date,ELO}], ...}]`), keyed by `YYYY-MM`.

#### ⚠️ Do NOT use `Store.getMonthlyOverview()` as the attendance source
`Store.getMonthlyOverview()` runs `fromOverview()` (github.js:905), which reduces `p.ELO`
(array of `{Date,ELO}`) to a single final `elo` number — the per-date entries are gone.
`computeAttendance` needs those `Date` strings.

**Approach**: the UI must read the raw `players_overview.json` arrays (with full ELO arrays
intact) and pass them straight to `computeAttendance`. No change to `fromOverview` / `Store` is
required.

### Month Enumeration Logic (`getMonthsForAttendanceFilter`)
```
"latest"  → [ currentYearMonth ]
"30"      → all YYYY-MM from month(today-30d) to currentYearMonth inclusive
"60"      → all YYYY-MM from month(today-60d) to currentYearMonth inclusive
"90"      → all YYYY-MM from month(today-90d) to currentYearMonth inclusive
"120"     → all YYYY-MM from month(today-120d) to currentYearMonth inclusive
```
Months enumerated by decrementing from current month until cutoff month is reached.

### Attendance Computation (`computeAttendance`)
- Input: raw `players_overview.json` arrays keyed by YYYY-MM, filter string, today as `Date`
- For each player in each month's file, count ELO-array entries whose `Date` string falls within the window
- Combine (sum) counts per player `Name` across all months
- Exclude players with final attendance === 0
- Sort: attendance descending, then name ascending (tie-break)

### New Pure Functions (add to `js/services/statistics.js`)
| Function | Signature |
|---|---|
| `getMonthsForAttendanceFilter(filter, today)` | `(string, Date) → string[]` YYYY-MM array |
| `computeAttendance(monthlyRawByMonth, filter, today)` | `(Object, string, Date) → {name,attendance}[]` |

`monthlyRawByMonth` shape: `{ [yearMonth: string]: Array<{Name:string, ELO:Array<{Date:string,ELO:number}>|number, ...}> }`

### Collapsible Sections — localStorage Keys
Stored in a single prefs blob (same pattern as `elo-charts-prefs`):
- **Key**: `stats-attendance-prefs`
- **Fields**: `{ 'chart-collapsed': boolean, 'table-collapsed': boolean }`
- Collapse toggled via chevron (▼/▶), written on each toggle.

### DOM Structure (inside `content`)
```
content
  filterBar           ← existing
  tableContainer      ← existing
  attendanceSection   ← NEW
    attendanceFilterBar  (chip buttons: Latest / 30 / 60 / 90 / 120)
    chartWrap (collapsible, storageKey 'attendance-chart')
      header + chevron "Attendance"
      canvas.chart-canvas  (bar chart, vanilla Canvas, height ~240px)
    tableWrap (collapsible, storageKey 'attendance-table')
      header + chevron "Attendance Table"
      data-table > table (thead: Name | Attendance; tbody rows)
```

### Charting
No external library. Build a vanilla Canvas bar chart following the same Canvas patterns as `drawLineChart` in `js/components/chart.js`:
- DPR scaling, padding, grid lines
- X axis: player names (rotated labels if needed)
- Y axis: attendance count (integer ticks)
- One bar per player, color from `generateChartColors(count)` (exported from `js/components/chart.js`)

### "Current date" source
No global clock helper in codebase. Use `new Date()` directly (same as `pullCoreData` in github.js:983).
