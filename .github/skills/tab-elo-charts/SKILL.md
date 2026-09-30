---
name: tab-elo-charts
description: >
  Reference skill for the ELO Charts tab (route /elo-charts) of the Mexicano PWA. Covers purpose,
  ELO computation rules, key files, data flow, chart rendering, and desktop layout. Use when working on the elo-charts page.
---

# ELO Charts tab

## Purpose
The ELO Charts tab renders player ELO movement for route `/elo-charts` with nav label "ELO Charts". The desktop page has two columns: chart content on the left and a side panel on the right with the Members picker and Ranking table.

`renderEloCharts(container, params = {})` in `js/pages/elo-charts.js` builds the page imperatively, including chart sections, member cache controls, delta-label toggles, date filters, and side-panel ranking.

## Rules / Logic
ELO math lives in `js/services/elo.js`: `K = 32`, initial ELO is `1000`, expected score uses the opposing team's combined ELO, and match updates process the four players sequentially.

Layout and selection:

- `.elo-desktop` contains `.elo-main` chart column and `.elo-side` panel column.
- Selected player names are stored under localStorage `elo-charts-prefs.selected-members`.
- If no saved selection exists, the current user is selected when valid; otherwise all members are selected.
- The quick-toggle cache is stored as `elo-charts-prefs.elo-cache`.
- `renderMemberPicker()` renders cache chips into the Members panel and uses the page header slot for add/remove controls.
- `updateEloCache`, `removeFromEloCache`, and `filterMemberSuggestions` manage cache membership and typeahead.

Charts:

- Latest Tournament chart uses `getEloHistoryForLatestTournament(allMatches, [...selectedMembers], seedElos)`. Seed ELOs come from `Store.getPlayersSummary().previousElo`.
- ELO History chart loads per-player files through `pullEloHistoryForPlayerIds(selectedIds)` and `getCachedEloHistoryForPlayerIds(selectedIds)`, then merges with `mergePlayerHistoryFiles(files)`.
- History intervals are `1m`, `3m`, `6m`, `all`, and `custom`; `3m` is default. Filters call `eloHistoryForPeriod()` or `eloHistoryForDateRange()`.
- The page still uses its local `drawLineChart()` implementation for these two ELO canvases, not the shared `createLineChart`.
- `Δᴸ` and `Δᴴ` toggle delta labels for Latest Tournament and ELO History separately.
- Tooltips are installed by `setupTooltip(canvas)`.

Ranking side panel:

- `renderRankingTable(playersSummary)` builds the side-panel ranking from `Store.getPlayersSummary()`.
- Ranking rows sort by ELO descending and link names to `#/players?p=<name>`.
- The Ranking subtitle states `Δ = latest tournament`; delta is computed as `elo - previousElo`.

Empty states:

- If players summary is missing but Supabase is configured, the page calls `pullForRoute('#/elo-charts')`.
- With no player summary and no matches, it shows "No ELO data yet".
- Missing selected per-player history files show `No ELO history file for: <name>`.
- Empty selected history shows "No ELO history data for selected player(s). Generate history in Settings."

## Key Files & Symbols
- `js/pages/elo-charts.js` — exports `renderEloCharts`, `ELO_ENTRY_COLORS`, `colorForEntryIndex`, `buildEntryColorMap`, `updateEloCache`, `removeFromEloCache`, and `filterMemberSuggestions`; local helpers include `renderRankingTable`, `renderMemberPicker`, `drawLineChart`, `drawEmptyChart`, `setupTooltip`, `buildDatasets`, `mergePlayerHistoryFiles`, `eloHistoryForPeriod`, and `eloHistoryForDateRange`.
- `js/services/elo.js` — `calculateCombinedOpponentElo`, `calculateExpectedScore`, `calculateClassicElo`, `processMatchElo`, `getEloHistoryForLatestTournament`, `getEloHistoryForPeriod`, and `getEloHistoryForDateRange`.
- `js/services/backend.js` — `pullEloHistoryForPlayerIds`, `getCachedEloHistoryForPlayerIds`, and route-scoped `pullForRoute('#/elo-charts')`.
- `js/services/members.js` — `getMembers`.
- `js/store.js` — matches, players summary, current user, and Supabase config.
- `js/components/chart.js` — shared helpers exist (`createLineChart`, `paletteColor`, etc.), but this page's main canvases use local drawing.
- `js/app.js` — registers `/elo-charts`.
- `css/desktop.css` — `elo-desktop`, `elo-main`, `elo-side`, `panel`, and taller chart layout.

## Data
Route load for ELO Charts hydrates the latest completed day's matches and player summary. Per-player history is loaded separately for selected player IDs.

Player summary rows need `id`, `name`, `elo`, and `previousElo`. Per-player history files are merged into:

```js
{
  players: { [playerName]: [{ date, elo, delta }] },
  dates: ['YYYY-MM-DD']
}
```

Latest tournament history is shaped as:

```js
{
  players: { [playerName]: [{ round, elo, delta }] },
  rounds: [0, 1]
}
```

Preferences live in raw localStorage under `elo-charts-prefs`.

## Sub-tabs / Sections
There are no sub-tabs. Sections are:

- Header — title, delta toggles, add player, and remove-mode controls.
- Latest Tournament — collapsible taller canvas chart with round labels.
- ELO History — collapsible taller canvas chart with interval/custom-date controls and notices.
- Members side panel — cached player chips that toggle lines.
- Ranking side panel — ELO ranking table with latest-tournament delta.

## Related Feature Docs
- `.github/features/elo-rating-system.md` — ELO math and latest-tournament history behavior.
- `.github/features/per-player-elo-history.md` — per-player ELO history storage and selection behavior.
- `.github/features/desktop-ui.md` — two-column ELO layout and side-panel ranking.

## Update Protocol
Update this skill whenever `js/pages/elo-charts.js` layout, selection, chart rendering, filters, ranking table, data shape, or route hydration changes, or when the linked feature MDs change.
