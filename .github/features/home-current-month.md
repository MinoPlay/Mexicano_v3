# Home Page — Current Month Table

## Summary
Below the "Latest Tournament" table on the home page, a second table shows aggregated stats for **the current calendar month**.

---

## Data Source

| Source | Path |
|--------|------|
| Primary | `YYYY/YYYY-MM/players_overview.json` (same file as statistics page monthly filter) |
| Fallback | Computed on the fly from local `allMatches` filtered by `YYYY-MM` prefix |

- Fetched via `pullMonthlyOverview(yearMonth)` from `js/services/github.js`
- Previous month (`prevYearMonth`) also fetched to compute ELO delta (`eloChange`)
- Stored in `Store.getMonthlyOverview(yearMonth)`

---

## Columns

`#` · `NAME` · `W/T` · `PTS` · `AVG` · `WIN%` · `ELO` · `Δ`

Same columns as the statistics page monthly view.

---

## Behaviour

- Section title: **"Current Month"** + formatted month label (e.g. "May 2026")
- Independent sort state from the Latest Tournament table
- Shows "No data for this month" when no matches exist for current month
- Lazy-fetches from GitHub when PAT is configured; otherwise uses local match data
- If current month has no `players_overview.json` yet (month not complete), falls back to computing stats from raw match data in store

---

## File References

- **Page logic**: `js/pages/home.js` — `renderCurrentMonthTable()` function
- **Data fetch**: `js/services/github.js` — `pullMonthlyOverview()`
- **Store**: `js/store.js` — `getMonthlyOverview(yearMonth)`
