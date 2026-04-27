# Tournament Management

## Logic Flow

**User creates tournament** → **System generates rounds 1-3** → **Players enter match scores** → **Round completes** → **Proceed to next round**

1. **Create Phase**: User specifies date (yyyy-MM-dd) and player list (4, 8, 12, or 16 players). Players initialized with zero stats.
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
  players: [
    { id, name, totalPoints, gamesPlayed, wins, losses }
  ],
  rounds: [
    {
      roundNumber: 1|2|3,
      matches: [
        {
          id, roundNumber, player1, player2, player3, player4,
          team1Score, team2Score, completedAt
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

## Edge Cases & Constraints

### Edge Cases
- **Incomplete final group**: Fewer than 4 players in last group → skipped (match not created).
- **Tied scores**: Both teams score same cumulative points (e.g., 13-12) → valid, both get credited.
- **Mid-tournament edit (< 24h)**: Editing previous round score cascades: delete later rounds, recalculate stats, auto-regenerate if round now complete.
- **Player removal**: Not explicitly handled; current schema assumes fixed player list per tournament.

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
