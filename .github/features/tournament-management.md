# Tournament Management

## Logic Flow

**User creates tournament** → **System generates rounds 1-3** → **Players enter match scores** → **Round completes** → **Proceed to next round**

1. **Create Phase**: User specifies date (yyyy-MM-dd) and player list (4, 8, 12, or 16 players). Players initialized with zero stats. If a tournament (active or completed) already exists for that date, the Create Tournament page asks the admin to confirm an overwrite; confirming deletes the existing tournament (`deleteTournament(date)`) before creating the new one. Completed tournaments cannot be overwritten (`deleteTournament` refuses to delete completed tournaments).
2. **Round 1 Generation**: 4-player groups created sequentially. Each group becomes 2v2 match (player[0]+player[3] vs player[1]+player[2]).
3. **Score Entry**: Players log cumulative team scores. Match complete when team1Score + team2Score = 25.
4. **Round Completion**: All matches in round must hit 25-point threshold. System ranks players and generates next round seeding.
5. **Rounds 2-3**: Ranked player pairings created (top vs bottom, [0]+[3] vs [1]+[2]). Repeated until all 3 rounds finished.

## Key Calculations

| Condition | Formula | Purpose |
|---|---|---|
| Match Complete | `team1Score + team2Score === 25` | Validate score entry |
| Round Complete | All matches satisfy Match Complete | Gate round advancement |
| Tournament Locked | `currentDate - tournamentDate > 24 hours` | Prevent retroactive edits |
| Player Rank | Sort: totalPoints ↓, wins ↓, PPG ↓, name ↑ | Seeding for rounds 2-3 |
| Player Stats | Sum across all completed matches | Used for ranking |

## Data Schema

```javascript
tournament: {
  id: uuid,
  tournamentDate: "yyyy-MM-dd",
  accessCode: string | null,  // Optional access code (e.g. "ABC-123"), set at creation or edited later
  players: [
    { id, name, totalPoints, gamesPlayed, wins, losses }
  ],
  rounds: [
    {
      roundNumber: 1|2|3,
      matches: [
        {
          id, roundNumber, player1, player2, player3, player4,
          team1Score, team2Score, completedAt,
          team1Player1Elo, team1Player2Elo, team2Player1Elo, team2Player2Elo
        }
      ],
      completedAt: null | timestamp
    }
  ],
  currentRoundNumber: 0..3,
  isStarted: boolean,
  isCompleted: boolean,
  startedAt: timestamp | null,
  completedAt: timestamp | null
}
```

Match: Team1 = (player1 + player2). Team2 = (player3 + player4).

## Access Code Field

### Create Form
- **Position**: New input field inserted BETWEEN the date field and the number-of-players field.
- **Label**: "Access Code" (optional)
- **Type**: Text input, max 20 characters
- **Default**: Empty (null or empty string)
- **Placement in form**:
  1. Date field
  2. **[NEW] Access Code input** ← HERE
  3. Number of Players selector
  4. Players slots

### Player Count Switching (name preservation)
Switching the "Number of Players" selector **never clears already-typed names**:
- **Shrinking** (e.g. 12 → 8): the first N names are kept, the surplus slots (and their names) are dropped.
- **Growing** (e.g. 12 → 16): all existing names stay in place, the new slots are rendered blank.
- Implemented by the pure helper `resizePlayerNames(names, newCount)` in `js/pages/create-tournament.js`,
  which returns an array of exactly `newCount` entries (truncated or `''`-padded).

### Tournament View Header
- Access code (if present) displayed **next to** the "Matches" and "Leaderboard" tab labels
- Format: `"Code: ABC-123"` (or similar display, admin-configurable)
- When no access code is set, display is omitted or shows placeholder (e.g., "— no access code —")

### Access Code Edit (Admin Only)
- **Who**: Only administrators (Mino, Kikke, Jeremy) (gated by `Store.isAdministrator()`)
- **Where**: Small pen/edit **✎** icon displayed next to the access code label/display (in the header)
- **Interaction**:
  1. Click pen icon → inline edit or modal appears
  2. User types/modifies/clears the access code
  3. Click "Save" or "Update" button
  4. Code is updated in tournament object in Store
  5. **Push to GitHub**: Triggers `saveTournamentState()` → `markMatchDateDirty()` → `flushPush()` to sync to backend
- **Validation**: No hard constraints; max 20 chars suggested

## Tournament Navigation

The tournament detail page header contains **◀** and **▶** buttons to navigate to the previous (older) or next (newer) tournament:

- Tournaments are ordered by date descending (newest first); ◀ goes older, ▶ goes newer.
- Buttons are disabled at boundaries (oldest / newest tournament).
- Locked tournaments (incomplete + non-admin) are excluded from navigation — non-admin users skip over them.
- Clicking navigates to `#/tournament/<date>`.

## Leaderboard Tab

The **Leaderboard** tab on a completed (or in-progress) tournament shows the same rich statistics table as the Statistics page per-date view:

- Columns: `#, NAME, W/T, PTS, AVG, WIN%, ELO, ELO Δ`
- Sortable by any column
- Clicking a player name opens the player profile dialog
- ELO data loaded from cached match history or per-player history files
- Falls back to a basic `Pts / W / L / PPG / Win%` table if no match data is available in the store (e.g. active tournament before data is loaded)



`Store.isAdministrator()` gates tournament create/modify/run actions.

Admins: **Mino**, **Kikke**, **Jeremy** — all have full tournament management rights.
Admin names are loaded from `data/administrators.json` (not hardcoded) at app init via `Store.setAdministrators()`.

## Access Control Policy

### Read Access (View Tournaments)
- **Admins** (Mino, Kikke): Can view ALL tournaments (completed + active/in-progress)
- **Non-Admins**: Can view COMPLETED tournaments + ACTIVE/IN-PROGRESS tournaments (read-only)

### Write Access (Modify Tournaments)
**Only Admins** can:
- Create new tournaments (`createTournament()`)
- Start tournaments (`startTournament()`)
- Edit match scores (`setMatchScore()`)
- Advance rounds (`startNextRound()`)
- Complete tournaments (`completeTournament()`)
- Edit access code (`updateAccessCode()`)

### End Tournament — progress dialog
The "End Tournament" confirm popup shows live per-operation status once confirmed.
The flow is orchestrated by `runTournamentCompletion(tournament, report)` (service layer);
the page only renders `COMPLETION_STEPS` and forwards `report(id, status, detail)` with
`status` ∈ `pending | running | success | error`.
Reported steps:
| id | Step |
|----|------|
| `finalize` | Local finalize (ELO baseline read + Store writes) |
| `push` | GitHub day-file write (`pushCompletedTournament`) |
| `index` | GitHub tournaments index update (`updateTournamentIndexEntry`) |
| `telegram` | Telegram tournament-completed alert |
| `notify` | Web Push tournament-completed relay |

`runTournamentCompletion` never rejects: each failure is reported on its own step and
written to the Logs tab via `logError`, and any step still `pending`/`running` when the
sync fails is flipped to `error` — so the dialog always reaches a terminal state.
The Telegram and Web Push relays are independent of the GitHub sync and of each other.

#### Fast, bounded completion (why it no longer hangs)
Ending a tournament used to pull the **entire** match history — one sequential GitHub read
per tournament date — because the pre-tournament ELO baseline was recomputed from scratch
via `calculateAllEloRankings()`. On a slow or stalled connection this took minutes; when the
`mexicano_matches_fully_loaded` flag happened to be set it returned instantly, which is why
it felt random.

The baseline is now **read, not recomputed** — `resolveEloBaseline(date)` in
`js/services/tournament.js`, first hit wins:
1. `mexicano_elo_baseline` snapshot written by the previous completion — 0 requests
2. `players_summary` (`players.json`, normally already cached) — 0–1 request
3. the previous tournament's day file, whose embedded `Team*Elo` are authoritative for its
   participants (covers a lagging data pipeline) — ≤1 request, 0 if already cached locally
4. replay of locally cached matches — 0 requests

Files touched when ending a tournament:
| File | Purpose |
|------|---------|
| `YYYY/YYYY-MM/<date>.json` | the completed day file (read sha + write) |
| `tournaments.json` | index entry upsert (read sha + write) |
| `players.json` / previous day file | ELO baseline, only if not already cached |
| `POST /dispatches` ×2 | Telegram alert + Web Push relay |

`players.json` and the month's `players_overview.json` are **not** written by the app — the
data pipeline regenerates them from our `tournaments.json` push.

The completion push (`pushCompletedTournament` in `js/services/github.js`) deliberately
bypasses the debounced `pushAll()` queue (it cancels any pending sync first): waiting for
that queue — which rewrites every synced file and any unrelated in-flight push — was a
second source of the hang. Everything else keeps syncing in the background.

All requests in this flow use the shared timed fetch (`js/services/http.js`) with the
`FAST_TIMEOUTS` ladder `2s → 3s` (5s total per request, hard cap), so a stalled connection
fails fast and retries once instead of hanging forever. Telegram and Web Push relay
dispatches use the same helper; background reads use a single 5s attempt.

On failure the local copy is preserved: `mexicano_completion_marker` stays set, the date is
re-marked dirty, and `retryCompletedTournamentPush()` runs on reconnect.

**Non-Admins**:
- Cannot perform ANY mutations on tournaments (all write endpoints guarded in service layer)
- Edit UI (score buttons, round actions, access code edit) hidden/disabled

### Navigation (Prev/Next Arrows)
- **Admins**: Navigate through ALL tournaments (completed + active)
- **Non-Admins**: Navigate through COMPLETED tournaments + ACTIVE tournaments (both included, not locked)

### Tournament List (Home Page)
- **Admins**: See all tournaments, clickable, no locks
- **Non-Admins**: See all tournaments (completed + active), all clickable, no locks. No "🔒" badges.

### UI Layer Gating (Score & Round Control)
In `renderMatchesTab()` (`js/pages/tournament.js`):
- **Line ~325**: "Tap to score" hint rendered only if `Store.isAdministrator() === true`
- **Lines ~332–344**: Action buttons (Next Round, End Tournament) rendered only if `Store.isAdministrator() === true`
- **Line ~359**: Click-to-score listener attached only if `Store.isAdministrator() === true`

**Result**: Non-admins see match cards (read-only) but NO score-entry UI, NO action buttons, NO click listeners.

### Service Layer Guards
- Service layer (`js/services/tournament.js`): All mutation functions check `Store.isAdministrator()` at entry; throw or return error if non-admin
- Router (`js/router.js`): No access gate; page loads, but mutations fail safely at service layer

### Implementation Details
- UI layer (`js/pages/tournament.js`, create-tournament.js): Hide/disable edit controls conditionally on `isAdministrator()`
- Non-admins blocked at TWO layers: UI (components hidden) + service (mutations rejected)

## Player Slot Shift (Create Phase)

During tournament creation, each player slot has ▲ and ▼ buttons to reorder players:

- **Shift Down (▼)**: Moves the selected player and all consecutive filled players below it one slot down. Requires an empty slot to exist after the filled block. The vacated slot becomes empty.
- **Shift Up (▲)**: Moves the selected player one slot up. Requires the slot immediately above to be empty. The vacated slot becomes empty.
- Buttons auto-disable when the move is not possible (no room, slot empty, or at boundary).

Example: 8 players in a 12-slot tournament. Select player 4, click ▼ — players 4–8 shift to slots 5–9, slot 4 becomes empty for a new name.

## Edge Cases & Constraints

### Edge Cases
- **Incomplete final group**: Fewer than 4 players in last group → skipped (match not created).
- **Tied scores**: Both teams score same cumulative points (e.g., 13-12) → valid, both get credited.
- **Mid-tournament edit (< 24h)**: Editing a previous round's score cascades: later rounds are
  deleted, player stats are recalculated, and (since the edited round is complete again) the
  next round is immediately regenerated from the updated standings. Example: on round 7, editing
  round 6 overrides round 6 and recreates round 7 from the new results.
  The cascade is pushed to GitHub straight away via `pushTournamentDayFile()` (verified write) —
  unlike a normal current-round score entry, which is only pushed on round advance / end.
  Without that immediate push the remote day file would keep the stale rounds and silently
  overwrite the edit on the next load.
- **Player removal**: Not explicitly handled; current schema assumes fixed player list per tournament.
- **Stale date file vs definitive index**: If `tournaments.json` has `isComplete: true` with real match data (`completedCount === matchCount > 0`), the index wins over a stale date file that still contains `{ tournament: { isCompleted: false } }` (leftover intermediate push). The active tournament is cleared and stale matches are purged. Only when `matchCount === 0` (index may be stale after a data-restore) does the date file take precedence.

### Constraints
- **Match format**: Always 2v2 (4 players per match).
- **Round structure**: Fixed 3-round tournament (Round 1 sequential grouping, Rounds 2-3 re-ranked).
- **Score ceiling**: Max 25 points per match (must sum exactly to 25).
- **Edit window**: Tournament editable only if `currentDate - tournamentDate <= 24 hours`. After 24h, locked to view-only.
- **Player count**: 4, 8, 12, or 16 only. Validation enforced at create time.
- **Duplicate names**: Case-insensitive check; "Alice" and "alice" rejected.

## Data Relationships

```
Tournament (1)
  ├─ Players (4..16)
  │   └─ Stats: totalPoints, wins, losses, gamesPlayed
  │       (Recalculated after each match score entry)
  │
  └─ Rounds (1..3)
      └─ Matches (1..4 per round, grouped by 4 players)
          ├─ Team1: player1 + player2
          ├─ Team2: player3 + player4
          └─ Scores: team1Score, team2Score (sum = 25)
              └─ Completion: completedAt timestamp
```

**Seeding for Round 2+**: Calls `rankPlayers()` from ranking.js. Ranks players by totalPoints (desc), then wins (desc), then points-per-game (desc), then alphabetically. Top-ranked paired with bottom in new groups.

## View-Access Audit

### Contradiction Found
**MD Policy (Line 114)**: "Non-Admins: Can view COMPLETED tournaments + ACTIVE/IN-PROGRESS tournaments (read-only)"
**Code Reality**: THREE gates BLOCK non-admins from viewing active tournaments (🔒 icons, disabled UI, filtered nav).

### Current Gates

| Gate | File | Lines | Behavior | Issue |
|---|---|---|---|---|
| **Home Card** | `js/pages/home.js` | 452-476 | If `isAdministrator`: `<a>` link (clickable). Else: `<div>` w/ `opacity:0.4;cursor:not-allowed;` + 🔒 title="Only admins can access active tournaments" | Non-admin sees grayed-out card, no navigation |
| **Tournament List** | `js/pages/tournaments.js` | 37-56 | `const locked = !entry.isComplete && !isAdministrator;` Adds `tournament-list-item--locked` class, 🔒 badge, no click handler | Non-admin list items unclickable, locked appearance |
| **Prev/Next Nav** | `js/pages/tournament.js` | 175-177 | `accessible = [...index].filter(e => e.isComplete \|\| isMino)` Filters out active tournaments for non-admins | Non-admin cannot navigate to active tournaments via arrows |

### Solution
Remove all three gates. Non-admins **can READ** active tournaments (view is read-only; mutations already gated at service layer `js/services/tournament.js`).

### Acceptance Criteria

**Input → Expected Output:**

1. **Home: Active Tournament Card (Non-Admin)**
   - Input: Non-admin user, active tournament exists
   - Expected: Card is clickable `<a href="#/tournament/2026-06-16">` (no disabled state, no 🔒)

2. **Home: Active Tournament Card (Admin)**
   - Input: Admin (isAdministrator=true), active tournament exists
   - Expected: Card remains clickable (regression: same as non-admin now)

3. **Tournament List: Active Tournament Item (Non-Admin)**
   - Input: Non-admin user, list contains active tournament (isComplete=false)
   - Expected: Item is clickable (no `tournament-list-item--locked` class, no 🔒, click handler fires)

4. **Tournament List: Active Tournament Item (Admin)**
   - Input: Admin (isAdministrator=true), list contains active tournament
   - Expected: Item is clickable (regression: same behavior)

5. **Tournament List: Completed Tournament (Non-Admin)**
   - Input: Non-admin user, completed tournament (isComplete=true)
   - Expected: Item is clickable, no lock (regression: already working)

6. **Tournament: Prev/Next Navigation (Non-Admin)**
   - Input: Non-admin viewing active tournament, accessible tournaments to navigate to include both completed + active
   - Expected: `accessible` array includes active tournaments; prev/next buttons navigate across all (not filtered by `isAdministrator`)

7. **Tournament: Prev/Next Navigation (Admin)**
   - Input: Admin (isAdministrator=true) viewing tournament
   - Expected: `accessible` includes all tournaments (regression: same behavior)

8. **Write Access (All Roles)**
   - Input: Non-admin attempts score entry, round advance, or tournament creation
   - Expected: Service layer (`js/services/tournament.js`) rejects mutations; UI buttons remain hidden/disabled (no regression)

### Implementation Status: ✅ COMPLETED

**Edits Applied** (TDD: RED → GREEN):
1. `js/pages/home.js` lines 452-475: Removed `if (isAdministrator)` conditional. Card always renders as clickable `<a href="#/tournament/${date}">` for all users.
2. `js/pages/tournaments.js` lines 37-56: Removed `const locked = !entry.isComplete && !isAdministrator;` guard. List items clickable for all users (no lock class, no 🔒).
3. `js/pages/tournament.js` lines 175-177: Removed `.filter(e => e.isComplete || isAdministrator)` gate. Prev/next navigation includes all tournaments for all users.

**Test Coverage**: `tests/tournament/tournament-view-access.test.js` (5 tests, all GREEN).

**Security**: Service layer mutations remain protected (`js/services/tournament.js`). Non-admins can **READ** active tournaments but **CANNOT WRITE** (edits, score entry, round advance all rejected at service layer). UI edit controls remain hidden/disabled for non-admins.

**Final Behavior**:
- **Read Access**: Everyone (admin + non-admin) can view active tournaments (view-only, no locks)
- **Write Access**: Admins only (Mino, Kikke) can modify
- **Navigation**: Prev/next arrows include all tournaments for everyone
- **List Display**: Active tournaments shown in home/tournaments pages (no 🔒, clickable)

## Delete Tournament (Incomplete Only)

An **incomplete** tournament can be deleted. A **completed** tournament cannot.

### Rules
- **Who**: Admins only (`Store.isAdministrator()`).
- **Guard**: Deletion is rejected if the tournament is completed — either the `tournaments.json` index entry has `isComplete: true`, or the active tournament has `isCompleted: true`. Throws `"Cannot delete a completed tournament"`.
- **Non-admin**: `deleteTournament()` throws `"Tournament mutations require admin access"`.

### Effects (`deleteTournament(date)` in `js/services/tournament.js`)
1. Removes the entry for `date` from the in-memory tournaments index (`Store.setTournamentsIndex`).
2. Purges all match entities for `date` from the Store (`Store.setMatches`).
3. Clears the active tournament if it matches `date` (`Store.clearActiveTournament`).
4. Emits `tournament-changed` (payload `null`).
5. Remote cleanup (via `js/services/github.js`):
   - `removeTournamentIndexEntry(date)` → rewrites `tournaments.json` without that date.
   - `deleteTournamentDayFile(date)` → deletes the generated `YYYY/YYYY-MM/YYYY-MM-DD.json` file (no-op if 404 / not configured).

### UI
- **Where**: Tournament detail page (`js/pages/tournament.js`), Matches tab.
- **Visibility**: "Delete Tournament" button shown only when `Store.isAdministrator()` and `!tournament.isCompleted`.
- **Flow**: Click → confirm dialog → `deleteTournament(date)` → toast → navigate to `#/tournaments`.

## File References

| File | Responsibility |
|---|---|
| `js/services/tournament.js` | Core lifecycle: create, start, score entry, round advance, completion. Match generation. Player stat recalculation. |
| `js/services/ranking.js` | Player ranking algorithm (totalPoints, wins, PPG, name). Used for Round 2+ seeding. |
| `tests/tournament/tournament-lifecycle.test.js` | Full lifecycle tests: create → start → setScore → nextRound → complete. Validates Store & State emissions. |

## Integration Points

- **Store** (localStorage): Persists active tournament + match history. `setActiveTournament()`, `getMatches()`, `setMatches()`.
- **State** (event bus): Emits `tournament-changed` on create, score, advance, complete.
- **GitHub service**: Auto-pushes after round advance/completion. Maintains tournaments.json index + monthly overviews.
- **Local dev server**: Writes tournament day on completion (for local testing).
