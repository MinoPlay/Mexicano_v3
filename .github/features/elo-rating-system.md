# ELO Rating System

## Logic Flow
1. User enters match result (scoreTeam1, scoreTeam2)
2. `processMatchElo(match, players)` processes 4-player teams
3. All 4 players' ELOs recalculated vs combined opponent team
4. New ELOs stored in `players` object + history array
5. Data persisted via GitHub JSON store

## Key Calculations

### Combined Opponent ELO (RMS, not average)
```
combined_elo = sqrt((opp1_elo² + opp2_elo²) / 2)
```
- Symmetric: order doesn't matter
- Equal opponents → same combined value
- Asymmetric ELOs → RMS captures strength accurately

### Expected Win Probability
```
expected = 1 / (1 + 10^((opponent_elo - player_elo) / 400))
```
- Equal ELOs → 0.5
- Higher player ELO → expected > 0.5
- 400 point difference → expected ≈ 0.909

### New ELO
```
new_elo = player_elo + K × (actual - expected)
actual = 1 if won, else 0
K = 32 (constant)
result = round(new_elo × 100) / 100
```
- Win vs equals: +16 points
- Loss vs equals: -16 points
- Win vs weaker: smaller gain
- Rounding: 2 decimal places

## Data Schema

### Players Object
```json
{
  "[playerName]": {
    "name": "string",
    "elo": 1000.00,
    "history": [
      {
        "date": "2024-01-15",
        "roundNumber": 1,
        "elo": 1016.00
      }
    ]
  }
}
```

### Match Object (input + output)
```json
{
  "team1Player1Name": "Alice",
  "team1Player2Name": "Bob",
  "team2Player1Name": "Carol",
  "team2Player2Name": "Dave",
  "scoreTeam1": 10,
  "scoreTeam2": 5,
  "date": "2024-01-15",
  "roundNumber": 1,
  "team1Player1Elo": 1016.00,
  "team1Player2Elo": 1016.00,
  "team2Player1Elo": 984.00,
  "team2Player2Elo": 984.00
}
```
ELO fields represent each player's ELO **after** this match, embedded at tournament completion. They are a frozen snapshot and are **not** shown by the UI in the normal path: the Latest Tournament chart (`getEloHistoryForLatestTournament`) and Home/Statistics tables (`getEloSnapshots`) **recompute** ELO live from match scores (seeded from `players.json` PreviousELO). The embedded fields are read only as a last-resort fallback in the Statistics table via `getEloFromEmbeddedMatches` when full matches, summary, and per-player history files are all unavailable. Live recomputed values can therefore differ from the embedded snapshot if the seed ELO, match ordering, or K constant changed since completion.

## Edge Cases & Behaviors

- **New players**: Auto-created, start at ELO 1000
- **Ties (0-0 matches)**: Filtered out, no ELO change
- **Sequential updates**: Team1 players updated first (with initial team2 ELOs), then team2 (with updated team1 ELOs)
- **Same-team ELO**: Team1P1 and Team1P2 finish equal (same opponents before processing)
- **Sorting**: Matches sorted by `date.roundNumber` (e.g., "2024-01-01.02")
- **Rounding**: All ELO values to 2 decimals
- **Post-completion cache refresh**: On tournament completion, `applyTournamentEloToSummary` writes the freshly computed ELOs back into the cached players summary (`Store.setPlayersSummaryCache`): participants get `elo` = post-tournament value and `previousElo` = pre-tournament value; non-participants are untouched, unknown players are appended. Without this the Home "Latest Tournament" / Statistics tables keep showing the stale cached `players.json` ELO until a manual app refresh (pulls skip re-fetch while `players_summary` is cached).
- **Monthly seed — skipped months**: When generating a month's `players_overview.json`, player ELO seeds are read from each player's individual `elo_history/elo_history_{id}.json` file (via `players.json` for name→id lookup). The last entry strictly before the target month is used. This correctly handles players who skip months. Players with no prior history default to 1000.

## Constraints

- **4-player teams only**: 2v2 format hardcoded
- **Combined opponent via RMS**: Not arithmetic mean
- **K constant**: Always 32
- **Initial ELO**: Exactly 1000
- **Monthly reset**: History preserved; snapshots reset by date range
- **No bidirectional updates**: Each match processes all 4 players once

## Key Functions

| Function | Purpose |
|----------|---------|
| `calculateCombinedOpponentElo(opp1, opp2)` | RMS opponent ELO |
| `calculateExpectedScore(playerElo, opponentElo)` | Win probability |
| `calculateClassicElo(playerElo, opp1, opp2, didWin)` | New ELO after match |
| `processMatchElo(match, players)` | Apply match to all 4 players |
| `calculateAllEloRankings(matches)` | Compute current rankings + history |
| `getEloHistoryAllTime(matches)` | Timeline: date → player ELO snapshot |
| `getEloHistoryForPeriod(matches, months)` | Filter last N months |
| `getEloHistoryForDateRange(matches, from, to)` | Custom date range |
| `getEloFromEmbeddedMatches(matches, date)` | Read ELO history for latest tournament from embedded match fields |
| `getEloSnapshots(matches)` | Per-player end-of-date snapshots |
| `getEloForDate(snapshots, date)` | ELO + delta at specific date |
| `getEloForMonth(snapshots, yearMonth)` | ELO + delta at end of month |
| `applyTournamentEloToSummary(summary, names, before, after)` | Refresh cached players summary after completion (`js/services/tournament.js`) |
| `generateMonthlyOverviews(yearMonth)` | Generate `players_overview.json` with walk-back ELO seed backfill |

## File References
- **Logic**: `js/services/elo.js`
- **Monthly overview generator**: `js/scripts/generate-monthly-overviews.js`
- **Math tests**: `tests/elo/elo-math.test.js` (RMS, expected score, new ELO)
- **Process tests**: `tests/elo/elo-process.test.js` (match handling, history)
- **Monthly tests**: `tests/elo/elo-monthly.test.js` (date range filtering)
- **Parity tests**: `tests/elo/elo-parity.test.js` (C# compatibility)
- **Monthly overview tests**: `tests/scripts/generate-monthly-overviews.test.js` (seed backfill)
- **Integration test**: `tests/integration/tournament-2026-05-05.test.js` (end-to-end tournament simulation)
