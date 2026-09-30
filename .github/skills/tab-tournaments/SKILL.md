---
name: tab-tournaments
description: >
  Reference skill for the Tournaments list tab (route /tournaments) of the Mexicano PWA.
  Covers purpose, rules, key files, data flow, and sections. Use when working on the tournaments list page.
---

# Tournaments tab

## Purpose
The Tournaments tab renders `#/tournaments` as a desktop results browser. It shows the tournaments index in a searchable/sortable data grid, enriches rows with loaded match results, and previews a selected tournament leaderboard in a side panel. Clicking a row once previews it; clicking the same selected row again opens `#/tournament/:date`.

## Rules / Logic
`renderTournaments(container, params)` in `js/pages/tournaments.js` reads `Store.getTournamentsIndex()`, sorts entries by date descending, and builds a two-column `.tournaments-desktop` layout when entries exist.

The grid is created with `createDataGrid()` and rows from `buildTournamentRows(sorted, Store.getMatches())`. Columns are Date, Players, Rounds, Matches, Points, Winner, Runner-up, and Status. The grid has a year filter in `toolbarHtml`, text search over date/winner/runner-up, sticky grid behavior from the shared component, and default date descending sort.

`statusBadge(entry)` renders Complete, partial completion (`completedCount/matchCount`), or Pending from the original index entry. `formatDate(dateStr)` localizes visible dates.

`renderPreview(side, row)` builds a side-panel leaderboard from currently loaded matches for the selected date. It does not fetch day data itself. Player names in winner/runner-up and preview rows link to `#/players?p=<name>` while stopping row-click propagation.

When Supabase is configured and full match history is not loaded, the page header shows `#tournaments-load-results`. Clicking it imports `pullForRoute` and calls `pullForRoute('#/__full__')`, then removes the button and re-renders the grid/preview with full results.

When the local index is empty and Supabase is configured, the page shows a loading state, imports `fetchTournamentsIndexPublic()`, re-reads the index, and renders either the grid or the empty state. Without Supabase, the empty state links to Create Tournament.

The floating action button always links to `#/create-tournament`.

## Key Files & Symbols
- `js/pages/tournaments.js` — exports `renderTournaments`; local helpers `formatDate`, `statusBadge`, `renderPreview`, and nested `renderList`.
- `js/components/data-grid.js` — `createDataGrid`, `sortRows`, `filterRows`, and `nextSortState` power the desktop grid.
- `js/services/player-insights.js` — `buildTournamentRows(index, matches)` enriches index entries with winner, runner-up, points, and status fields.
- `js/store.js` — `Store.getTournamentsIndex`, `Store.getMatches`, `Store.getSupabaseConfig`, and `Store.isMatchesFullyLoaded`.
- `js/services/backend.js` — lazy imports `fetchTournamentsIndexPublic` and `pullForRoute('#/__full__')`.
- `js/app.js` — registers `/tournaments` to `renderTournaments`.
- `js/components/nav.js` — includes `/tournaments` in the desktop side nav.
- `css/desktop.css` — `tournaments-desktop`, `panel`, `tournament-side`, and shared `data-grid` styles.

## Data
The source index entry shape remains:

```js
{
  date: 'yyyy-MM-dd',
  playerCount,
  roundCount,
  matchCount,
  completedCount,
  isComplete
}
```

`buildTournamentRows()` outputs grid rows shaped like:

```js
{
  date,
  year,
  players,
  rounds,
  matches,
  totalPoints,
  winner,
  winnerPoints,
  runnerUp,
  status,
  isComplete
}
```

The preview leaderboard is best-effort from `Store.getMatches().filter(m => m.date === row.date)`. If full history or that day is not loaded, the preview says no match history is loaded for that date.

## Sub-tabs / Sections
There are no sub-tabs. Sections are:

- Header — title, usage hint, optional "Load results" button.
- Results grid — `createDataGrid` table with year filter and search.
- Preview side panel — selected tournament summary and leaderboard.
- Empty/loading states — first-run and lazy-index states.
- Floating create button — link to `#/create-tournament`.

## Related Feature Docs
- `.github/features/tournament-management.md` — tournament index metadata and read/write access rules.
- `.github/features/desktop-ui.md` — desktop data-grid and master/side-panel layout.

## Update Protocol
Update this skill whenever `js/pages/tournaments.js` grid columns, preview behavior, result loading, data shape, sorting/searching, or routing changes, or when the linked feature MDs change.
