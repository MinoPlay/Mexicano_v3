---
name: tab-tournaments
description: >
  Reference skill for the Tournaments list tab (route /tournaments) of the Mexicano PWA.
  Covers purpose, rules, key files, data flow, sub-tabs. Use when working on the tournaments list page.
---

# Tournaments tab

## Purpose
The Tournaments tab renders the flat list page for `#/tournaments`. It shows every entry from the cached tournaments index, lets the user open a tournament detail page, and offers entry points to create a tournament.

## Rules / Logic
`renderTournaments(container, params)` in `js/pages/tournaments.js` reads `Store.getTournamentsIndex()` and builds `sorted` as a copy sorted by `date` descending (`b.date.localeCompare(a.date)`), so newest tournaments appear first.

`formatDate(dateStr)` displays `yyyy-MM-dd` values with `toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })`. If formatting fails, it returns the original date string.

`statusBadge(entry)` renders:
- `Complete` with `badge-success` when `entry.isComplete` is true.
- `<completedCount>/<matchCount>` with `badge-warning` when some matches are complete.
- `Pending` with `badge-primary` otherwise.

`renderList()` writes into `#tournament-list`. With no entries, it renders an empty state with a `#/create-tournament` button. With entries, each row is a `.tournament-list-item` with `data-date="${entry.date}"`, formatted date text, optional metadata (`playerCount players · roundCount round(s)`), and the status badge.

Every list item gets a click listener that sets `window.location.hash` to `'/tournament/<date>'`. There is no admin/read lock in this page; active and completed tournaments are clickable for all users. Write access is guarded elsewhere.

The first render includes a floating action button (`.fab`) linking to `#/create-tournament`. If the index is empty and GitHub config has a PAT, the page initially shows `⏳ Loading…` and lazy-imports `../services/github.js`, then calls `fetchTournamentsIndexPublic()`. After the fetch, it re-reads `Store.getTournamentsIndex()`, re-sorts descending, and renders the list. If no entries are found, it replaces the loading state with the empty state. On fetch failure, it shows `Failed to load tournaments`.

## Key Files & Symbols
- `js/pages/tournaments.js` — exports `renderTournaments(container, params)`; helper symbols: `formatDate(dateStr)`, `statusBadge(entry)`, nested `renderList()`.
- `js/store.js` — `Store.getTournamentsIndex()` reads the in-memory `tournaments_index` cache; `Store.getGitHubConfig()` controls whether the lazy GitHub fetch runs; `Store.setTournamentsIndex(entries)` is used by GitHub services.
- `js/services/github.js` — `fetchTournamentsIndexPublic()` calls `fetchTournamentsIndex({ create: true })`, populates `Store.setTournamentsIndex(entries)`, and updates cached tournament dates.
- `js/app.js` — imports `renderTournaments`, maps `'/tournaments'` to it, and calls `pullForRoute(window.location.hash)` on GitHub-backed loads.
- `js/components/nav.js` — bottom nav includes `{ path: '/tournaments', icon: '📋', label: 'Tournaments' }`.
- `css/pages.css` and `css/components.css` — define `.tournament-list-item`, `.fab`, `.empty-state`, and badge classes used by this page.

## Data
The list is driven by the tournaments index, stored in the in-memory Store cache key `tournaments_index`. The expected entry shape is:

```js
{
  date: 'yyyy-MM-dd',
  playerCount: number,
  roundCount: number,
  matchCount: number,
  completedCount: number,
  isComplete: boolean
}
```

`fetchTournamentsIndexPublic()` reads or creates `tournaments.json` through the GitHub service. When creating the index, metadata is computed from tournament day files: player names, distinct round numbers, match count, completed match count, and `isComplete` when all matches are complete.

`Store.getGitHubConfig()?.pat` is the only data gate in `renderTournaments`: when present and the local index is empty, the page attempts the lazy fetch. `State` is not used by `js/pages/tournaments.js`.

## Sub-tabs / Sections
None. The page is flat: a header, the tournament list area, and a floating `+` button for `#/create-tournament`.

Each row navigates to `#/tournament/:date`. The empty state and floating action button navigate to `#/create-tournament`.

## Related Feature Docs
- `.github/features/tournament-management.md` — describes tournament lifecycle, tournaments index metadata, read/write access policy, and the completed removal of older list locks for non-admin users.

## Update Protocol
Update this skill whenever js/pages/tournaments.js render logic, data shape, sorting, or routing changes, or when the linked feature MD changes.
