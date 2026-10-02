# Home Page — Current Month Table

## Summary
Below the "Latest Tournament" table on the home page, a second table shows aggregated stats for **the current calendar month**.

---

## Data Source

| Source | Path |
|--------|------|
| Primary | Supabase matches for the current and previous calendar months; ELO calculated at runtime from the full match history |
| Latest tournament | Supabase matches for the latest completed tournament |
| Fallback | Previously cached local matches |

- Home hydration fetches players and lightweight tournament metadata first.
- Tournament metadata must not embed historical matches; Home only needs tournament dates,
  completion state, and roster metadata.
- It then fetches the full match history (with embedded player slots). ELO and ELO change are
  calculated at runtime from all matches; stats tables and `home_matches` use only the current
  month, previous month, and latest completed tournament.
- Doodle availability and attendance records are not Home dependencies and must not be
  requested. There is no stored ELO table.
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

- At `2026-09-25`, Home with August and September tournaments => three logical PostgREST
  resources: players, tournament metadata, and all matches (no tournament filter).
- A July match plus a September match (A+B beat C+D 13-10 both times) => Home summary
  `A` has `elo 1030.56`, `previousElo 1016`, `wins 1` (wins only from relevant months);
  `monthly_2026-09` has `A elo 1030.56`, `C elo 970.84`.
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
