---
name: tab-players
description: >
  Reference skill for the Players routes (/players and /players/compare) of the Mexicano PWA.
  Covers the desktop player hub master-detail view, compare page, data flow, and key symbols.
  Use when working on the players page or player compare page.
---

# Players tab

## Purpose
The Players area has two routes:

- `#/players` — player hub master-detail view rendered by `renderPlayers` in `js/pages/players.js`.
- `#/players/compare` — player comparison view rendered by `renderPlayerCompare` in `js/pages/player-compare.js`.

Both routes are desktop-focused and require full match history. The Supabase route scope maps `/players` and `/players/compare` to `loadSnapshot` through `routeScope(hash)`.

## Rules / Logic
Players hub:

- `renderPlayers(container, params = {})` renders a `split-view` with a left `split-master` grid and right `split-detail` profile.
- If no matches are loaded, it shows `Loading full match history…` when Supabase is configured, otherwise `No match data`.
- Rows come from `buildPlayerRows(matches)` and are ranked by ELO.
- `PLAYER_COLUMNS` defines rank, player, ELO, Δ10, sparkline trend, games, win rate, average points, tournaments, firsts, podiums, attendance, form, and last played.
- The grid is built with `createDataGrid()` using search by name, default ELO descending sort, multi-select checkboxes, and optional Members only toolbar.
- The master/detail split constrains both columns to the viewport and stacks below 1100px. Dense
  grids, including Recent matches, scroll horizontally inside their own panels rather than
  widening the page. Grid toolbars wrap when controls no longer fit on one row.
- Members only defaults on when `Store.getMembers()` has members. This roster contains only Supabase
  players with `active = true`; inactive historical players remain available in match history but
  are hidden while the toggle is checked. Toggling it calls `grid.setRows(visible())`.
- Row clicks select a player, call `grid.setSelected(name)`, update URL query `?p=` with `history.replaceState`, and render the right detail panel.
- The current user is selected by default when present; otherwise the first visible row is selected.
- Checking two or more rows reveals the Compare button and links to `#/players/compare?p=a,b`.

Player detail:

- `renderDetail(el, name, matches, row, onPlayer)` calls `buildPlayerDetail(name, matches)`.
- The hero shows rank, last played, and a Compare link seeded with the current player.
- KPI cards show ELO, peak ELO, win rate, average points, tournaments, podiums, and win types.
- Picks show best partner, worst partner, nemesis, and favourite victim.
- `createLineChart()` renders ELO history.
- Four nested `createDataGrid()` tables show Partners, Opponents, Tournaments, and Recent matches.
- Clicks on `[data-player]` inside detail select that player in the hub.

Compare:

- `renderPlayerCompare(container, params = {})` parses names from `params.p` using `parseCompareNames()`.
- The header has an Add player input backed by a datalist of all player rows and a link back to `#/players`.
- No matches shows the same loading/no-data state as Players. No valid names shows "Add players to compare".
- KPI rows compare ELO, Δ last 10, games, win %, average points, tournaments, wins, podiums, attendance, and form.
- Best numeric values are highlighted for `max` KPI rows when comparing more than one player.
- `alignEloSeries(histories)` aligns per-player ELO histories to a shared date axis, carrying values forward after the first point.
- `createLineChart()` renders the overlaid ELO chart.
- Pairwise head-to-head rows use `buildHeadToHead(a, b, matches)` and show against and together records.

## Key Files & Symbols
- `js/pages/players.js` — exports `renderPlayers`, `PLAYER_COLUMNS`, `formatShortDate`, and `formStripHtml`; local helpers `setUrlParam`, `kpi`, `pick`, and `renderDetail`.
- `js/pages/player-compare.js` — exports `renderPlayerCompare`, `parseCompareNames`, and `alignEloSeries`; local `KPI_ROWS`.
- `js/services/player-insights.js` — `buildPlayerRows`, `buildPlayerDetail`, `buildHeadToHead`, `buildPairMatrix`, `eloMovers`, and `buildTournamentRows`.
- `js/components/data-grid.js` — `createDataGrid`, `sortRows`, `filterRows`, and `nextSortState`.
- `js/components/chart.js` — `createLineChart`, `sparklineSvg`, and `paletteColor`.
- `js/services/supabase.js` — `routeScope(hash)` maps `/players` and `/players/compare` to `{ key: 'full', load: loadSnapshot }`.
- `js/store.js` — `Store.getMatches`, `Store.getMembers`, `Store.getCurrentUser`, and `Store.getSupabaseConfig`.
- `js/app.js` — registers `/players` and `/players/compare`, and names them Players/Compare.
- `js/components/nav.js` — desktop side nav includes `/players`.
- `css/desktop.css` — responsive `split-view`, `split-master`, `split-detail`, internally scrolling
  `data-grid`, wrapping toolbars, `line-chart`, `player-hero`, `player-picks`, `two-col`, and compare
  grid layout.

## Data
Both routes operate over full flattened match history. Full hydration loads all player rows so
inactive historical player IDs still resolve to names, but only active player names populate the
members roster. Incomplete 0-0 matches are ignored by `buildPlayerRows()` and `buildPlayerDetail()`
through `player-insights.js`.

Player row fields include:

```js
{
  rank,
  name,
  elo,
  eloDelta,
  spark,
  games,
  winRate,
  avgPoints,
  tournaments,
  firsts,
  podiums,
  attendance,
  form,
  lastPlayed
}
```

Player detail data includes summary totals, ELO history, partner/opponent stats, best/worst picks, tournament placements, and recent matches.

Compare route query uses comma-separated encoded names: `#/players/compare?p=Name%201,Name%202`.

## Sub-tabs / Sections
Players has no sub-tabs. Sections are:

- Players hub header — title and conditional Compare button.
- Master grid — searchable/sortable player table with multi-select checkboxes and Members only toggle.
- Detail panel — KPIs, picks, ELO chart, partners, opponents, tournaments, and recent matches.
- Compare page — KPI comparison table, overlaid ELO history chart, and pairwise head-to-head table.

## Related Feature Docs
- `.github/features/desktop-ui.md` — Players hub, compare route, shared data grid, chart helpers, and desktop full-history route scope.

## Update Protocol
Update this skill whenever `js/pages/players.js`, `js/pages/player-compare.js`, `js/services/player-insights.js`, shared data-grid/chart behavior, route scope, player data shape, or desktop layout changes, or when the linked feature MD changes.
