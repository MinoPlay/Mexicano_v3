# 03 — Tournament Engine Specification

> **Purpose:** Complete, technology-agnostic specification of the Mexicano tournament engine.
> Any developer should be able to implement the system correctly from this document alone.

---

## 1. Mexicano Format Overview

Mexicano is a **dynamic doubles (2v2) tournament format** popular in padel and tennis. Unlike fixed-bracket tournaments, teams change every round based on accumulated performance.

**Core Principles:**
- Players are re-paired each round using current rankings
- **Strongest players pair with weakest players** within each group to create competitive balance
- Each match distributes exactly **25 total points** between two teams
- Unlimited rounds — the tournament continues until manually stopped
- All four players in a match receive points, ensuring continuous stat accumulation

---

## 2. Tournament Configuration

### 2.1 Valid Player Counts

Player count **must** be a multiple of 4, between 4 and 16 inclusive.

| Players | Courts | Matches per Round |
|---------|--------|-------------------|
| 4       | 1      | 1                 |
| 8       | 2      | 2                 |
| 12      | 3      | 3                 |
| 16      | 4      | 4                 |

**Formula:**

```
courts = playerCount / 4
matchesPerRound = playerCount / 4
```

Any other player count is **invalid** and must be rejected at creation time.

### 2.2 Player Name Rules

| Rule                    | Detail                                                    |
|-------------------------|-----------------------------------------------------------|
| Length                  | 1–50 characters after trimming                            |
| Uniqueness             | Case-insensitive; `"alice"` and `"Alice"` are duplicates  |
| Whitespace             | Leading/trailing whitespace is trimmed before validation   |
| Empty names            | Rejected (empty string or whitespace-only)                |

### 2.3 Tournament Constraints

| Constraint             | Detail                                                      |
|------------------------|-------------------------------------------------------------|
| One per date           | Only one tournament may exist for a given calendar date      |
| Editable window        | Tournament is editable when `(today − tournamentDate) ≤ 1 day`; after that it becomes **read-only** |
| Player roster lock     | Players cannot be added or removed after the tournament starts |

---

## 3. Tournament Lifecycle

```
CREATED
  │  Players added (validated: count, uniqueness, name rules)
  │
  ▼
STARTED  (isStarted = true, currentRoundNumber = 1)
  │  Round 1 auto-generated using entry-order pairing
  │
  ├──► Scores entered for all matches in current round
  │      │
  │      ▼
  │    ROUND COMPLETE  (all matches scored, round.completedAt set)
  │      │
  │      ▼
  │    Next round generated using Mexicano pairing
  │      │
  │      └──► (repeat: score → complete → generate)
  │
  ▼
COMPLETED  (manually ended, isCompleted = true)
```

### 3.1 State Transitions — Validation Rules

| Transition                   | Preconditions                                               |
|------------------------------|-------------------------------------------------------------|
| Created → Started            | Player count valid (4, 8, 12, or 16); all names valid       |
| Round N → Round N+1          | All matches in round N are completed (scored)               |
| Started → Completed          | Tournament is started and not already completed             |
| Any score edit               | Tournament is within the editable window (≤ 1 day old)      |
| Add/remove player            | Tournament must **not** be started                          |

---

## 4. Scoring System

### 4.1 Point Distribution

Each match distributes exactly **25 points** total between two teams:

```
team1Score + team2Score = 25     (always enforced)
```

**Constraints:**
- Both scores must be **non-negative integers**
- Sum must equal exactly **25**
- Since 25 is odd and scores are integers, **ties are impossible** — one team always wins

**Individual player points:**
Both players on the same team receive **identical points**. If Team 1 wins 15-10:
- Each Team 1 player receives **15** individual points
- Each Team 2 player receives **10** individual points

### 4.2 Score Validation Pseudocode

```
function validateScores(team1Score, team2Score):
    assert team1Score >= 0
    assert team2Score >= 0
    assert team1Score + team2Score == 25
```

### 4.3 Common Score Presets

For quick score entry, the UI offers preset buttons:

| Preset | Label         |
|--------|---------------|
| 13-12  | Tight game    |
| 15-10  | Standard win  |
| 12-13  | Tight loss    |
| 10-15  | Standard loss |

### 4.4 Win Categories

Win categories classify victories by margin for achievement tracking and statistics:

| Category           | Condition                                | Score Examples       |
|--------------------|------------------------------------------|----------------------|
| **Tight Win**      | Winning score = 13 (margin of 1 point)   | 13-12                |
| **Solid Win**      | Winner scored 15–20 (margin of 5–15)     | 15-10, 18-7, 20-5   |
| **Dominating Win** | Winner scored > 20 (margin of 15+)       | 21-4, 25-0          |

```
function classifyWin(winnerScore, loserScore):
    margin = winnerScore - loserScore
    if margin == 1:          return TIGHT_WIN
    if winnerScore >= 15 AND winnerScore <= 20: return SOLID_WIN
    if winnerScore > 20:     return DOMINATING_WIN
    return UNCLASSIFIED
```

> **Note:** The gap between margin 2–4 (e.g., 14-11) doesn't fall into any named category and is considered an ordinary win.

---

## 5. Player Ranking Algorithm

Players are ranked after each round to determine pairings for the next round.

### 5.1 Sort Criteria (highest to lowest priority)

| Priority | Criterion        | Direction  | Description                            |
|----------|------------------|------------|----------------------------------------|
| 1        | Total Points     | Descending | Sum of all match scores                |
| 2        | Wins             | Descending | Number of matches won                  |
| 3        | Points Per Game  | Descending | `totalPoints / gamesPlayed`            |
| 4        | Name             | Ascending  | Alphabetical — final tiebreaker        |

### 5.2 Tie Handling

Players with **identical TotalPoints AND identical Wins** receive the **same rank**.
The next rank after a tied group **skips** by the number of tied players.

**Example:**

```
Rank 1:  Alice   (50 pts, 3 wins)
Rank 2:  Bob     (45 pts, 2 wins)
Rank 2:  Carol   (45 pts, 2 wins)     ← tied with Bob
Rank 4:  Dave    (40 pts, 1 win)      ← rank skips from 2 to 4
```

### 5.3 Ranking Pseudocode

```
function rankPlayers(players):
    // Step 1: Sort by all criteria
    sorted = players.sortBy(
        totalPoints DESC,
        wins DESC,
        pointsPerGame DESC,
        name ASC
    )

    // Step 2: Group by tie-determining fields
    groups = sorted.groupBy(p => (p.totalPoints, p.wins))
                   .orderBy(totalPoints DESC, wins DESC)

    // Step 3: Assign ranks with skip
    result = []
    currentRank = 1

    for group in groups:
        // Within a tied group, sub-sort by pointsPerGame then name
        for player in group.sortBy(pointsPerGame DESC, name ASC):
            result.add((player, rank: currentRank))

        currentRank += group.size    // skip ranks

    return result
```

---

## 6. Round 1 Pairing Algorithm (Entry-Order Based)

For the **first round**, players have no performance data. They are paired based on their **entry order** (index in the player list), grouped in consecutive sets of 4.

### 6.1 Algorithm

```
function createRound1Matches(players):
    matches = []

    for i = 0 to players.length - 1 step 4:
        group = players[i .. i+3]    // 4 consecutive players

        // Best + Worst vs Middle two (within entry order)
        match = new Match(
            team1: [group[0], group[3]],    // 1st + 4th in group
            team2: [group[1], group[2]]     // 2nd + 3rd in group
        )
        matches.add(match)

    return matches
```

### 6.2 Match Structure Convention

Throughout the system, a match stores four players:

```
Match:
    Player1 + Player2  =  Team 1
    Player3 + Player4  =  Team 2
```

So the mapping from the group is:

```
Player1 = group[0]    (1st in group → Team 1)
Player2 = group[3]    (4th in group → Team 1)
Player3 = group[1]    (2nd in group → Team 2)
Player4 = group[2]    (3rd in group → Team 2)
```

### 6.3 Example — 8 Players

Players entered in order: `[A, B, C, D, E, F, G, H]`

```
Group 1: [A, B, C, D]
  → Match 1:  (A + D)  vs  (B + C)

Group 2: [E, F, G, H]
  → Match 2:  (E + H)  vs  (F + G)
```

**Rationale:** Assumes players are entered roughly by skill level. The 1st player (assumed strongest) is paired with the 4th (assumed weakest) to balance teams.

---

## 7. Mexicano Pairing Algorithm (Rounds 2+)

For **round 2 onwards**, players are ranked by accumulated performance and paired using the Mexicano system.

### 7.1 Algorithm

```
function createMexicanoMatches(rankedPlayers):
    matches = []

    // rankedPlayers is sorted by ranking (best first)
    for i = 0 to rankedPlayers.length - 1 step 4:
        group = rankedPlayers[i .. i+3]

        // Best + Worst vs Middle two (within group)
        match = new Match(
            team1: [group[0], group[3]],    // Rank 1 + Rank 4 in group
            team2: [group[1], group[2]]     // Rank 2 + Rank 3 in group
        )
        matches.add(match)

    return matches
```

### 7.2 Example — 8 Players After Round 1

Ranked by performance: `[1st: Alex, 2nd: Bob, 3rd: Carol, 4th: Dave, 5th: Eve, 6th: Frank, 7th: Grace, 8th: Hank]`

```
Group 1 (ranks 1–4):
  → Match 1:  (Alex + Dave)  vs  (Bob + Carol)

Group 2 (ranks 5–8):
  → Match 2:  (Eve + Hank)  vs  (Frank + Grace)
```

### 7.3 Why This Works

- The **strongest** player compensates for the **weakest** partner in each group
- **Middle-ranked** players are paired together
- **Top group** plays together, **bottom group** plays together
- Over multiple rounds, different combinations emerge naturally as rankings shift

---

## 8. Round Progression

### 8.1 Round Completion

A **match** is complete when its scores sum to 25:

```
function isMatchComplete(match):
    return match.team1Score + match.team2Score == 25
```

A **round** is complete when **all** its matches are complete:

```
function isRoundComplete(round):
    return round.matches.length > 0
       AND round.matches.all(m => isMatchComplete(m))
```

When a round becomes complete, set `round.completedAt = currentTimestamp`.

### 8.2 Starting the Next Round

```
function startNextRound(tournament):
    // Preconditions
    if NOT isRoundComplete(tournament.currentRound):
        ERROR "Current round not yet complete"

    if tournament.isCompleted:
        ERROR "Tournament is already completed"

    // 1. Recalculate all player statistics from scratch
    recalculateAllPlayerStats(tournament)

    // 2. Rank players using updated stats
    rankedPlayers = rankPlayers(tournament.players)

    // 3. Generate new matches using Mexicano pairing
    newMatches = createMexicanoMatches(rankedPlayers)

    // 4. Increment round number
    tournament.currentRoundNumber += 1

    // 5. Create and add the new round
    newRound = new Round(
        roundNumber: tournament.currentRoundNumber,
        matches: newMatches
    )
    tournament.rounds.add(newRound)

    // 6. Persist all new matches to storage
    for match in newMatches:
        syncToStorage(match, tournament)
```

---

## 9. Statistics Recalculation

Player statistics are **always recalculated from scratch** — never incrementally updated. This ensures consistency after score edits.

### 9.1 When to Recalculate

- After **any score update** (single or bulk)
- Before **generating a new round** (to get accurate rankings)
- When **loading a tournament** from storage

### 9.2 Algorithm

```
function recalculateAllPlayerStats(tournament):
    // Step 1: Reset all player statistics to zero
    for player in tournament.players:
        player.totalPoints   = 0
        player.gamesPlayed   = 0
        player.wins          = 0
        player.losses        = 0

    // Step 2: Replay every completed match across all rounds
    for round in tournament.rounds:
        for match in round.matches:
            if NOT isMatchComplete(match):
                continue

            // Add scores to team 1 players
            match.player1.addScore(match.team1Score)    // totalPoints += score; gamesPlayed++
            match.player2.addScore(match.team1Score)

            // Add scores to team 2 players
            match.player3.addScore(match.team2Score)
            match.player4.addScore(match.team2Score)

            // Track wins and losses
            if match.team1Score > match.team2Score:
                match.player1.addWin()
                match.player2.addWin()
                match.player3.addLoss()
                match.player4.addLoss()
            else:
                match.player3.addWin()
                match.player4.addWin()
                match.player1.addLoss()
                match.player2.addLoss()
```

### 9.3 Derived Statistics

These are computed from the base stats, not stored independently:

```
pointsPerGame  = gamesPlayed > 0  ?  totalPoints / gamesPlayed  :  0
winPercentage  = gamesPlayed > 0  ?  (wins / gamesPlayed) × 100  :  0
```

### 9.4 Skipping Unplayed Matches

Matches with **both scores at 0** (`team1Score == 0 AND team2Score == 0`) are treated as **not yet played** and excluded from statistics. This is distinct from the `isCompleted` check (which requires the sum to equal 25), but both guards serve the same purpose: only process matches that have been scored.

---

## 10. Score Editing & Cascade Regeneration

### 10.1 Edit Permissions

Score editing is controlled by two rules:

| Rule                | Condition                                                    |
|---------------------|--------------------------------------------------------------|
| **Time window**     | Tournament is within the editable window (≤ 1 day old)       |
| **Round proximity** | Can only edit current round or the immediately previous round |

### 10.2 Editing Current Round

When a score in the **current round** is changed:

1. Update the match scores
2. Persist the match to storage
3. Recalculate all player statistics
4. Check if the round is now complete

No cascade is needed because no subsequent rounds depend on this round's scores yet.

### 10.3 Editing a Previous Round (Cascade)

When a score in a **previous round** (roundNumber < currentRoundNumber) is changed, all subsequent rounds must be **deleted and regenerated** because rankings change.

```
function editMatchScore(tournament, roundNumber, matchId, newTeam1Score, newTeam2Score):
    // Validate
    assert newTeam1Score + newTeam2Score == 25
    assert tournament.isEditable

    // Update the match score
    match = tournament.getMatch(roundNumber, matchId)
    match.setScores(newTeam1Score, newTeam2Score)

    // Persist the edited match
    syncToStorage(match, tournament)

    // If editing a PREVIOUS round (not current):
    if roundNumber < tournament.currentRoundNumber:
        originalCurrentRound = tournament.currentRoundNumber

        // Delete all rounds AFTER the edited round from storage
        for round in tournament.rounds where round.roundNumber > roundNumber:
            for match in round.matches:
                deleteFromStorage(match, tournament)

        // Remove subsequent rounds from in-memory tournament
        tournament.removeRoundsAfter(roundNumber)

        // Recalculate all player stats from remaining rounds
        recalculateAllPlayerStats(tournament)

        // If there were rounds beyond the edited round, regenerate one
        if originalCurrentRound > roundNumber:
            rankedPlayers = rankPlayers(tournament.players)
            newMatches = createMexicanoMatches(rankedPlayers)

            newRound = new Round(
                roundNumber: roundNumber + 1,
                matches: newMatches
            )
            tournament.rounds.add(newRound)
            tournament.currentRoundNumber = roundNumber + 1

            // Persist the regenerated matches
            for match in newMatches:
                syncToStorage(match, tournament)
    else:
        // Editing current round — just recalculate stats
        recalculateAllPlayerStats(tournament)
```

### 10.4 Why Cascade?

Pairings for round N+1 depend on rankings after round N. If round N's scores change:
- Player rankings change
- Round N+1 would have **different pairings**
- All rounds after N+1 would also be different

Therefore, **all subsequent rounds are invalid** and must be removed. Only one new round is regenerated (the next one), allowing the tournament to continue from there.

### 10.5 Example

```
Before edit:
  Round 1: Complete (scores finalized)
  Round 2: Complete
  Round 3: In progress (current round)

User edits a match score in Round 1:
  Round 1: Complete (with updated score)
  Round 2: DELETED and regenerated with new rankings
  Round 3: DELETED entirely
  Current round: now 2
```

---

## 11. Tournament Data Persistence

### 11.1 What Is Persisted

Only individual **match entities** are saved to storage — not full tournament objects. The tournament state is reconstructed by loading all matches for a given date.

### 11.2 Match Entity Schema

| Field               | Type            | Description                                  |
|---------------------|-----------------|----------------------------------------------|
| `partitionKey`      | string          | Always `"match"`                             |
| `rowKey`            | string          | Unique key: `"{date}_R{round}M{matchIndex}"` |
| `roundNumber`       | int             | Round number (1-based)                       |
| `team1Player1Name`  | string          | Player 1 of Team 1                          |
| `team1Player2Name`  | string          | Player 2 of Team 1                          |
| `team2Player1Name`  | string          | Player 1 of Team 2                          |
| `team2Player2Name`  | string          | Player 2 of Team 2                          |
| `scoreTeam1`        | int             | Team 1 score (0–25)                          |
| `scoreTeam2`        | int             | Team 2 score (0–25)                          |
| `date`              | string          | Tournament date in `yyyy-MM-dd` format       |
| `timestamp`         | DateTimeOffset  | Auto-set by storage provider                 |

### 11.3 Row Key Format

```
"{tournamentDate:yyyy-MM-dd}_R{roundNumber}M{matchIndexInRound}"
```

**Examples:**
- `"2026-02-05_R1M1"` — Round 1, Match 1
- `"2026-02-05_R2M3"` — Round 2, Match 3

The match index is **1-based** within each round.

### 11.4 Saving a Match

```
function saveMatch(match, tournament):
    matchIndex = match.indexWithinRound + 1    // 1-based
    rowKey = "{tournament.date:yyyy-MM-dd}_R{match.roundNumber}M{matchIndex}"

    entity = new MatchEntity(
        partitionKey: "match",
        rowKey: rowKey,
        roundNumber: match.roundNumber,
        team1Player1Name: match.player1.name,
        team1Player2Name: match.player2.name,
        team2Player1Name: match.player3.name,
        team2Player2Name: match.player4.name,
        scoreTeam1: match.team1Score,
        scoreTeam2: match.team2Score,
        date: formatDate(tournament.tournamentDate, "yyyy-MM-dd")
    )

    storage.upsert(entity)
```

### 11.5 Loading a Tournament (Reconstruction)

```
function loadTournament(date):
    // 1. Fetch all match entities for this date
    matchEntities = storage.getMatchesByDate(date)

    if matchEntities.isEmpty:
        return null

    // 2. Extract unique player names
    playerNames = matchEntities
        .flatMap(m => [m.team1Player1Name, m.team1Player2Name,
                       m.team2Player1Name, m.team2Player2Name])
        .distinct()

    // 3. Create player objects
    players = playerNames.map(name => new Player(name))

    // 4. Group match entities by round number
    roundGroups = matchEntities.groupBy(m => m.roundNumber)
                               .orderBy(roundNumber ASC)

    // 5. Build rounds and matches (linking to player objects)
    rounds = []
    for (roundNumber, matchGroup) in roundGroups:
        round = new Round(roundNumber: roundNumber)
        for entity in matchGroup:
            match = new Match(
                roundNumber: roundNumber,
                player1: players.find(entity.team1Player1Name),
                player2: players.find(entity.team1Player2Name),
                player3: players.find(entity.team2Player1Name),
                player4: players.find(entity.team2Player2Name)
            )
            if entity.scoreTeam1 + entity.scoreTeam2 == 25:
                match.setScores(entity.scoreTeam1, entity.scoreTeam2)
            round.addMatch(match)
        rounds.add(round)

    // 6. Assemble tournament
    tournament = new Tournament(
        date: date,
        players: players,
        rounds: rounds,
        currentRoundNumber: max(roundGroups.keys),
        isStarted: true
    )

    // 7. Recalculate all statistics from loaded matches
    recalculateAllPlayerStats(tournament)

    return tournament
```

---

## 12. Edge Cases & Validation Rules

### 12.1 Comprehensive Rule List

| #  | Rule                                         | Detail                                                                 |
|----|----------------------------------------------|------------------------------------------------------------------------|
| 1  | Valid player count                           | Must be exactly 4, 8, 12, or 16                                        |
| 2  | Unique player names                          | Case-insensitive comparison; duplicates rejected                        |
| 3  | Player name length                           | 1–50 characters after trimming; empty/whitespace-only rejected          |
| 4  | Score integrity                              | Non-negative integers; `team1Score + team2Score == 25`                  |
| 5  | Round completion required                    | Cannot start next round until all current round matches are scored      |
| 6  | Player roster lock                           | Cannot add or remove players after tournament starts                    |
| 7  | Editable time window                         | Tournament becomes read-only after 1 day past the tournament date       |
| 8  | One tournament per date                      | Only one tournament allowed per calendar date                           |
| 9  | Cascade on previous round edit               | Editing a previous round's scores deletes and regenerates all later rounds |
| 10 | Unplayed match handling                      | Matches with `0-0` scores are treated as unplayed and excluded from stats |

### 12.2 Impossible States

- **Tie score:** Since scores are integers summing to 25 (odd), ties cannot occur. The closest scores are 13-12 and 12-13.
- **Score of 0-0 as completed:** A match with `0 + 0 ≠ 25` is never considered complete.
- **Negative round number:** Rounds are 1-based and increment sequentially.

### 12.3 Match ID Generation

Match IDs are **sequential integers** starting at 1, incrementing for each new match within a tournament. IDs reset to 1 when a new tournament is created.

### 12.4 Date Handling

All dates are stored and compared in **UTC** to ensure consistency across time zones:

```
tournamentDate = specifyKind(dateValue, UTC)
```

---

## Appendix A: Complete 8-Player Walkthrough

### Setup

8 players entered in order: `[Alice, Bob, Carol, Dave, Eve, Frank, Grace, Hank]`

### Round 1 (Entry-Order Pairing)

```
Group 1: [Alice, Bob, Carol, Dave]
  Match 1: (Alice + Dave) vs (Bob + Carol)     → Court 1

Group 2: [Eve, Frank, Grace, Hank]
  Match 2: (Eve + Hank) vs (Frank + Grace)     → Court 2
```

### Round 1 Results

```
Match 1: (Alice + Dave) 15 – 10 (Bob + Carol)
Match 2: (Eve + Hank) 13 – 12 (Frank + Grace)
```

### Individual Points After Round 1

| Player | Points | Wins | Losses | PPG  |
|--------|--------|------|--------|------|
| Alice  | 15     | 1    | 0      | 15.0 |
| Dave   | 15     | 1    | 0      | 15.0 |
| Eve    | 13     | 1    | 0      | 13.0 |
| Hank   | 13     | 1    | 0      | 13.0 |
| Frank  | 12     | 0    | 1      | 12.0 |
| Grace  | 12     | 0    | 1      | 12.0 |
| Bob    | 10     | 0    | 1      | 10.0 |
| Carol  | 10     | 0    | 1      | 10.0 |

### Rankings After Round 1

```
Rank 1: Alice  (15 pts, 1 win)
Rank 1: Dave   (15 pts, 1 win)    ← tied with Alice
Rank 3: Eve    (13 pts, 1 win)
Rank 3: Hank   (13 pts, 1 win)    ← tied with Eve
Rank 5: Frank  (12 pts, 0 wins)
Rank 5: Grace  (12 pts, 0 wins)   ← tied with Frank
Rank 7: Bob    (10 pts, 0 wins)
Rank 7: Carol  (10 pts, 0 wins)   ← tied with Bob
```

Within tied groups, sub-sorted by PPG (same here), then name alphabetically.

### Round 2 (Mexicano Pairing)

Using the ordered ranking: `[Alice, Dave, Eve, Hank, Frank, Grace, Bob, Carol]`

```
Group 1 (ranks 1–4): [Alice, Dave, Eve, Hank]
  Match 1: (Alice + Hank) vs (Dave + Eve)      → Court 1

Group 2 (ranks 5–8): [Frank, Grace, Bob, Carol]
  Match 2: (Frank + Carol) vs (Grace + Bob)     → Court 2
```

The tournament continues in this pattern indefinitely.

---

## Appendix B: Data Flow Summary

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│  Score Input │────►│  Validate    │────►│  Update Match  │
└─────────────┘     │  (sum = 25)  │     │  Scores        │
                    └──────────────┘     └───────┬────────┘
                                                 │
                                    ┌────────────┴────────────┐
                                    │                         │
                              Current Round?            Previous Round?
                                    │                         │
                                    ▼                         ▼
                            ┌──────────────┐     ┌────────────────────┐
                            │ Recalculate  │     │ Delete subsequent  │
                            │ Player Stats │     │ rounds from storage│
                            └──────┬───────┘     └─────────┬──────────┘
                                   │                       │
                                   │              ┌────────▼──────────┐
                                   │              │ Remove rounds     │
                                   │              │ from tournament   │
                                   │              └────────┬──────────┘
                                   │                       │
                                   │              ┌────────▼──────────┐
                                   │              │ Recalculate stats │
                                   │              └────────┬──────────┘
                                   │                       │
                                   │              ┌────────▼──────────┐
                                   │              │ Rank players      │
                                   │              └────────┬──────────┘
                                   │                       │
                                   │              ┌────────▼──────────┐
                                   │              │ Generate new round│
                                   │              │ (Mexicano pairing)│
                                   │              └────────┬──────────┘
                                   │                       │
                                   ▼                       ▼
                            ┌──────────────────────────────────┐
                            │      Persist to Storage          │
                            └──────────────────────────────────┘
```
