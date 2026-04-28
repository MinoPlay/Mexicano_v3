# Data Flow — Read & Write Reference

All app data lives in two places simultaneously:
- **localStorage** — the in-memory working copy (`mexicano_*` keys)
- **GitHub repository** — the persistent source of truth

`Store` (localStorage wrapper) and `github.js` (GitHub Contents API) are the two layers.
Every `Store.set()` call automatically schedules a debounced push to GitHub (1.5 s delay).

---

## Repository File Layout

```
<basePath>/                          (e.g. mexicano_v3/backup-data)
├── players.json                     ← all-time player stats + ELO (generated)
├── players_meta.json                ← last-generated date for incremental updates
├── tournaments.json                 ← index of all tournament dates + metadata
├── elo_history.json                 ← full ELO timeline per player (generated)
├── data/
│   └── active_tournament.json      ← in-progress tournament state
├── players_summaries/
│   └── summary_<slug>.json         ← per-player deep stats (generated on demand)
└── YYYY/
    └── YYYY-MM/
        ├── YYYY-MM-DD.json          ← match results for one tournament day
        ├── players_overview.json    ← monthly stats snapshot (generated)
        └── doodle_YYYY-MM.json      ← attendance schedule for the month
```

---

## Per-Window Data Activity

### `/` — Home

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players.json` | On load (via `pullHomeData`) |
| READ | `data/active_tournament.json` | On load |
| READ | `tournaments.json` | On load (no create, no dir-walk) |
| READ | `YYYY/YYYY-MM/YYYY-MM-DD.json` (latest date only) | On load, only if missing from cache |

No writes.

---

### `/tournaments` — Tournament List

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players.json` | On load (via `pullTournamentsPage`) |
| READ | `data/active_tournament.json` | On load |
| READ | `tournaments.json` | On load — **creates it** if missing (full repo dir-walk) |

No writes.

---

### `/tournament/:date` — Tournament Detail

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | localStorage `active_tournament` | First, always |
| READ | localStorage `matches` | Falls back to this if no active tournament |
| READ | `YYYY/YYYY-MM/YYYY-MM-DD.json` | Lazy-fetched from GitHub if not in cache |

Writes happen via tournament lifecycle (see section below).

---

### `/create-tournament` — Create Tournament

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | localStorage `members` | Player name suggestions |
| WRITE | localStorage `active_tournament` | `createTournament()` → `Store.setActiveTournament()` |
| WRITE | `data/active_tournament.json` | `startTournament()` → `flushPush()` |
| WRITE | `tournaments.json` | `startTournament()` → `updateTournamentIndexEntry()` |
| WRITE | `YYYY/YYYY-MM/YYYY-MM-DD.json` | `startTournament()` → `flushPush()` (dirty date pushed) |

---

### `/statistics` — Statistics

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players.json` | Via `pullCoreData` on load |
| READ | `tournaments.json` | Via `pullCoreData` on load |
| READ | `YYYY/YYYY-MM/players_overview.json` | Current + prev month via `pullCoreData`; specific month lazy-fetched when user selects it |
| READ | `YYYY/YYYY-MM/YYYY-MM-DD.json` | Lazy-loaded when user selects a date with no cached matches |

No writes.

---

### `/elo-charts` — ELO Charts

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players.json` | On load (via `pullEloChartsData`) |
| READ | `tournaments.json` | On load |
| READ | `elo_history.json` | On load |

No writes.

---

### `/doodle` — Attendance / Doodle

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | Core data (players, tournaments) | Via `pullCoreData` on load |
| READ | `YYYY/YYYY-MM/doodle_YYYY-MM.json` | Current + next month on load via `pullDoodleMonth` |
| WRITE | `YYYY/YYYY-MM/doodle_YYYY-MM.json` | On every user change via `pushDoodleNow` (immediate, bypasses debounce) |

---

### `/settings` — Settings

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players.json` | On load (via `pullSettingsData`, lightweight) |
| WRITE | `players.json` + `players_meta.json` | "Generate players.json" button → `generatePlayersJson()` |
| WRITE | `elo_history.json` | "Generate elo_history.json" button → `generateEloHistory()` |
| WRITE | `YYYY/YYYY-MM/players_overview.json` | "Generate monthly overview" button → `generateMonthlyOverviews()` |
| WRITE | `players_summaries/summary_<slug>.json` | "Generate / Update Summary" button → `generateOrUpdatePlayerSummary()` |

---

### `/player-profile` (dialog)

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players_summaries/summary_<slug>.json` | On dialog open via `readPlayerSummary()` |

No writes.

---

## Tournament Lifecycle — Detailed Write Sequence

### 1. Create + Start (`createTournament` + `startTournament`)

```
createTournament(date, names)
  → Store.setActiveTournament(tournament)
      → localStorage: mexicano_active_tournament

startTournament(tournament)
  → saveTournamentState(tournament)           [see step 2]
  → cancelPendingSync()
  → flushPush()                               → GitHub WRITE: data/active_tournament.json
                                              → GitHub WRITE: YYYY/YYYY-MM/YYYY-MM-DD.json (dirty date)
  → updateTournamentIndexEntry(...)           → GitHub READ+WRITE: tournaments.json
```

### 2. Score a Match (`setMatchScore`)

```
setMatchScore(tournament, roundNumber, matchId, s1, s2)
  → recalculateAllPlayerStats(tournament)
  → saveTournamentState(tournament)
      → Store.setActiveTournament(tournament)   → localStorage: mexicano_active_tournament
      → Store.setMatches(matches)               → localStorage: mexicano_matches
      → markMatchDateDirty(date)
  → cancelPendingSync()                       [NO GitHub push on individual scores]
```

> Scores are **only pushed to GitHub** when advancing to the next round or ending the tournament.

### 3. Next Round (`startNextRound`)

```
startNextRound(tournament)
  → saveTournamentState(tournament)           [writes localStorage]
  → cancelPendingSync()
  → flushPush()                               → GitHub WRITE: data/active_tournament.json
                                              → GitHub WRITE: YYYY/YYYY-MM/YYYY-MM-DD.json (dirty date)
```

### 4. End Tournament (`completeTournament`)

```
completeTournament(tournament)
  → Store.setMatches(allMatches)              → localStorage: mexicano_matches
  → Store.clearActiveTournament()             → localStorage: mexicano_active_tournament (removed)
  → writeTournamentDay(date, matches)         → local dev server only (no-op in prod)
  → markMatchDateDirty(date)
  → deleteFile(data/active_tournament.json)   → GitHub DELETE: data/active_tournament.json
  → flushPush()                               → GitHub WRITE: YYYY/YYYY-MM/YYYY-MM-DD.json
  → generateMonthlyOverviews(yearMonth)       → GitHub WRITE: YYYY/YYYY-MM/players_overview.json  ← MUST come first
  → generatePlayersJson()                     → GitHub WRITE: players.json                         ← runs only after overview succeeds
                                              → GitHub WRITE: players_meta.json
  → updateTournamentIndexEntry(...)           → GitHub READ+WRITE: tournaments.json
```

> **Ordering guarantee**: `generateMonthlyOverviews` is chained with `.then()` before
> `generatePlayersJson`. This is intentional and must not be reversed. The Statistics
> page reads ELO from `players_overview.json`; the Home page reads from `players.json`.
> Writing the overview first and aborting the chain on failure keeps both files consistent
> — `players.json` is never updated unless the overview write succeeds.

---

## When Are `players.json`, `players_overview.json`, `tournaments.json` Modified?

### `players.json` + `players_meta.json`
- **Written** automatically after every `completeTournament()` call — **only after `players_overview.json` is written successfully**
- **Written** manually via Settings → "Generate players.json" button
- **Read** on every page load (home, tournaments, statistics, settings, elo-charts, doodle)
- Contains: `[{ Name, ELO, PreviousELO, Wins, Losses, TotalPoints, Average, Tournaments }]`

### `YYYY/YYYY-MM/players_overview.json`
- **Written** automatically after every `completeTournament()` call (for that tournament's month) — **must succeed before `players.json` is written**
- **Written** manually via Settings → "Generate monthly overview" button (for a chosen month)
- **Read** on statistics page load (current + previous month, or all months on demand)
- Contains: `[{ Name, Total_Points, Wins, Losses, Average, ELO }]` for players active that month

### `tournaments.json`
- **Written** when `startTournament()` is called (new entry added)
- **Written** when `completeTournament()` is called (entry updated with final metadata)
- **Written** (created) when the tournaments list page loads and the file doesn't exist yet (full dir-walk)
- **Read** on every page load to populate tournament dates list
- Contains: `[{ date, playerCount, roundCount, matchCount, completedCount, isComplete }]`

### `YYYY/YYYY-MM/YYYY-MM-DD.json` (match day files)
- **Written** on `startTournament()` (initial empty/first-round state)
- **Written** on `startNextRound()` (incremental scores after each round)
- **Written** on `completeTournament()` (final complete match results)
- **Read** lazily when a page needs match data for a date not yet in localStorage cache
- Contains: `{ backup_timestamp, match_date, match_count, matches: [PascalCase fields] }`

### `data/active_tournament.json`
- **Written** on `startTournament()` and `startNextRound()` (via `flushPush`)
- **Deleted** on `completeTournament()`
- **Read** on home, tournaments, and tournament detail page loads
- Contains: the full in-progress tournament object (players, rounds, scores)

---

## Auto-Sync Mechanism

`Store.set(key, value)` → schedules `schedulePush(key)` → 1.5 s debounced → `executePush()` → `pushAll()`

Only these keys trigger auto-push:
- `active_tournament` → `data/active_tournament.json`
- `matches` → per-date `YYYY/YYYY-MM/YYYY-MM-DD.json` files (dirty dates only)

Keys that bypass auto-sync:
- `doodle_*` → pushed immediately via `pushDoodleNow()` (no debounce)
- `members`, `theme`, `changelog`, `current_user`, `github_config` → **local-only, never synced**

Session TTL (5 min) prevents redundant re-fetches within the same browser session.
Full re-fetch is forced by the refresh button (`refreshCurrentPage`), which clears TTLs first.
