# Player Ranking System

## Logic Flow

Tournament → Match generation → Score tallying → `rankPlayers()` sorts & assigns ranks

1. **Match Generation** (`tournament.js`):
   - `createRound1Matches()`: Groups players by 4, creates initial matches
   - `createMexicanoMatches()`: Takes ranked players, re-seeds by ranking for next round

2. **Score Tallying** (`tournament.js:recalculateAllPlayerStats`):
   - Per completed match: each player gains `teamScore` points, increments `gamesPlayed` & `wins`/`losses`
   - Replays all completed rounds to maintain accurate totals

3. **Ranking** (`ranking.js:rankPlayers`):
   - Sorts players by: `totalPoints DESC` → `wins DESC` → `pointsPerGame DESC` → `name ASC`
   - Mutates rank in-place on sorted array
   - Returns sorted, ranked array

---

## Key Calculations

### Sort Order (Spec)
```
1. totalPoints (descending) - primary metric
2. wins (descending) - tiebreaker
3. pointsPerGame (descending) - consistency metric
4. name (ascending, lexical) - deterministic tiebreaker
```

### Points Per Game (PPG)
```
ppg = totalPoints / gamesPlayed
ppg = 0 if gamesPlayed === 0
```

### Rank Assignment
- **Tied players**: Same `totalPoints` AND same `wins` → same rank
- **Rank gaps**: Next unique ranking uses position index (not dense)
  - Example: `[Rank 1, Rank 1, Rank 3, Rank 4]` (skip rank 2)
  - Logic: `currentRank = i + 1` on rank change

---

## Data Schema

### Player Object
```javascript
{
  id: number,           // 1-indexed player ID
  name: string,         // 1–50 chars, unique (case-insensitive)
  totalPoints: number,  // cumulative score across all games
  wins: number,         // count of won matches
  losses: number,       // count of lost matches
  gamesPlayed: number,  // wins + losses
  rank?: number         // assigned by rankPlayers() (optional, added at ranking time)
}
```

### Ranking Spec
- Mexicano ranking: `points > wins > PPG > name`
- Tied condition: `totalPoints === prevTotalPoints && wins === prevWins`
- Stable sort: `localeCompare()` ensures deterministic name ordering

---

## Edge Cases

| Case | Behavior |
|------|----------|
| **Empty list** | `rankPlayers([])` → return `[]` |
| **Single player** | Rank = 1 |
| **Zero games** | PPG = 0 (no division by zero) |
| **All tied** | All get rank 1 |
| **Name tie at rank N** | Both get rank N, next player gets rank N+count |
| **Score edit** | Triggers `recalculateAllPlayerStats()` → cascade delete later rounds → regenerate next round |

---

## Constraints

- **Stable sort**: `name.localeCompare(b.name)` ensures consistent ordering on ties
- **Non-dense ranking**: Rank gaps reflect tie group size (e.g., 3 tied → gap of 3)
- **In-place mutation**: Sort creates copy, but rank field mutated on sorted array (original unchanged)
- **2v2 match context**: Team 1 = `[player1, player2]`, Team 2 = `[player3, player4]`
  - Match seeding: `[ranked[0], ranked[3]] vs [ranked[1], ranked[2]]`
- **Immutable player refs**: Match objects hold shallow copies of player state at match creation time

---

## File References

- **Core**: `js/services/ranking.js` - `rankPlayers(players)` function
- **Integration**: 
  - `js/services/tournament.js` - match generation, stats recalculation, round advancement
  - `js/components/leaderboard.js` - UI rendering (rank, name, value, sub, change indicators)
- **Flow**: Tournament creation → start → generate matches → score entry → rank → next round → complete
