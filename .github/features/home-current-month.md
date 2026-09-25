# Home Page — Current Month Table

## Summary
Below the "Latest Tournament" table on the home page, a second table shows aggregated stats for **the current calendar month**.

---

## Data Source

| Source | Path |
|--------|------|
| Primary | Date-scoped Supabase matches and ELO snapshots for the current and previous calendar months |
| Latest tournament | Supabase matches for the latest completed tournament |
| Fallback | Previously cached local matches |

- Home hydration fetches players and lightweight tournament metadata first.
- Tournament metadata must not embed historical matches; Home only needs tournament dates,
  completion state, and roster metadata.
- It then fetches match details only for the current month, previous month, and latest completed
  tournament, plus ELO snapshots for those same tournament IDs.
- Doodle availability, attendance records, and the complete historical match/ELO datasets are
  not Home dependencies and must not be requested.
- Partial Home matches and player summary live in Home-specific in-memory cache entries. They
  must not overwrite `Store.getMatches()` or masquerade as fully hydrated history for other tabs.
- Current and previous monthly projections remain available through
  `Store.getMonthlyOverview(yearMonth)`.

---

## Columns

`#` · `NAME` · `W/T` · `PTS` · `AVG` · `WIN%` · `ELO` · `Δ`

Same columns as the statistics page monthly view.

---

## Behaviour

- Section title: **"Current Month"** + formatted month label (e.g. "May 2026")
- Independent sort state from the Latest Tournament table
- Shows "No data for this month" when no matches exist for current month
- Uses route-scoped Supabase hydration when configured; otherwise uses local match data
- If the current month projection is empty, falls back to computing stats from cached raw matches

## Acceptance

- At `2026-09-25`, Home with August and September tournaments => four logical PostgREST
  resources: players, tournament metadata, relevant matches, and relevant ELO snapshots.
- The relevant match/ELO queries => tournament IDs from August, September, and the latest
  completed tournament only.
- Home refresh => zero doodle-availability or attendance-record requests.
- Re-rendering Home after route hydration => no second PostgREST batch.
- Current/previous-month page requests racing Home startup => join the Home hydration promise;
  they must not start the six-resource full-history snapshot.
- Existing full-history `Store.getMatches()` => unchanged by partial Home hydration.

---

## File References

- **Page logic**: `js/pages/home.js` — `renderCurrentMonthTable()` function
- **Data fetch**: `js/services/supabase.js` — Home route hydration through `pullForRoute('#/')`
- **Store**: `js/store.js` — `getMonthlyOverview(yearMonth)`
