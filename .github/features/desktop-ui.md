# Feature: Desktop UI (branch `feature/desktop-ui`)

Desktop-only redesign. Branched from `feature/supabase-refresh-optimization`.
Preview: `https://minoplay.github.io/Mexicano_v3/preview/feature-desktop-ui/`.
Mobile layout NOT supported on this branch.

## Truth
- Target viewport = the actual device width. The shell and controls must stay inside the
  viewport at every width; dense tables own their horizontal scrolling.
- Content stays fluid without growing controls beyond the compact desktop scale.
- No frameworks, no chart libs. Canvas + CSS grid only.
- Services (`js/services/*`) reused. New pure view-model logic lives in
  `js/services/player-insights.js`, `js/components/data-grid.js` (sort/filter helpers),
  `js/components/chart.js` (scale/tick/color helpers). All TDD'd.
- Desktop layer = `css/desktop.css`, loaded LAST in `index.html`. Overrides mobile rules
  (bottom nav, 480px width, bottom sheets, FAB position).

## Shell
- `#app` = CSS grid `[sidebar | main]`.
- `renderNav()` returns `<nav class="side-nav">`: brand, `.nav-item` links (icon + label),
  collapse button (`.side-nav-collapse`, state in localStorage `mexicano_sidebar_collapsed`).
  Logs item admin-gated as before.
- Page header (`.page-header`) = sticky top bar inside main column.
- Device-type (iPhone padding) setting removed from Settings UI (Store API kept, unused).

## Fluid scaling
- Viewport meta uses `width=device-width, initial-scale=1`; neither `html` nor `body` imposes a
  minimum page width.
- Root font uses a compact bounded `clamp()` scale; controls, spacing, sidebar width, paddings,
  and side-column widths remain rem/em-based without becoming oversized on wide screens.
- Side columns use `minmax(<rem>, <%>)`; Players split constrains both columns to the available
  width and stacks on narrower screens. The Players table, Recent matches, and other dense tables
  scroll horizontally inside their own panel instead of widening the page.
- Toolbars and panel actions wrap when their controls no longer fit on one row.
- Heatmaps `width:100%` — cells stretch to fill panel; header labels not truncated.
- Canvas text/padding via `fontPx(n)` (`chart.js`) = `round(n · max(1, rootFontPx/14))`;
  chart heights set in rem.
- <1400px: dash-grid span-4/5/7/8 panels go full width.

## Layout primitives (desktop.css)
- `.dash-grid` — 12-col grid. `.span-3|4|5|6|7|8|12` children.
- `.panel` — card with `.panel-header` (title + actions) and `.panel-body`.
- `.split-view` — master (left, scroll) / detail (right, sticky) two-pane.
- `.kpi-row` / `.kpi` — row of big-number tiles.
- `.data-grid` — dense table, sticky thead, sortable headers, zebra, hover row, selected row.
- `.heatmap` — matrix table, cell background by value.

## Components
### data-grid (`js/components/data-grid.js`)
- `sortRows(rows, key, dir)` — numbers numeric, strings `localeCompare`,
  `null/undefined/NaN` ALWAYS last regardless of dir. Stable.
- `filterRows(rows, query, keys)` — case-insensitive substring on any of `keys`; empty query → all.
- `nextSortState({key, dir}, clickedKey, defaultDir)` — same key toggles dir; new key → `defaultDir`
  (column's `defaultDir`, else `'desc'`, `'asc'` for string columns).
- `createDataGrid({ columns, rows, sort, search, onRowClick, selectedKey, rowKey, multiSelect })`
  → `{ el, setRows, setSelected }`. Column: `{ key, label, type:'num'|'str', format(v,row),
  html(v,row), align, width, title, defaultDir }`.

### chart (`js/components/chart.js`)
- `niceTicks(min, max, count=5)` → ascending "nice" tick values (1/2/5 × 10^n step) covering [min,max].
- `linearScale([d0,d1],[r0,r1])` → fn; degenerate domain maps to midpoint of range.
- `heatColor(value, {min=0, mid=50, max=100})` → `rgba()` red(<mid) → transparent(mid) → green(>mid);
  `null` → `'transparent'`.
- `drawLineChart` / `drawBarChart` — existing canvas charts (unchanged; ELO charts page still uses its own).
- `createLineChart(container, { xLabels, series:[{label,color,values}], height, formatX, formatY })`
  → `{ destroy, update }`. Interactive: crosshair tooltip with all series at hovered x, clickable
  legend hides series, redraws on resize. Used by Players detail + Compare.
- `paletteColor(i)` — stable series colour by index.
- `sparklineSvg(values, {width, height, color})` → inline `<svg>` string ('' if <2 points).

## Player insights (`js/services/player-insights.js`)
Zero-zero matches (0-0) ignored everywhere (same as statistics service).
- `buildPlayerRows(matches, { recentTournaments = 10, formGames = 10, sparkPoints = 20 })` → one row per player:
  `name, elo, eloDelta (ELO change over last `recentTournaments` tournament dates played by anyone;
  player not playing in window → 0), tournaments, games, wins, losses, winRate (%, 2 dp), avgPoints (2 dp),
  firsts, podiums (top-3 finishes), lastPlayed (date), attendance (% of last `recentTournaments`
  tournament dates attended, integer), form (last `formGames` results `'W'|'L'`, oldest→newest),
  spark (last `sparkPoints` ELO values)`. Sorted by ELO desc.
- `buildPlayerDetail(name, matches, { minGames = 3, recent = 15 })` →
  `{ name, summary (generatePlayerSummary), eloHistory [{date, elo}], partners (sorted winRate desc),
  opponents (sorted winRate asc), bestPartner, worstPartner, nemesis (opp with lowest winRate),
  favoriteVictim (highest), all among entries with games ≥ minGames (else null),
  tournaments [{date, place, of, points, wins, games}] newest first,
  recentMatches [{date, round, partner, opponents[2], score, oppScore, won}] newest first }`.
- `buildPairMatrix(matches, names, mode)` — `mode` `'partner'|'opponent'`.
  `cells[a][b] = { games, wins, winRate }` from a's perspective; missing pair → `null`; diagonal `null`.
- `buildHeadToHead(a, b, matches)` → `{ against: {games, aWins, bWins}, together: {games, wins, winRate} }`.
- `buildTournamentRows(index, matches)` → tournaments index newest first, each
  `{ date, year, players, rounds, matches, totalPoints, winner, winnerPoints, runnerUp, status, isComplete }`;
  winner/runner-up from placement ranking (points desc, wins desc); no matches → `null` winner, 0 counts.
- `eloMovers(matches, { date })` → `{ date, rows:[{name, before, after, delta}] }` for tournament `date`
  (default latest), sorted delta desc.

### pair-heatmap (`js/components/pair-heatmap.js`)
- `pickActivePlayers(rows, n=20)` → names sorted attendance desc, games desc, name asc; first `n`.
- `renderPairHeatmap(panelBody)` — partner/opponent toggle + Top N select, cells coloured by `heatColor(winRate)`.
  Needs full history: when Supabase configured and matches not fully loaded shows "Load full history"
  (`pullForRoute('#/__full__')`).

## Attendance (`js/services/attendance.js`)
- `buildYearMatrix(rows, year)` → `{ years (desc), sessions[12] (distinct dates per month),
  players:[{ name, months[12], total }] }` sorted total desc; counts distinct dates per player.

## Pages
- **Home** — dashboard: KPI row, latest tournament leaderboard, current month table,
  ELO movers of latest tournament, active tournament card. Confirmation popup unchanged.
- **Players** `/players` (NEW, nav item 👥) — split view. Left: data-grid of `buildPlayerRows`
  (search, "members only" toggle, sortable, sparkline + form cells, checkbox multi-select).
  Right: inline detail from `buildPlayerDetail` (KPIs, ELO chart, partners/opponents tables,
  tournament history, recent matches). `?p=<name>` selects player. "Compare (n)" → compare route.
  Route loads the full snapshot (`/__full__` scope). The snapshot loads every player so inactive
  historical participants still resolve in match history, while `Store.getMembers()` contains only
  players whose Supabase `players.active` value is `true`. "Members only" defaults on and filters
  the historical player rows against that active roster.
- **Compare** `/players/compare?p=a,b,c` (NEW) — KPI table (players as columns), overlaid ELO line
  chart, pairwise H2H table (`buildHeadToHead`). Full snapshot.
- **Statistics** — no sub-tabs. dash-grid: statistics panel (span-7) | attendance panel (span-5),
  pair heatmap panel (span-12). Player click → `#/players?p=<name>`.
- **ELO charts** — two columns: charts (taller canvases) | side column with Members picker panel and
  Ranking panel (`renderRankingTable`, Δ = `elo − previousElo`).
- **Tournaments** — data-grid (`buildTournamentRows`): date/players/rounds/matches/points/winner/runner-up/status,
  search + year select. 1st row click previews leaderboard in side panel (380px), 2nd click / "Open" navigates.
  The year select contains All time plus the current year and two previous years, defaulting to the current year.
  Results for the selected year load automatically; changing the filter loads only that year's tournament days.
  All time loads all tournament days without loading unrelated full-snapshot data.
- **Tournament** — Matches panel | Leaderboard aside, no sub-tabs; rounds' matches in `.round-matches` grid;
  toolbar holds access-code area (hidden when empty). Leaderboard names → Players hub.
- **Create tournament** — Setup | Lineup | Member pool (chips with ELO from `getRecentMembers()`,
  click fills first empty slot / removes if selected).
- **Attendance** — no sub-tabs. Calendar (span-6, month nav in header) | Statistics (span-6),
  Year overview heatmap (span-12, `buildYearMatrix`, year select, click month → calendar month).
- **Doodle** — left span-4: My availability + changelog; right span-8: Overall availability +
  Player overview (`<details>` open by default).
- **Settings** — two-column; Device Type section removed (Store API kept).
- **Logs** — out of scope, inherits shell styling only.

## Acceptance (input => expected)
- `sortRows([{a:2},{a:null},{a:1}],'a','asc')` → a: `1,2,null`; `'desc'` → `2,1,null`.
- `filterRows([{n:'Mino'},{n:'Kikke'}],'MI',['n'])` → `[{n:'Mino'}]`.
- `nextSortState({key:'elo',dir:'desc'},'elo')` → `{key:'elo',dir:'asc'}`.
- `niceTicks(0, 100, 5)` → `[0,20,40,60,80,100]`; `niceTicks(987, 1043, 5)` → `[980,990,...,1050]` step 10.
- `heatColor(50)` → `'transparent'`; `heatColor(null)` → `'transparent'`.
- `buildPairMatrix` on one match A+B beat C+D 25-10: partner `cells.A.B = {games:1,wins:1,winRate:100}`,
  opponent `cells.A.C = {games:1,wins:1,winRate:100}`, `cells.C.A.winRate = 0`, `cells.A.A = null`.
- Fixture (6452 matches): row count = distinct player count; rows sorted by ELO desc;
  `games = wins + losses` for every row.
- `buildTournamentRows([{date:'2026-01-01',playerCount:4,roundCount:1,isComplete:true}], [A+B 15-10 C+D])`
  → one row, `matches 1`, `totalPoints 25`, `winner 'A'` (tie with B → insertion order), `status 'Complete'`.
- `buildYearMatrix` counts each date once per player; `sessions[m]` = distinct dates in month `m`.
- `pickActivePlayers([{name:'A',attendance:10,games:5},{name:'B',attendance:20,games:1}],1)` → `['B']`.
- Full Supabase hydration with active player A and inactive historical player B → match names keep
  both A and B, while `Store.getMembers()` → `['A']`.
- `index.html` viewport → `width=device-width, initial-scale=1`; desktop CSS → no fixed body
  minimum width, compact root font capped at `16px`, constrained split columns, wrapping control
  rows, and table scrollers whose tables use `width:max-content; min-width:100%`.
