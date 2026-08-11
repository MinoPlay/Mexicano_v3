---
name: tab-elo-charts
description: >
  Reference skill for the ELO Charts tab (route /elo-charts) of the Mexicano PWA. Covers purpose,
  ELO computation rules, key files, data flow, chart rendering. Use when working on the elo-charts page.
---

# ELO Charts tab

## Purpose
The ELO Charts tab renders player ELO movement for the Mexicano PWA route `/elo-charts` with nav label "ELO". It gives users a combined view of the latest relevant tournament and longer-term per-player ELO history.

The page is implemented by `renderEloCharts(container, params = {})` in `js/pages/elo-charts.js`. It builds the full DOM imperatively, including header controls, player cache chips, collapsible chart sections, canvas charts, tooltips, and date-range filters.

## Rules / Logic
ELO math lives in `js/services/elo.js`: `K = 32`, initial ELO is `1000`, opponent strength is the RMS of the two opposing player ELOs, expected score is `1 / (1 + 10^((opponent_elo - player_elo) / 400))`, and results are rounded to two decimals. `processMatchElo(match, players)` ignores no data validation here and updates the four 2v2 players sequentially: team 1 players first, then team 2 players using the updated team 1 ELOs.

`renderEloCharts` uses two different ELO sources:

- Latest Tournament chart: calls `getEloHistoryForLatestTournament(allMatches, [...selectedMembers], seedElos)`. `allMatches` comes from `Store.getMatches()`. `seedElos` is built from `Store.getPlayersSummary()` using each player's `previousElo`, so Round 0 is the pre-tournament ELO from `players.json`. The service then processes only the latest tournament involving the selected players when seed ELOs are available.
- ELO History chart: loads precomputed per-player history files through `pullEloHistoryForPlayerIds(selectedIds)` and `getCachedEloHistoryForPlayerIds(selectedIds)`, then merges them with `mergePlayerHistoryFiles(files)`. The legacy single `elo_history.json` is not read by this tab.

Per-player history files have points shaped like `{ date, elo, delta }`. `mergePlayerHistoryFiles(files)` builds `{ players, dates }`, where `players` is a name-keyed map and `dates` is the sorted union of all selected player point dates.

History filters are local to the page:

- `eloHistoryForPeriod(eloData, months)` keeps points whose date is at or after the month cutoff.
- `eloHistoryForDateRange(eloData, fromStr, toStr)` keeps points in the inclusive string range.
- The UI intervals are `1m`, `3m`, `6m`, `all`, and `custom`; the default is `3m`.

Player selection is a persisted set under localStorage key `elo-charts-prefs.selected-members`. If saved selection exists, it is restored against current members. Otherwise the current user is selected when present; if not, all members are selected.

The rolling cache of quick-toggle player chips is persisted under `elo-charts-prefs.elo-cache`. `updateEloCache(cache, name)` returns a new array, ignores empty names and duplicates, and appends without eviction. `removeFromEloCache(cache, name)` returns a filtered copy. Cache chips can be active or greyed out, but stay visible until removed in remove mode.

The `+` add control opens a typeahead in the page header. `filterMemberSuggestions(allMembers, selectedMembers, query)` excludes names already in the cache, filters case-insensitively by substring, and sorts A to Z. Arrow keys move the active suggestion, Enter picks the active or first match, and Escape or blur closes the input.

Colors are based on selection entry order, not player name. `ELO_ENTRY_COLORS` defines the first 10 colors. `colorForEntryIndex(i)` returns the fixed color for indices 0-9 and a deterministic golden-angle HSL color after that. `buildEntryColorMap(orderedNames)` maps first-seen selected names to those colors. Because the map is rebuilt after selection changes, a player's color can change when its entry order changes.

`buildDatasets(history, colorMap, labelFn)` adapts history into canvas datasets shaped as `{ label, color, data }`, with each point shaped as `{ x, y, delta, label }`. `x` is the index of the point's date or round in `history.dates` or `history.rounds`; `y` is ELO.

Chart rendering is local to `js/pages/elo-charts.js`. Although `js/components/chart.js` exports generic `drawLineChart`, this page does not import it. The page's internal `drawLineChart(canvas, datasets, options)` draws the chart background, Y-grid, optional title, line paths, dots, optional delta labels, and optional X labels. Lines are always smoothed by `smooth = true`.

Delta labels are controlled separately:

- `Δᴸ` toggles Latest Tournament deltas and persists `delta-labels-tournament`.
- `Δᴴ` toggles ELO History deltas and persists `delta-labels-history`.
- History first-point delta labels are shown when the interval is not `all`.

Tooltips are installed by `setupTooltip(canvas)`. Click or touch finds the closest point within 24 pixels, shows a sticky tooltip with player label, point label, rounded ELO, and delta, and dismisses on the next document click or touch.

Empty and warning states:

- No player summary and no matches: "No ELO data yet".
- GitHub PAT exists but no player summary: route data is pulled with `pullForRoute('#/elo-charts')`.
- Latest Tournament with no datasets: chart says "No tournament data".
- Missing selected per-player files: notice says `No ELO history file for: <name>`.
- Selected history with no datasets: notice says "No ELO history data for selected player(s). Generate history in Settings." and the chart says "No ELO history data".

## Key Files & Symbols
- `js/pages/elo-charts.js` — exported `renderEloCharts(container, params = {})`; exported helpers `ELO_ENTRY_COLORS`, `colorForEntryIndex`, `buildEntryColorMap`, `updateEloCache`, `removeFromEloCache`, and `filterMemberSuggestions`; internal helpers `drawLineChart`, `drawEmptyChart`, `setupTooltip`, `buildDatasets`, `mergePlayerHistoryFiles`, `eloHistoryForPeriod`, and `eloHistoryForDateRange`.
- `js/services/elo.js` — ELO math and latest tournament history, especially `calculateCombinedOpponentElo`, `calculateExpectedScore`, `calculateClassicElo`, `processMatchElo`, and `getEloHistoryForLatestTournament`.
- `js/services/github.js` — per-player history file loading through `pullEloHistoryForPlayerIds` and `getCachedEloHistoryForPlayerIds`; files resolve to `elo_history/elo_history_{playerId}.json` under the configured backup data root.
- `js/store.js` — `Store.getMatches()`, `Store.getPlayersSummary()`, `Store.getCurrentUser()`, and `Store.getGitHubConfig()`.
- `js/services/members.js` — `getMembers()` supplies the selectable member names used by the cache chips and typeahead.
- `js/components/chart.js` — generic canvas chart helpers exist here, but the ELO Charts page currently uses its own local canvas line chart implementation instead.

## Data
The page reads matches from `Store.getMatches()` and player summaries from `Store.getPlayersSummary()`. Summary player objects are expected to expose lower-case normalized fields such as `name`, `id`, and `previousElo` after GitHub data is loaded and cached.

Selected player names are mapped to player IDs through `playerByName`, a lower-case name map built from `playersSummary`. Selected IDs are passed to GitHub history loading. Cached history payloads are merged into:

```js
{
  players: {
    [playerName]: [
      { date: 'YYYY-MM-DD', elo: 1000, delta: 0 }
    ]
  },
  dates: ['YYYY-MM-DD']
}
```

Latest tournament history from `getEloHistoryForLatestTournament` is shaped as:

```js
{
  players: {
    [playerName]: [
      { round: 0, elo: 1000, delta: 0 },
      { round: 1, elo: 1016, delta: 16 }
    ]
  },
  rounds: [0, 1]
}
```

Canvas datasets produced by `buildDatasets` are shaped as:

```js
{
  label: playerName,
  color: colorMap[playerName],
  data: [
    { x: 0, y: 1000, delta: 0, label: 'Round 0' }
  ]
}
```

Preferences are stored in raw localStorage under `elo-charts-prefs`, not through `Store`. Keys include `selected-members`, `elo-cache`, `interval`, `custom-from`, `custom-to`, `delta-labels-tournament`, `delta-labels-history`, `tournament-collapsed`, and `history-collapsed`.

## Sub-tabs / Sections
The page is flat; it has no nested route sub-tabs. It contains:

- Header: title "ELO Charts", `Δᴸ` and `Δᴴ` delta toggles, `+` add player button, and `−` / `✓` remove-mode button.
- Player cache row: wrapping cache chips that toggle selected players or remove cached players in remove mode.
- Latest Tournament section: collapsible canvas chart with date metadata and Round 0 through tournament rounds.
- ELO History section: collapsible canvas chart with interval buttons, optional custom date inputs, history notices, and per-player history lines.

## Related Feature Docs
- `.github/features/elo-rating-system.md` — defines the ELO math contract, latest-tournament live recomputation behavior, Round 0 seed meaning, and the service symbols that feed this tab.
- `.github/features/per-player-elo-history.md` — defines per-player history file storage, the ELO tab read flow, cache chip behavior, colors, add/remove controls, missing-file behavior, and the rule that legacy `elo_history.json` is not used.

## Update Protocol
Update this skill whenever js/pages/elo-charts.js ELO calculation, chart rendering, filters, data shape, or routing changes, or when the linked feature MDs change.
