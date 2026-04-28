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

## File References

- **Page logic**: `js/pages/statistics.js` — `renderTable()` function
- **Data fetch**: `js/services/github.js` — `pullCoreData()`, `pullMonthlyOverview()`
- **Store**: `js/store.js` — `getPlayersSummary()`, `getMonthlyOverview(yearMonth)`
