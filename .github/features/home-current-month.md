# Home Page — Current Month Table

## Summary
The home page shows Latest Tournament and Current Month tables side by side, with each table's ELO movers directly below it. On narrow screens the two table-and-movers pairs stack.

---

## Data Source

| Source | Path |
|--------|------|
| Primary | Supabase `player_monthly_summary` for the current and previous calendar months, including month-start ELO |
| Latest tournament | Supabase matches for the latest completed tournament |
| Fallback | Previously cached local matches |

- Home hydration fetches players, tournament metadata, active tournament and the monthly summaries, then the latest completed tournament's matches and ELO.
- If precomputed summaries are unavailable, Home loads matches and ELO for the current and previous months and latest tournament. See `route-data-loading.md`.
- Doodle availability and attendance records are not Home dependencies.
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
- **"ELO movers — latest tournament"** sits directly below Latest Tournament, and **"ELO movers — current month"** sits directly below Current Month. Both use the same bars, ordering, rounded deltas, ratings and ELO charts link.
- The Home dashboard does not show an Explore container.
- Monthly movers use each player's change from their ELO before their first tournament this month to their latest ELO this month, even if they did not play last month. Unknown changes are omitted; if none are known, show "No ELO data". Never treat a latest-tournament delta as a monthly delta.
- Refresh the monthly movers when a pending monthly overview finishes loading; an older render must not overwrite a newer render.

## Acceptance

- Home layout => Latest Tournament followed by its ELO movers, alongside Current Month followed by its ELO movers; no Explore container.
- Month overview `Ann: elo 1030, previousElo 1000`, `Bob: elo 980, previousElo 1000` => movers `Ann +30.0 1030`, then `Bob -20.0 980`, regardless of last month's participation.
- Empty overview or unknown month-start ratings => "No ELO data".
- A delayed overview update => monthly movers render the freshly loaded month values.
- Home refresh => zero doodle-availability or attendance-record requests.
- Re-rendering Home after route hydration => no second PostgREST batch.

---

## File References

- **Page logic**: `js/pages/home.js` — `renderCurrentMonthTable()` function
- **Data fetch**: `js/services/supabase.js` — Home route hydration and month-start ELO through `pullForRoute('#/')`
- **Store**: `js/store.js` — `getMonthlyOverview(yearMonth)`
