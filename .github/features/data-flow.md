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
├── elo_history/
│   └── elo_history_<playerId>.json ← per-player ELO timeline (generated)
├── players_summaries/
│   └── summary_<slug>.json         ← per-player deep stats (generated on demand)
└── YYYY/
    └── YYYY-MM/
        ├── YYYY-MM-DD.json          ← tournament day file (see formats below)
        ├── players_overview.json    ← monthly stats snapshot (generated)
        ├── doodle_YYYY-MM.json      ← attendance schedule for the month
        └── doodle_changelog_YYYY-MM.json ← recent doodle changes for that month
```

### `YYYY-MM-DD.json` — two formats

**In-progress (during a tournament):**
```json
{
  "backup_timestamp": "...",
  "match_date": "YYYY-MM-DD",
  "tournament": { /* full tournament object from localStorage */ }
}
```

**Completed (after `completeTournament()`):**
```json
{
  "backup_timestamp": "...",
  "match_date": "YYYY-MM-DD",
  "match_count": 12,
  "matches": [{ /* PascalCase fields */ }]
}
```

> There is no longer a separate `data/active_tournament.json`. The active tournament state is
> embedded directly in the date file under the `tournament` field.

---

## Per-Window Data Activity

### `/` — Home

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players.json` | On load (via `pullHomeData`) |
| READ | `YYYY/YYYY-MM/YYYY-MM-DD.json` (active date's date file) | On load — extracts `tournament` field |
| READ | `tournaments.json` | On load (no create, no dir-walk) |
| READ | `YYYY/YYYY-MM/YYYY-MM-DD.json` (latest date only) | On load, only if missing from cache |

No writes.

---

### `/tournaments` — Tournament List

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players.json` | On load (via `pullTournamentsPage`) |
| READ | `YYYY/YYYY-MM/YYYY-MM-DD.json` (active date's date file) | On load — extracts `tournament` field |
| READ | `tournaments.json` | On load — **creates it** if missing (full repo dir-walk) |

No writes.

---

### `/tournament/:date` — Tournament Detail

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | localStorage `active_tournament` | First, always |
| READ | localStorage `matches` | Falls back to this if no active tournament |
| READ | `YYYY/YYYY-MM/YYYY-MM-DD.json` | Lazy-fetched from GitHub if not in cache |
| READ | `YYYY/YYYY-MM/YYYY-MM-DD.json` | Force-refreshed from GitHub for active tournaments (`fetchActiveTournamentJson`) |

Writes happen via tournament lifecycle (see section below).

---

### `/create-tournament` — Create Tournament

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | localStorage `members` | Player name suggestions |
| WRITE | localStorage `active_tournament` | `createTournament()` → `Store.setActiveTournament()` |
| WRITE | `YYYY/YYYY-MM/YYYY-MM-DD.json` | `startTournament()` → `flushPush()` (embeds `tournament` field) |
| WRITE | `tournaments.json` | `startTournament()` → `updateTournamentIndexEntry()` |

---

### `/statistics` — Statistics

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players.json` | Via `pullCoreData` on load |
| READ | `tournaments.json` | Via `pullCoreData` on load |
| READ | `data/attendance_manual.json` | Manual (no-tournament) attendance; via `pullCoreData` (step 2b) |
| READ | `YYYY/YYYY-MM/players_overview.json` | Current + prev month via `pullCoreData`; specific month lazy-fetched when user selects it |
| READ | `YYYY/YYYY-MM/YYYY-MM-DD.json` | Lazy-loaded when user selects a date with no cached matches |

No writes.

---

### `/elo-charts` — ELO Charts

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players.json` | On load (via `pullEloChartsData`) |
| READ | `tournaments.json` | On load |
| READ | `elo_history/elo_history_<playerId>.json` | On load + on player selection |

No writes.

---

### `/doodle` — Attendance / Doodle

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | Core data (players, tournaments) | Via `pullCoreData` on load |
| READ | `YYYY/YYYY-MM/doodle_YYYY-MM.json` + `YYYY/YYYY-MM/doodle_changelog_YYYY-MM.json` | Current + next month on load via `pullDoodleMonth` |
| WRITE | `YYYY/YYYY-MM/doodle_YYYY-MM.json` + `YYYY/YYYY-MM/doodle_changelog_YYYY-MM.json` | On every user change via `pushDoodleNow` (immediate, bypasses debounce) |

---

### `/settings` — Settings

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players.json` | On load (via `pullSettingsData`, lightweight) |
| WRITE | `players.json` + `players_meta.json` | "Generate players.json" button → `generatePlayersJson()` |
| WRITE | `elo_history/elo_history_<playerId>.json` | "Generate per-player ELO history" button → `generateEloHistory()` |
| WRITE | `YYYY/YYYY-MM/players_overview.json` | "Generate monthly overview" button → `generateMonthlyOverviews()` |
| WRITE | `data/attendance_manual.json` | Manual attendance page → `Store.setManualAttendance()` → auto-push (SYNCED_DATA_KEYS) |
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

[create-tournament page — fire-and-forget, staggered triggers]
  → triggerNewTournamentDayFile(tournament)   → GitHub WRITE: YYYY/YYYY-MM/YYYY-MM-DD.json
                                                              (with { tournament: {...} } field)
  → sleep 1s
  → triggerTournamentIndexEntry(tournament)   → GitHub READ+WRITE: tournaments.json
  → sleep 1s
  → sendTournamentCreatedAlert(tournament)    → Telegram relay dispatch
  → sleep 1s
  → refreshApp()                              → clear caches + reload page
```

> Triggers are fired independently (not awaited) but staggered by 1s each so the
> commits land in order: **day file → tournaments.json → telegram → refresh**. Each
> trigger logs when fired and its result. The 1s spacing avoids GitHub 409
> fast-forward conflicts on the same branch that previously dropped the day file.

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
  → flushPush()                               → GitHub WRITE: YYYY/YYYY-MM/YYYY-MM-DD.json
                                                              (updated { tournament: {...} } field)
```

### 4. End Tournament (`completeTournament`)

```
completeTournament(tournament)
  → Store.setMatches(allMatches)              → localStorage: mexicano_matches
  → Store.setActiveTournament(tournament)     → localStorage: keeps tournament (isCompleted: true)
  → completion_marker set                     → localStorage: mexicano_completion_marker
  → writeTournamentDay(date, matches)         → local dev server only (no-op in prod)
  → markMatchDateDirty(date)
  → flushPush()                               → GitHub WRITE: YYYY/YYYY-MM/YYYY-MM-DD.json
                                                              (completed format: { matches: [...] }
                                                               no `tournament` field)
  ─── ON SUCCESS ───
  → Store.clearActiveTournament()             → localStorage: mexicano_active_tournament (removed)
  → completion_marker removed                 → localStorage: mexicano_completion_marker (removed)
  → generateMonthlyOverviews(yearMonth)       → GitHub WRITE: YYYY/YYYY-MM/players_overview.json  ← MUST come first
  → generatePlayersJson({ playerNames })      → GitHub WRITE: players.json                         ← runs only after overview succeeds
                                              → only participant entries recomputed;
                                                non-participants keep existing players.json values
                                              → GitHub WRITE: players_meta.json
  → updateTournamentIndexEntry(...)           → GitHub READ+WRITE: tournaments.json
  ─── ON FAILURE (no internet) ───
  → localStorage preserved (tournament + matches + marker intact)
  → retryCompletedTournamentPush() fires on `online` event
```

> **Offline-safe guarantee**: `Store.clearActiveTournament()` is called ONLY after `flushPush()`
> succeeds. If the push fails (no internet, API error), all local data is preserved. When the
> browser fires the `online` event, `retryCompletedTournamentPush()` automatically retries the
> full push chain. The function is idempotent — calling `completeTournament()` on an already-
> completed tournament simply retries the push without re-processing matches.
>
> **Ordering guarantee**: `generateMonthlyOverviews` is chained with `.then()` before
> `generatePlayersJson`. This is intentional and must not be reversed. The Statistics
> page reads ELO from `players_overview.json`; the Home page reads from `players.json`.
> Writing the overview first and aborting the chain on failure keeps both files consistent
> — `players.json` is never updated unless the overview write succeeds.
>
> **Partial-update rule**: `completeTournament` passes `{ playerNames: participantNames }`
> to `generatePlayersJson`. Only tournament participants are recomputed from monthly overviews;
> all other player entries are kept unchanged. The Settings full-rebuild button does NOT pass
> `playerNames` and always recomputes all players.
>
> **Tournaments field**: counts individual tournament days (one ELO snapshot per day in the
> monthly overview), not calendar months. Fallback to month count only for old scalar-ELO data.

---

## When Are `players.json`, `players_overview.json`, `tournaments.json` Modified?

### `players.json` + `players_meta.json`
- **Written** automatically after every `completeTournament()` call — **only after `players_overview.json` is written successfully**
- **Partial update on completion**: only the tournament's participants are recomputed; non-participants keep their existing entry
- **Written** manually via Settings → "Generate players.json" button (full rebuild — all players)
- **Read** on every page load (home, tournaments, statistics, settings, elo-charts, doodle)
- Contains: `[{ Name, ELO, PreviousELO, Wins, Losses, TotalPoints, Average, Tournaments }]`
- `Tournaments` = count of individual tournament days played (ELO snapshot entries), not calendar months

### `YYYY/YYYY-MM/players_overview.json`
- **Written** automatically after every `completeTournament()` call (for that tournament's month) — **must succeed before `players.json` is written**
- **Written** manually via Settings → "Generate monthly overview" button (for a chosen month)
- **Read** on statistics page load (current + previous month, or all months on demand)
- Contains: `[{ Name, Total_Points, Wins, Losses, Average, ELO }]` for players active that month

### `tournaments.json`
- **Written** when `startTournament()` is called (new entry added with `isComplete: false`)
- **Written** when `completeTournament()` is called (entry updated with `isComplete: true` + final metadata)
- **Written** (created) when the tournaments list page loads and the file doesn't exist yet (full dir-walk)
- **NOT written** during round advancement — only on start and end
- **Read** on every page load to populate tournament dates list
- Contains: `[{ date, playerCount, roundCount, matchCount, completedCount, isComplete }]`

### `YYYY/YYYY-MM/YYYY-MM-DD.json` (match day files)
- **Written** on `startTournament()` — in-progress format `{ tournament: {...} }`
- **Written** on `startNextRound()` — in-progress format with updated tournament state
- **Written** on `completeTournament()` — completed format `{ match_count, matches: [...] }`
- **Read** lazily when a page needs match data for a date not yet in localStorage cache
- **Read** on pull to extract `tournament` field for active tournament resolution

---

## Active Tournament Resolution (Pull Functions)

All pull functions call `pullActiveTournamentFromDateFile()` after loading `tournaments.json`.
This helper resolves the active tournament using the following priority:

1. **Local in-progress** → fetch its date file → update localStorage with fresh data
2. **`isComplete:false` in index** → fetch that date file → set active tournament
3. **Fallback probe** → if nothing found, probe the most recent date (≤3 days) in case
   `tournaments.json` wrongly has `isComplete:true` (stale after a data restore)
4. **Backward-compat migration** → if no `tournament` field in date file, try old
   `data/active_tournament.json` once (for repos not yet migrated)

When the date file has `{ tournament: {...isCompleted: false...} }` but `tournaments.json`
says `isComplete: true`, the helper **fixes the in-memory index** to `isComplete: false`.
This prevents the Home page from hiding the live tournament and the Tournaments list from
showing the wrong "Complete" badge — without requiring a `tournaments.json` write during play.

The tournament detail page additionally calls `fetchActiveTournamentJson()` on every load
for the active tournament, bypassing the session pull guard to ensure the latest round data
is always shown.

---

## Auto-Sync Mechanism

`Store.set(key, value)` → schedules `schedulePush(key)` → 1.5 s debounced → `executePush()` → `pushAll()`

Keys that trigger auto-push (via dirty date tracking):
- `matches` → per-date `YYYY/YYYY-MM/YYYY-MM-DD.json` files (dirty dates only)

The `active_tournament` key is **no longer auto-pushed separately** — it is embedded in the
date file during `pushAll()` when building the day backup. `markMatchDateDirty(date)` must
be called to include the date in the next push.

Keys that bypass auto-sync:
- `doodle_*` → pushed immediately via `pushDoodleNow()` (no debounce)
- `doodle_changelog_*` → pushed immediately via `pushDoodleNow()` (no debounce)
- `members`, `theme`, `changelog`, `current_user`, `github_config` → **local-only, never synced**

---

## In-Memory Cache

Read-only data pulled from GitHub is stored in an **ephemeral in-memory Cache** (`js/cache.js`) instead of `localStorage`. This cache is cleared automatically on every page refresh — guaranteeing fresh data on every load with no stale state.

### Keys stored in Cache (never persisted to localStorage)
| Cache key | Source file |
|-----------|------------|
| `players_summary` | `players.json` |
| `members` | derived from `players.json` |
| `tournament_dates` | derived from `tournaments.json` |
| `tournaments_index` | `tournaments.json` |
| `monthly_YYYY-MM` | `YYYY/YYYY-MM/players_overview.json` |
| `elo_history_player_<id>` | `elo_history/elo_history_<playerId>.json` |

### Keys kept in localStorage (write paths or user config)
- `github_config`, `current_user`, `theme`, `changelog` — user preferences
- `active_tournament` — written during tournament play
- `matches` — written during/after tournament play
- `doodle_*` — written when user marks attendance
- `doodle_changelog_*` — written when doodle date selections change

### Pull deduplication
Pull functions guard with `Cache.has(key)` instead of a session TTL. If data is already in Cache (same JS context = same page visit), the pull is skipped. Since Cache is empty on every page refresh, data is always re-fetched from GitHub.


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
├── elo_history/
│   └── elo_history_<playerId>.json ← per-player ELO timeline (generated)
├── data/
│   └── active_tournament.json      ← in-progress tournament state
├── players_summaries/
│   └── summary_<slug>.json         ← per-player deep stats (generated on demand)
└── YYYY/
    └── YYYY-MM/
        ├── YYYY-MM-DD.json          ← match results for one tournament day
        ├── players_overview.json    ← monthly stats snapshot (generated)
        ├── doodle_YYYY-MM.json      ← attendance schedule for the month
        └── doodle_changelog_YYYY-MM.json ← recent doodle changes for that month
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
| READ | `data/attendance_manual.json` | Manual (no-tournament) attendance; via `pullCoreData` (step 2b) |
| READ | `YYYY/YYYY-MM/players_overview.json` | Current + prev month via `pullCoreData`; specific month lazy-fetched when user selects it |
| READ | `YYYY/YYYY-MM/YYYY-MM-DD.json` | Lazy-loaded when user selects a date with no cached matches |

No writes.

---

### `/elo-charts` — ELO Charts

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players.json` | On load (via `pullEloChartsData`) |
| READ | `tournaments.json` | On load |
| READ | `elo_history/elo_history_<playerId>.json` | On load + on player selection |

No writes.

---

### `/doodle` — Attendance / Doodle

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | Core data (players, tournaments) | Via `pullCoreData` on load |
| READ | `YYYY/YYYY-MM/doodle_YYYY-MM.json` + `YYYY/YYYY-MM/doodle_changelog_YYYY-MM.json` | Current + next month on load via `pullDoodleMonth` |
| WRITE | `YYYY/YYYY-MM/doodle_YYYY-MM.json` + `YYYY/YYYY-MM/doodle_changelog_YYYY-MM.json` | On every user change via `pushDoodleNow` (immediate, bypasses debounce) |

---

### `/settings` — Settings

| Direction | File / Store key | When |
|-----------|-----------------|------|
| READ | `players.json` | On load (via `pullSettingsData`, lightweight) |
| WRITE | `players.json` + `players_meta.json` | "Generate players.json" button → `generatePlayersJson()` |
| WRITE | `elo_history/elo_history_<playerId>.json` | "Generate per-player ELO history" button → `generateEloHistory()` |
| WRITE | `YYYY/YYYY-MM/players_overview.json` | "Generate monthly overview" button → `generateMonthlyOverviews()` |
| WRITE | `data/attendance_manual.json` | Manual attendance page → `Store.setManualAttendance()` → auto-push (SYNCED_DATA_KEYS) |
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

[create-tournament page — fire-and-forget, staggered triggers]
  → triggerNewTournamentDayFile(tournament)   → GitHub WRITE: data/active_tournament.json
                                              → GitHub WRITE: YYYY/YYYY-MM/YYYY-MM-DD.json (dirty date)
  → sleep 1s
  → triggerTournamentIndexEntry(tournament)   → GitHub READ+WRITE: tournaments.json
  → sleep 1s
  → sendTournamentCreatedAlert(tournament)    → Telegram relay dispatch
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
  → Store.setActiveTournament(tournament)     → localStorage: keeps tournament (isCompleted: true)
  → completion_marker set                     → localStorage: mexicano_completion_marker
  → writeTournamentDay(date, matches)         → local dev server only (no-op in prod)
  → markMatchDateDirty(date)
  → flushPush()                               → GitHub WRITE: YYYY/YYYY-MM/YYYY-MM-DD.json
  ─── ON SUCCESS ───
  → Store.clearActiveTournament()             → localStorage: mexicano_active_tournament (removed)
  → completion_marker removed
  → generateMonthlyOverviews(yearMonth)       → GitHub WRITE: YYYY/YYYY-MM/players_overview.json  ← MUST come first
  → generatePlayersJson({ playerNames })      → GitHub WRITE: players.json                         ← runs only after overview succeeds
                                              → only participant entries recomputed;
                                                non-participants keep existing players.json values
                                              → GitHub WRITE: players_meta.json
  → updateTournamentIndexEntry(...)           → GitHub READ+WRITE: tournaments.json
  ─── ON FAILURE (no internet) ───
  → localStorage preserved — retries on `online` event
```

> **Ordering guarantee**: `generateMonthlyOverviews` is chained with `.then()` before
> `generatePlayersJson`. This is intentional and must not be reversed. The Statistics
> page reads ELO from `players_overview.json`; the Home page reads from `players.json`.
> Writing the overview first and aborting the chain on failure keeps both files consistent
> — `players.json` is never updated unless the overview write succeeds.
>
> **Partial-update rule**: `completeTournament` passes `{ playerNames: participantNames }`
> to `generatePlayersJson`. Only tournament participants are recomputed from monthly overviews;
> all other player entries are kept unchanged. The Settings full-rebuild button does NOT pass
> `playerNames` and always recomputes all players.
>
> **Tournaments field**: counts individual tournament days (one ELO snapshot per day in the
> monthly overview), not calendar months. Fallback to month count only for old scalar-ELO data.

---

## When Are `players.json`, `players_overview.json`, `tournaments.json` Modified?

### `players.json` + `players_meta.json`
- **Written** automatically after every `completeTournament()` call — **only after `players_overview.json` is written successfully**
- **Partial update on completion**: only the tournament's participants are recomputed; non-participants keep their existing entry
- **Written** manually via Settings → "Generate players.json" button (full rebuild — all players)
- **Read** on every page load (home, tournaments, statistics, settings, elo-charts, doodle)
- Contains: `[{ Name, ELO, PreviousELO, Wins, Losses, TotalPoints, Average, Tournaments }]`
- `Tournaments` = count of individual tournament days played (ELO snapshot entries), not calendar months

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
- `doodle_changelog_*` → pushed immediately via `pushDoodleNow()` (no debounce)
- `members`, `theme`, `changelog`, `current_user`, `github_config` → **local-only, never synced**

---

## In-Memory Cache

Read-only data pulled from GitHub is stored in an **ephemeral in-memory Cache** (`js/cache.js`) instead of `localStorage`. This cache is cleared automatically on every page refresh — guaranteeing fresh data on every load with no stale state.

### Keys stored in Cache (never persisted to localStorage)
| Cache key | Source file |
|-----------|------------|
| `players_summary` | `players.json` |
| `members` | derived from `players.json` |
| `tournament_dates` | derived from `tournaments.json` |
| `tournaments_index` | `tournaments.json` |
| `monthly_YYYY-MM` | `YYYY/YYYY-MM/players_overview.json` |
| `elo_history_player_<id>` | `elo_history/elo_history_<playerId>.json` |

### Keys kept in localStorage (write paths or user config)
- `github_config`, `current_user`, `theme`, `changelog` — user preferences
- `active_tournament` — written during tournament play
- `matches` — written during/after tournament play
- `doodle_*` — written when user marks attendance
- `doodle_changelog_*` — written when doodle date selections change

### Pull deduplication
Pull functions guard with `Cache.has(key)` instead of a session TTL. If data is already in Cache (same JS context = same page visit), the pull is skipped. Since Cache is empty on every page refresh, data is always re-fetched from GitHub.
