# 04 — ELO Rating System, Player Statistics & Achievements

> Technology-agnostic specification of the ELO rating system, player statistics calculations, and the achievement system. Contains exact mathematical formulas and pseudocode sufficient to reproduce every calculation.

---

## 1. ELO Rating System

### 1.1 Overview

- Based on the standard **Elo rating system** (originally developed for chess by Arpad Elo).
- **Initial rating** for all new players: **1000**.
- **K-factor**: **32** (constant, same for all players regardless of rating or experience).
- Two variants are supported:
  - **Classic ELO** — binary win/loss outcome.
  - **Scored ELO** — uses the score ratio (margin of victory matters).
- ELO values are **rounded to 2 decimal places** after each update.
- Matches with a score of **0–0 are skipped** (treated as unplayed).

### 1.2 Core ELO Formula

The standard Elo expected-score and update formulas:

```
ExpectedScore = 1 / (1 + 10^((OpponentELO − PlayerELO) / 400))

NewELO = OldELO + K × (ActualScore − ExpectedScore)
```

Where:

| Symbol | Value / Meaning |
|---|---|
| `K` | 32 |
| `ActualScore` | Depends on variant (see §1.4, §1.5) |
| `ExpectedScore` | Probability of winning based on rating difference |
| `OpponentELO` | Combined opponent ELO (see §1.3) |

### 1.3 Combined Opponent ELO (Team Calculation)

Because Mexicano is a **2 v 2** game, each player faces two opponents. Their combined strength is represented as the **Root Mean Square (RMS)** of the two opponent ratings:

```
CombinedOpponentELO = √( (Opponent1ELO² + Opponent2ELO²) / 2 )
```

**Derivation from the code:**

```
// Step 1 — square each opponent's ELO
squaredElos = [opponent1.ELO², opponent2.ELO²]

// Step 2 — compute RMS
combinedElo = √( sum(squaredElos) / 2 )
            = √( (opponent1.ELO² + opponent2.ELO²) / 2 )
```

> **Why RMS?** RMS weights higher-rated opponents more heavily than a simple average, reflecting that facing one very strong opponent and one weak opponent is harder than facing two average opponents of the same mean rating.

**Numerical example:**

| Opponent 1 ELO | Opponent 2 ELO | Arithmetic Mean | Geometric Mean | **RMS (used)** |
|---|---|---|---|---|
| 1200 | 800 | 1000.00 | 979.80 | **1019.80** |
| 1000 | 1000 | 1000.00 | 1000.00 | **1000.00** |
| 1400 | 600 | 1000.00 | 916.52 | **1077.03** |

### 1.4 Classic ELO Variant

Uses a **binary** actual score — only win or loss matters:

```
function calculateClassicELO(playerELO, opponent1ELO, opponent2ELO, didWin):
    actualScore = 1.0 if didWin else 0.0

    opponentELO = sqrt((opponent1ELO² + opponent2ELO²) / 2)
    expectedScore = 1 / (1 + 10^((opponentELO − playerELO) / 400))

    newELO = round(playerELO + 32 × (actualScore − expectedScore), 2)
    return newELO
```

### 1.5 Scored ELO Variant

Uses the **score ratio** as the actual score, so margin of victory is rewarded:

```
function calculateScoredELO(playerELO, opponent1ELO, opponent2ELO, teamScore, opponentTeamScore):
    totalPoints = teamScore + opponentTeamScore      // e.g. 15 + 10 = 25
    actualScore = teamScore / totalPoints             // e.g. 15/25 = 0.60

    opponentELO = sqrt((opponent1ELO² + opponent2ELO²) / 2)
    expectedScore = 1 / (1 + 10^((opponentELO − playerELO) / 400))

    newELO = round(playerELO + 32 × (actualScore − expectedScore), 2)
    return newELO
```

**Key difference:** Classic ELO only distinguishes win from loss. Scored ELO rewards margin of victory — winning 20–5 produces a larger rating gain than winning 13–12.

### 1.6 Full Match ELO Processing

Each match involves 4 players in two teams. ELO updates use the **pre-match** ratings of all players (updates are applied in sequence within a match, meaning P2's update uses P1's already-updated rating within the same match):

```
function processMatchELO(match, players, scoreFunc):
    // Skip unplayed matches
    if match.scoreTeam1 == 0 AND match.scoreTeam2 == 0:
        return

    // Get or create player records (default ELO = 1000)
    p1 = getOrCreate(players, match.team1Player1)
    p2 = getOrCreate(players, match.team1Player2)
    p3 = getOrCreate(players, match.team2Player1)
    p4 = getOrCreate(players, match.team2Player2)

    // Update each player's ELO (sequentially, in this order)
    p1.elo = calculateELO(p1.elo, [p3, p4], match, scoreFunc)
    p2.elo = calculateELO(p2.elo, [p3, p4], match, scoreFunc)
    p3.elo = calculateELO(p3.elo, [p1, p2], match, scoreFunc)
    p4.elo = calculateELO(p4.elo, [p1, p2], match, scoreFunc)

    // Record history
    p1.history.add((match, p1.elo, match.roundNumber))
    p2.history.add((match, p2.elo, match.roundNumber))
    p3.history.add((match, p3.elo, match.roundNumber))
    p4.history.add((match, p4.elo, match.roundNumber))
```

> **Important implementation detail:** Players are updated sequentially within a match. This means player 2's ELO calculation sees player 1's already-updated rating. This is an intentional design choice from the codebase.

### 1.7 Match Ordering

Matches are processed in a **deterministic order** using a composite sort key:

```
sortKey = "{date}.{roundNumber:00}"    // e.g. "2024-03-15.03"
```

- Primary sort: tournament date (ascending, string comparison on `yyyy-MM-dd` format)
- Secondary sort: round number (ascending, zero-padded to 2 digits)

### 1.8 ELO History — All-Time

Tracks ELO snapshots at the **end of each tournament** for all players:

```
function getEloHistoryAllTime(allMatches):
    players = {}                // name → Player (with ELO, history)
    eloHistory = {}             // name → [(date, elo), ...]

    // Exclude unplayed matches, group by date, sort chronologically
    playedMatches = allMatches.filter(m => m.scoreTeam1 != 0 OR m.scoreTeam2 != 0)
    tournaments = playedMatches
        .orderBy("{date}.{roundNumber:00}")
        .groupBy(date)
        .orderBy(date ASC)

    for each tournament in tournaments:
        playersInTournament = new Set()

        // Process every match in this tournament (ordered by round)
        for each match in tournament.matches.orderBy(roundNumber ASC):
            processMatchELO(match, players, classicScoreFunc)
            playersInTournament.add(all 4 player names from match)

        // Snapshot each participant's ELO after the tournament
        tournamentDate = parseDate(tournament.date)
        for each name in playersInTournament:
            eloHistory[name].add((tournamentDate, players[name].elo))

    return eloHistory
```

### 1.9 ELO History — Per-Tournament (Round-by-Round)

Shows ELO progression through the **latest tournament**, round by round:

```
function getEloHistoryForLatestTournament(allMatches):
    playedMatches = allMatches.filter(m => m.scoreTeam1 != 0 OR m.scoreTeam2 != 0)
    latestDate = max(playedMatches.map(m => m.date))
    latestTournament = playedMatches.filter(m => m.date == latestDate)
    priorMatches = playedMatches.filter(m => m.date < latestDate)

    // Step 1 — Compute starting ELOs from all prior tournaments
    players = {}
    for each match in priorMatches.orderBy("{date}.{roundNumber:00}"):
        processMatchELO(match, players, classicScoreFunc)

    startingElos = {name: player.elo for (name, player) in players}

    // Step 2 — Initialize tournament players with starting ELOs
    tournamentPlayers = {}
    for each name in latestTournament.allUniquePlayerNames():
        tournamentPlayers[name] = new Player(
            name = name,
            elo = startingElos[name] if name in startingElos else 1000
        )

    // Step 3 — Record Round 0 (starting point)
    history = {}   // name → [(date, elo, roundNumber), ...]
    tournamentDate = parseDate(latestDate)
    for each name in tournamentPlayers:
        history[name] = [(tournamentDate, tournamentPlayers[name].elo, 0)]

    // Step 4 — Process matches round by round
    for each match in latestTournament.orderBy(roundNumber ASC):
        processMatchELO(match, tournamentPlayers, classicScoreFunc)
        // Append updated ELOs to history
        for each updated player:
            history[player.name].add((tournamentDate, player.elo, match.roundNumber))

    return history
```

### 1.10 ELO Change Tracking

The "change" value shown next to a player's rating is the difference between their current ELO and their ELO at the end of the **previous tournament day**:

```
function calculateEloChange(player):
    // Group history by tournament date, take the last entry per tournament
    tournamentSnapshots = player.history
        .groupBy(entry => entry.match.date)
        .orderBy(date ASC)
        .map(group => group.orderByDesc(round).first())   // last round of each tournament

    if tournamentSnapshots.count <= 1:
        // First tournament or no history — change relative to initial 1000
        previousELO = 1000
    else:
        previousELO = tournamentSnapshots[count − 2].elo

    return round(player.elo − previousELO, 2)
```

**Granularity note:** `PreviousELO` always refers to the previous **tournament day**, not the previous calendar month. When `players.json` is generated by `generatePlayersJson()`, `PreviousELO` is derived from the per-day `ELO` arrays in each month's `players_overview.json`. If a player plays twice in the same month (e.g., Apr 28 and Apr 30), `PreviousELO` is their ELO after Apr 28, not their ELO at the end of the previous month.

### 1.11 ELO Rankings Leaderboard

```
function getEloRankings(players):
    return players
        .orderByDesc(elo)
        .mapWithIndex((player, index) => {
            place:  index + 1,
            name:   player.name,
            elo:    player.elo,          // already rounded to 2dp
            change: calculateEloChange(player)
        })
```

**Output model:**

| Field | Type | Description |
|---|---|---|
| `place` | int | 1-based ranking position |
| `name` | string | Player name |
| `elo` | float | Current ELO (2 decimal places) |
| `change` | float | ELO change since previous tournament |

---

## 2. Player Statistics

### 2.1 Per-Tournament Statistics Model

```
PlayerStatistics:
    rank:           int       // 1-based position in this dataset
    name:           string    // player name
    wins:           int       // total matches won
    losses:         int       // total matches lost
    points:         int       // total points scored (sum of team scores)
    average:        float     // points per game  = points / gamesPlayed
    winRate:        float     // win fraction      = wins / gamesPlayed  (0.0–1.0)
    change:         float     // ranking change vs previous period (set by caller)
    tightWins:      int       // wins with score 13–12
    tightLosses:    int       // losses with score 12–13
    solidWins:      int       // wins with winning score in range [15, 20]
    dominatingWins: int       // wins with winning score > 20
```

### 2.2 Statistics Calculation

```
function calculatePlayerStatistics(matches):
    stats = {}   // name → PlayerStatistics

    for each match in matches:
        // Skip unplayed matches
        if match.scoreTeam1 == 0 AND match.scoreTeam2 == 0:
            continue

        team1Won = match.scoreTeam1 > match.scoreTeam2

        // Process Team 1 players
        processPlayer(stats, match.team1Player1, match.scoreTeam1, team1Won)
        processPlayer(stats, match.team1Player2, match.scoreTeam1, team1Won)

        // Process Team 2 players
        processPlayer(stats, match.team2Player1, match.scoreTeam2, NOT team1Won)
        processPlayer(stats, match.team2Player2, match.scoreTeam2, NOT team1Won)

    // Compute derived fields
    for each s in stats.values():
        gamesPlayed = s.wins + s.losses
        s.average = gamesPlayed > 0 ? s.points / gamesPlayed : 0
        s.winRate = gamesPlayed > 0 ? s.wins / gamesPlayed   : 0
        s.change  = 0   // placeholder — set by caller based on prior period

    // Rank: primary = average (desc), secondary = winRate (desc)
    ranked = stats.values()
        .orderByDesc(average)
        .thenByDesc(winRate)
    for i = 0 to ranked.length − 1:
        ranked[i].rank = i + 1

    return ranked


function processPlayer(stats, playerName, teamScore, won):
    s = stats.getOrCreate(playerName, default = new PlayerStatistics(name = playerName))
    s.points += teamScore

    if won:
        s.wins += 1
    else:
        s.losses += 1
```

### 2.3 Win Classification

Wins are categorized by the **winning team's score** (in a standard game where scores sum to 25):

| Category | Winning Score | Score Line | Description |
|---|---|---|---|
| **Tight Win** | 13 | 13–12 | Closest possible victory |
| *(Normal Win)* | 14 | 14–11 | Not assigned to a named category |
| **Solid Win** | 15–20 | e.g. 17–8, 20–5 | Clear margin of victory |
| **Dominating Win** | 21+ | e.g. 22–3, 25–0 | Overwhelming victory |

```
function classifyWin(winningScore):
    if winningScore == 13:       return TIGHT_WIN
    if winningScore >= 15 AND winningScore <= 20: return SOLID_WIN
    if winningScore > 20:        return DOMINATING_WIN
    return NORMAL_WIN            // winningScore == 14
```

> **Note:** Tight losses (12–13) are also tracked as `tightLosses` in the statistics model.

### 2.4 Head-to-Head Statistics (Opponent Stats)

Tracks how a player performs **against** each opponent across all matches:

```
OpponentStatistic:
    opponentName:    string
    gamesPlayed:     int
    wins:            int
    losses:          int
    winRate:         float     // wins / gamesPlayed
    pointsFor:       int      // total points scored by player's team
    pointsAgainst:   int      // total points scored by opponent's team
```

```
function calculateOpponentStats(playerName, allMatches):
    opponents = {}   // opponentName → OpponentStatistic

    for each match involving playerName:
        playerTeamScore = getPlayerTeamScore(match, playerName)
        opponentTeamScore = getOpponentTeamScore(match, playerName)
        won = playerTeamScore > opponentTeamScore

        for each opponentName in getOpponents(match, playerName):
            o = opponents.getOrCreate(opponentName)
            o.gamesPlayed += 1
            o.pointsFor += playerTeamScore
            o.pointsAgainst += opponentTeamScore
            if won: o.wins += 1
            else:   o.losses += 1

    for each o in opponents.values():
        o.winRate = o.wins / o.gamesPlayed

    return opponents
```

### 2.5 Partnership Statistics

Tracks how a player performs **with** each partner:

```
PartnershipStatistic:
    partnerName:          string
    gamesPlayed:          int
    wins:                 int
    losses:               int
    winRate:              float
    averagePointsPerGame: float
```

```
function calculatePartnershipStats(playerName, allMatches):
    partners = {}   // partnerName → PartnershipStatistic

    for each match involving playerName:
        partnerName = getPartner(match, playerName)
        teamScore = getPlayerTeamScore(match, playerName)
        won = teamScore > getOpponentTeamScore(match, playerName)

        p = partners.getOrCreate(partnerName)
        p.gamesPlayed += 1
        p.totalPoints += teamScore
        if won: p.wins += 1
        else:   p.losses += 1

    for each p in partners.values():
        p.winRate = p.wins / p.gamesPlayed
        p.averagePointsPerGame = p.totalPoints / p.gamesPlayed

    return partners
```
---

## 4. Player Summary Aggregation

Player summaries are the **lifetime aggregate** of a player's performance across all tournaments. They serve as the input to the achievement evaluation system.

### 4.1 Player Summary Model

```
PlayerSummary:
    playerName:          string
    totalTournaments:    int      // number of distinct tournament dates attended
    totalWins:           int      // total match wins across all tournaments
    totalLosses:         int      // total match losses across all tournaments
    tightWins:           int      // wins with score 13–12
    solidWins:           int      // wins with winning score 15–20
    dominatingWins:      int      // wins with winning score 21+
    firstPlaceFinishes:  int      // times ranked 1st in a tournament
    secondPlaceFinishes: int      // times ranked 2nd in a tournament
    thirdPlaceFinishes:  int      // times ranked 3rd in a tournament
```

### 4.2 Summary Generation

```
function generatePlayerSummary(playerName, allMatches):
    playerMatches = allMatches.filter(m => m.involvesPlayer(playerName))
    tournaments = playerMatches.groupBy(date)

    summary = new PlayerSummary(playerName)
    summary.totalTournaments = tournaments.count

    for each tournament in tournaments:
        // Determine tournament placement
        finalRankings = calculatePlayerStatistics(tournament.matches)
        placement = finalRankings.find(r => r.name == playerName).rank

        if placement == 1: summary.firstPlaceFinishes += 1
        if placement == 2: summary.secondPlaceFinishes += 1
        if placement == 3: summary.thirdPlaceFinishes += 1

        for each match in tournament.matches where match.involvesPlayer(playerName):
            teamScore = getPlayerTeamScore(match, playerName)
            opponentScore = getOpponentTeamScore(match, playerName)

            if teamScore > opponentScore:
                summary.totalWins += 1
                winType = classifyWin(teamScore)    // see §2.3
                if winType == TIGHT_WIN:       summary.tightWins += 1
                if winType == SOLID_WIN:       summary.solidWins += 1
                if winType == DOMINATING_WIN:  summary.dominatingWins += 1
            else:
                summary.totalLosses += 1

    return summary
```

### 4.3 Helper Functions

```
function involvesPlayer(match, playerName):
    return playerName in [
        match.team1Player1,
        match.team1Player2,
        match.team2Player1,
        match.team2Player2
    ]

function getPlayerTeamScore(match, playerName):
    if playerName == match.team1Player1 OR playerName == match.team1Player2:
        return match.scoreTeam1
    else:
        return match.scoreTeam2

function getOpponentTeamScore(match, playerName):
    if playerName == match.team1Player1 OR playerName == match.team1Player2:
        return match.scoreTeam2
    else:
        return match.scoreTeam1

function getPartner(match, playerName):
    if playerName == match.team1Player1: return match.team1Player2
    if playerName == match.team1Player2: return match.team1Player1
    if playerName == match.team2Player1: return match.team2Player2
    if playerName == match.team2Player2: return match.team2Player1

function getOpponents(match, playerName):
    if playerName == match.team1Player1 OR playerName == match.team1Player2:
        return [match.team2Player1, match.team2Player2]
    else:
        return [match.team1Player1, match.team1Player2]
```

---

## 5. Data Model Reference

### 5.1 Match Entity

| Field | Type | Description |
|---|---|---|
| `roundNumber` | int | Round number within the tournament |
| `team1Player1Name` | string | First player on team 1 |
| `team1Player2Name` | string | Second player on team 1 |
| `team2Player1Name` | string | First player on team 2 |
| `team2Player2Name` | string | Second player on team 2 |
| `scoreTeam1` | int | Points scored by team 1 |
| `scoreTeam2` | int | Points scored by team 2 |
| `date` | string | Tournament date in `yyyy-MM-dd` format |

> **Convention:** A match with `scoreTeam1 == 0 AND scoreTeam2 == 0` is treated as unplayed and skipped in all calculations.
