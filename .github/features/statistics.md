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

---

## Sub-Feature: Sortable Column Headers in Player Profile Tables

### Scope
Player profile modal dialog (opened by clicking player name in Statistics page) displays two tabs with data tables:
- **Head-to-Head**: opponent match records
- **Partners**: partnership statistics

**Feature**: Make column headers clickable to sort table data (ascending/descending toggle).

### Current Behavior
Both tables render in static sort order (by `gamesPlayed` descending only). Column headers are plain `<th>` elements with no click handlers or sort indicators.

### Files Involved
- **Render logic**: `js/components/player-profile.js` lines 57–106 (opponent + partner table generation)
- **Data source**: `js/services/statistics.js` exports `calculateOpponentStats()` (lines 117–146) and `calculatePartnershipStats()` (lines 148–178)

### Data Columns

#### Head-to-Head Table
| Column | Key | Data Type | Source |
|--------|-----|-----------|--------|
| Opponent | `opponentName` | string | opponent name |
| Games | `gamesPlayed` | number | total games vs. this opponent |
| W | `wins` | number | wins against this opponent |
| L | `losses` | number | losses against this opponent |
| Win% | `winRate` | number | `Math.round((wins / gamesPlayed) * 100 * 100) / 100` (0–100) |

#### Partners Table
| Column | Key | Data Type | Source |
|--------|-----|-----------|--------|
| Partner | `partnerName` | string | partner name |
| Games | `gamesPlayed` | number | total games with this partner |
| W | `wins` | number | wins with this partner |
| L | `losses` | number | losses with this partner |
| Avg Pts | `averagePointsPerGame` | number | `Math.round((totalPoints / gamesPlayed) * 100) / 100` |

### Acceptance Criteria

#### Head-to-Head Table Sorting

**Input**: Player profile for "Alice" with opponent data
```
Opponent: "Bob",    Games: 8,  W: 5, L: 3, Win%: 62.5
Opponent: "Charlie", Games: 12, W: 7, L: 5, Win%: 58.3
Opponent: "Diana",   Games: 6,  W: 3, L: 3, Win%: 50.0
```

**When user clicks "Opponent" header (first time)**
- **Expected**: Table sorted ascending by opponent name (A→Z)
  - Row 1: Bob, 8, 5, 3, 62.5%
  - Row 2: Charlie, 12, 7, 5, 58.3%
  - Row 3: Diana, 6, 3, 3, 50.0%
- **Visual**: Header shows "▲ Opponent" or similar ascending indicator

**When user clicks "Opponent" header (second time)**
- **Expected**: Table sorted descending by opponent name (Z→A)
  - Row 1: Diana, 6, 3, 3, 50.0%
  - Row 2: Charlie, 12, 7, 5, 58.3%
  - Row 3: Bob, 8, 5, 3, 62.5%
- **Visual**: Header shows "▼ Opponent"

**When user clicks "Games" header (first time)**
- **Expected**: Table sorted ascending by gamesPlayed (0→∞)
  - Row 1: Diana, 6, 3, 3, 50.0%
  - Row 2: Bob, 8, 5, 3, 62.5%
  - Row 3: Charlie, 12, 7, 5, 58.3%
- **Visual**: "Games" header shows ascending indicator; "Opponent" indicator cleared

**When user clicks "Win%" header (first time)**
- **Expected**: Table sorted ascending by winRate (0→100%)
  - Row 1: Diana, 6, 3, 3, 50.0%
  - Row 2: Charlie, 12, 7, 5, 58.3%
  - Row 3: Bob, 8, 5, 3, 62.5%
- **Visual**: "Win%" header shows ascending indicator

**When user clicks "Win%" header (second time)**
- **Expected**: Table sorted descending by winRate (100%→0%)
  - Row 1: Bob, 8, 5, 3, 62.5%
  - Row 2: Charlie, 12, 7, 5, 58.3%
  - Row 3: Diana, 6, 3, 3, 50.0%
- **Visual**: "Win%" header shows descending indicator

#### Partners Table Sorting

**Input**: Player profile for "Alice" with partnership data
```
Partner: "Eve",   Games: 10, W: 8, L: 2, Avg Pts: 14.3
Partner: "Frank", Games: 5,  W: 3, L: 2, Avg Pts: 12.8
Partner: "Grace", Games: 7,  W: 4, L: 3, Avg Pts: 13.5
```

**When user clicks "Partner" header (first time)**
- **Expected**: Table sorted ascending by partner name (A→Z)
  - Row 1: Eve, 10, 8, 2, 14.3
  - Row 2: Frank, 5, 3, 2, 12.8
  - Row 3: Grace, 7, 4, 3, 13.5
- **Visual**: Header shows ascending indicator

**When user clicks "Games" header (first time)**
- **Expected**: Table sorted ascending by gamesPlayed (0→∞)
  - Row 1: Frank, 5, 3, 2, 12.8
  - Row 2: Grace, 7, 4, 3, 13.5
  - Row 3: Eve, 10, 8, 2, 14.3
- **Visual**: "Games" header shows ascending indicator

**When user clicks "Avg Pts" header (first time)**
- **Expected**: Table sorted ascending by averagePointsPerGame (0→∞)
  - Row 1: Frank, 5, 3, 2, 12.8
  - Row 2: Grace, 7, 4, 3, 13.5
  - Row 3: Eve, 10, 8, 2, 14.3
- **Visual**: "Avg Pts" header shows ascending indicator

**When user clicks "Avg Pts" header (second time)**
- **Expected**: Table sorted descending by averagePointsPerGame (∞→0)
  - Row 1: Eve, 10, 8, 2, 14.3
  - Row 2: Grace, 7, 4, 3, 13.5
  - Row 3: Frank, 5, 3, 2, 12.8
- **Visual**: "Avg Pts" header shows descending indicator

#### Default Sort Behavior

**When player profile dialog first opens**
- **Expected**: Both tables use **current default** (Games descending; no indicator visible)
  - Or after implementation: sort state may reset to column 1 (Opponent/Partner) ascending with visual indicator

**When user navigates between tabs (Overview → Head-to-Head → Partners → back)**
- **Expected**: Sort state persists during session (no reset on tab switch)
- **Expected**: Sort state does NOT persist across profile re-open (fresh load = default sort)
