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

### Match Object (input)
```json
{
  "team1Player1Name": "Alice",
  "team1Player2Name": "Bob",
  "team2Player1Name": "Carol",
  "team2Player2Name": "Dave",
  "scoreTeam1": 10,
  "scoreTeam2": 5,
  "date": "2024-01-15",
  "roundNumber": 1
}
```

## Edge Cases & Behaviors

- **New players**: Auto-created, start at ELO 1000
- **Ties (0-0 matches)**: Filtered out, no ELO change
- **Sequential updates**: Team1 players updated first (with initial team2 ELOs), then team2 (with updated team1 ELOs)
- **Same-team ELO**: Team1P1 and Team1P2 finish equal (same opponents before processing)
- **Sorting**: Matches sorted by `date.roundNumber` (e.g., "2024-01-01.02")
- **Rounding**: All ELO values to 2 decimals

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
| `getEloHistoryForLatestTournament(matches, playerNames)` | Latest tournament rounds |
| `getEloSnapshots(matches)` | Per-player end-of-date snapshots |
| `getEloForDate(snapshots, date)` | ELO + delta at specific date |
| `getEloForMonth(snapshots, yearMonth)` | ELO + delta at end of month |

## File References
- **Logic**: `js/services/elo.js`
- **Math tests**: `tests/elo/elo-math.test.js` (RMS, expected score, new ELO)
- **Process tests**: `tests/elo/elo-process.test.js` (match handling, history)
- **Monthly tests**: `tests/elo/elo-monthly.test.js` (date range filtering)
- **Parity tests**: `tests/elo/elo-parity.test.js` (C# compatibility)
