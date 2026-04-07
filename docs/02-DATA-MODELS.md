# Data Models Specification

> **Technology-agnostic data model specification for the Mexicano Tournament Management application.**
> Defines every entity, field, relationship, and storage pattern needed to implement the app in any tech stack.

---

## Table of Contents

- [1. Entity Specifications](#1-entity-specifications)
  - [1.1 Tournament](#11-tournament)
  - [1.2 Player (Tournament-Scoped)](#12-player-tournament-scoped)
  - [1.3 Match](#13-match)
  - [1.4 Round](#14-round)
  - [1.5 MatchEntity (Persistence Model)](#15-matchentity-persistence-model)
  - [1.6 PlayerSummary (All-Time Statistics)](#16-playersummary-all-time-statistics)
  - [1.7 PlayerStatistics (Period Statistics)](#17-playerstatistics-period-statistics)
  - [1.8 PlayerRanking (ELO)](#18-playerranking-elo)
  - [1.9 DoodleEntry (Scheduling)](#19-doodleentry-scheduling)
  - [1.10 DoodleRow (In-Memory View)](#110-doodlerow-in-memory-view)
  - [1.11 ChangelogEntry (Doodle Audit)](#111-changelogentry-doodle-audit)
  - [1.12 AchievementDefinition](#112-achievementdefinition)
  - [1.13 AchievementProgress](#113-achievementprogress)
  - [1.14 PlayerAchievementStatus](#114-playerachievementstatus)
  - [1.15 AchievementLeaderboardEntry](#115-achievementleaderboardentry)
  - [1.16 MembersList](#116-memberslist)
- [2. Enumerations](#2-enumerations)
- [3. Entity Relationships](#3-entity-relationships)
- [4. Storage Strategy Options](#4-storage-strategy-options)
- [5. Query Patterns](#5-query-patterns)
- [6. Offline Storage Strategy](#6-offline-storage-strategy)
- [7. Data Migration & Backup](#7-data-migration--backup)

---

## 1. Entity Specifications

### 1.1 Tournament

The top-level aggregate representing a single day's tournament event.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| `id` | string | yes | auto-generated (GUID) | unique | Unique tournament identifier |
| `name` | string | no | `""` | 0–100 chars | Display name (e.g., "Mexicano Feb 05, 2026") |
| `description` | string | no | `""` | max 500 chars | Optional description |
| `tournamentDate` | date | yes | today (UTC) | unique per calendar date | Only one tournament per day |
| `players` | list\<Player\> | yes | empty | exactly 4, 8, 12, or 16 | Tournament participants |
| `rounds` | list\<Round\> | no | empty | ordered by round number | Completed and in-progress rounds |
| `currentRoundNumber` | int | no | `0` | ≥ 0, increments per round | Active round (0 = not started) |
| `isStarted` | boolean | no | `false` | — | Whether the tournament has begun |
| `isCompleted` | boolean | no | `false` | — | Whether the tournament is finished |
| `startedAt` | datetime | no | `null` | nullable | Timestamp when tournament started |
| `completedAt` | datetime | no | `null` | nullable | Timestamp when tournament completed |

**Computed properties:**

| Property | Type | Formula | Description |
|----------|------|---------|-------------|
| `currentRound` | Round? | round where roundNumber == currentRoundNumber | Active round, or null |
| `previousRound` | Round? | round where roundNumber == currentRoundNumber − 1 | Prior round if exists |
| `canStartNextRound` | boolean | currentRound != null && currentRound.isCompleted | All current matches done |
| `canEditPreviousRound` | boolean | previousRound != null | Prior round exists |
| `isEditable` | boolean | today ≤ tournamentDate + 1 day | Within edit window |
| `totalRounds` | int | rounds.count | Number of rounds generated |
| `playersCount` | int | players.count | Number of participants |

**Key validations:**

- Player count must be divisible by 4 (valid: 4, 8, 12, 16)
- Player names must be unique within the tournament (case-insensitive, trimmed)
- Tournament can only be edited within **1 day** of the tournament date
- Editing a previous round's score triggers full recalculation and regeneration of all subsequent rounds

**Lifecycle methods:**

| Method | Behavior |
|--------|----------|
| `addPlayer(player)` | Adds a player to the tournament |
| `addPlayers(players)` | Adds multiple players at once |
| `start()` | Sets isStarted=true, records startedAt |
| `addRound(round)` | Appends a new round, increments currentRoundNumber |
| `removeRoundsAfter(roundNumber)` | Deletes all rounds after the given number (for re-pairing) |
| `complete()` | Sets isCompleted=true, records completedAt |
| `getPlayersByRanking()` | Returns players sorted by ranking rules |

---

### 1.2 Player (Tournament-Scoped)

Represents a participant within a single tournament. Statistics are recalculated from match data.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| `id` | int | yes | sequential | unique within tournament | Sequential identifier |
| `name` | string | yes | — | 1–50 chars, unique in tournament, trimmed | Player display name |
| `totalPoints` | int | no | `0` | ≥ 0 | Sum of all match scores earned |
| `gamesPlayed` | int | no | `0` | ≥ 0 | Number of matches played |
| `wins` | int | no | `0` | ≥ 0 | Number of matches won |
| `losses` | int | no | `0` | ≥ 0 | Number of matches lost |

**Computed properties:**

| Property | Type | Formula | Description |
|----------|------|---------|-------------|
| `pointsPerGame` | float | totalPoints / gamesPlayed (0 if no games) | Average points per match |
| `winPercentage` | float | (wins / gamesPlayed) × 100 (0 if no games) | Win rate as percentage |

**Mutation methods:**

| Method | Behavior |
|--------|----------|
| `addScore(score)` | Adds score to totalPoints, increments gamesPlayed |
| `removeScore(score)` | Subtracts score from totalPoints, decrements gamesPlayed |
| `addWin()` | Increments wins |
| `addLoss()` | Increments losses |
| `removeWin()` | Decrements wins |
| `removeLoss()` | Decrements losses |
| `resetStatistics()` | Resets all stats to 0 |

**Ranking rules** (priority order):

1. **Total Points** — descending (highest first)
2. **Wins** — descending (tiebreaker)
3. **Points Per Game** — descending (secondary tiebreaker)
4. **Name** — alphabetical (final tiebreaker)

Players with identical Total Points AND Wins share the same rank. The next rank skips by the number of tied players.

---

### 1.3 Match

A single game within a round. Four players form two teams of two.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| `id` | int | yes | — | unique within tournament | Match identifier |
| `roundNumber` | int | yes | — | ≥ 1 | Which round this match belongs to |
| `player1` | Player ref | yes | — | not null | Team 1, player 1 |
| `player2` | Player ref | yes | — | not null | Team 1, player 2 |
| `team1Score` | int | no | `0` | 0–25 | Team 1's score |
| `player3` | Player ref | yes | — | not null | Team 2, player 1 |
| `player4` | Player ref | yes | — | not null | Team 2, player 2 |
| `team2Score` | int | no | `0` | 0–25 | Team 2's score |
| `completedAt` | datetime | no | `null` | nullable | When match was completed |

**Computed properties:**

| Property | Type | Formula | Description |
|----------|------|---------|-------------|
| `isCompleted` | boolean | team1Score + team2Score == 25 | Whether match has a final score |
| `team1` | list\<Player\> | [player1, player2] | Team 1 players |
| `team2` | list\<Player\> | [player3, player4] | Team 2 players |
| `allPlayers` | list\<Player\> | [player1, player2, player3, player4] | All four participants |

**Key constraints:**

- `team1Score + team2Score` must equal exactly **25** when completed
- Both scores must be non-negative (0–25)
- Both players on the winning team receive the team's score as individual points
- Both players on the losing team receive the team's score as individual points

**Query methods:**

| Method | Behavior |
|--------|----------|
| `setScores(score1, score2)` | Sets both scores, validates total = 25 |
| `getWinners()` | Returns the team with the higher score |
| `getLosers()` | Returns the team with the lower score |
| `isTeam1Winner()` | team1Score > team2Score |
| `isTeam2Winner()` | team2Score > team1Score |
| `isTie()` | Not possible when total = 25 (one team always wins) |

---

### 1.4 Round

A collection of simultaneous matches. Number of matches = playerCount / 4.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| `roundNumber` | int | yes | — | ≥ 1, sequential | 1-based round identifier |
| `matches` | list\<Match\> | no | empty | count = playerCount / 4 | All matches in this round |
| `completedAt` | datetime | no | `null` | nullable | When all matches finished |

**Computed properties:**

| Property | Type | Formula | Description |
|----------|------|---------|-------------|
| `isCompleted` | boolean | all matches have isCompleted == true | Whether round is finished |
| `totalMatches` | int | matches.count | Number of matches |
| `completedMatches` | int | count of matches where isCompleted == true | Finished matches |
| `completionPercentage` | float | (completedMatches / totalMatches) × 100 | Progress as 0–100% |

**Mutation methods:**

| Method | Behavior |
|--------|----------|
| `addMatch(match)` | Adds a single match to the round |
| `addMatches(matches)` | Adds multiple matches at once |
| `completeRound()` | Sets completedAt timestamp |

---

### 1.5 MatchEntity (Persistence Model)

The storage-level representation of a match. This is how matches are persisted. Tournaments are **NOT** stored as separate entities — they are reconstructed by grouping MatchEntities by date and extracting unique player names.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| `partitionKey` | string | yes | — | always `"match"` | Table storage partition key |
| `rowKey` | string | yes | — | format: `"{yyyy-MM-dd}-Round{N}-{Seq}"` | Unique row identifier |
| `date` | string | yes | — | format: `"yyyy-MM-dd"` | Tournament date |
| `roundNumber` | int | yes | `0` | ≥ 1 | Which round |
| `team1Player1Name` | string | yes | `""` | — | Team 1, player 1 name |
| `team1Player2Name` | string | yes | `""` | — | Team 1, player 2 name |
| `team2Player1Name` | string | yes | `""` | — | Team 2, player 1 name |
| `team2Player2Name` | string | yes | `""` | — | Team 2, player 2 name |
| `scoreTeam1` | int | yes | `0` | 0–25 | Team 1 score |
| `scoreTeam2` | int | yes | `0` | 0–25 | Team 2 score |
| `timestamp` | datetime | no | auto-set | managed by storage | Storage-level timestamp |
| `eTag` | string | no | auto-managed | — | Optimistic concurrency token |

**Example row key:** `"2026-02-05-Round1-1"`, `"2026-02-05-Round2-3"`

**Reconstruction algorithm** (loading a tournament from storage):

1. Query all MatchEntities for a given date
2. Extract unique player names from all matches
3. Create Player objects for each unique name
4. Group matches by roundNumber to create Round objects
5. Recalculate all player statistics from completed matches
6. Determine currentRoundNumber from the highest round

---

### 1.6 PlayerSummary (All-Time Statistics)

Cross-tournament lifetime statistics for a player. Can be fully recomputed from match data.

| Field | Type | Required | Default | JSON Name | Description |
|-------|------|----------|---------|-----------|-------------|
| `playerName` | string | yes | `""` | `player_name` | Primary key — player identifier |
| `totalTournaments` | int | no | `0` | `total_tournaments` | Number of tournaments attended |
| `totalWins` | int | no | `0` | `total_wins` | Total match wins (any margin) |
| `totalLosses` | int | no | `0` | `total_losses` | Total match losses |
| `tightWins` | int | no | `0` | `tight_wins` | Wins with score **13–12** (1-point margin) |
| `solidWins` | int | no | `0` | `solid_wins` | Wins with score **15–20** (margin of 5–15 points) |
| `dominatingWins` | int | no | `0` | `dominating_wins` | Wins with score **20+** (margin of 15+ points) |
| `firstPlaceFinishes` | int | no | `0` | `first_place_finishes` | Tournament 1st place finishes |
| `secondPlaceFinishes` | int | no | `0` | `second_place_finishes` | Tournament 2nd place finishes |
| `thirdPlaceFinishes` | int | no | `0` | `third_place_finishes` | Tournament 3rd place finishes |

**Win category definitions:**

| Category | Score Range | Score Examples | Margin |
|----------|-------------|----------------|--------|
| Tight Win | 13–12 | 13-12 only | 1 point |
| Solid Win | 15–10 through 20–5 | 15-10, 17-8, 19-6, 20-5 | 5–15 points |
| Dominating Win | 21–4 through 25–0 | 21-4, 23-2, 25-0 | 17–25 points |

> **Note:** A score of 14–11 (margin of 3) does not fall into any special win category — it is counted only as a regular win.

**Storage (Azure Table Storage):**

| Key | Value |
|-----|-------|
| PartitionKey | `"PlayerSummary"` |
| RowKey | player name (e.g., `"Alex"`, `"Morten Westergaard"`) |

---

### 1.7 PlayerStatistics (Period Statistics)

Aggregated statistics for leaderboard display, typically computed for a specific time range.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `rank` | int | `0` | Leaderboard position |
| `name` | string | `""` | Player name |
| `wins` | int | `0` | Match wins in period |
| `losses` | int | `0` | Match losses in period |
| `points` | int | `0` | Total points in period |
| `average` | float | `0` | Points per game |
| `change` | float | `0` | Change from previous period |
| `winRate` | float | `0` | Wins / (Wins + Losses) |
| `tightWins` | int | `0` | 13–12 wins in period |
| `tightLosses` | int | `0` | 12–13 losses in period |
| `solidWins` | int | `0` | Score 15–20 wins in period |
| `dominatingWins` | int | `0` | Score 20+ wins in period |

---

### 1.8 PlayerRanking (ELO)

ELO-based ranking computed across all tournament history.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `place` | int | `0` | Ranking position |
| `name` | string | `""` | Player name |
| `elo` | float | `0` | Current ELO rating |
| `change` | float | `0` | ELO change from last calculation |

---

### 1.9 DoodleEntry (Scheduling)

Tracks player availability for tournament scheduling. Stored per player per month.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| `name` | string | yes | `""` | — | Player name |
| `year` | int | yes | `0` | valid year | Calendar year |
| `month` | int | yes | `0` | 1–12 | Calendar month |
| `selectedDates` | string | no | `""` | comma-separated `yyyy-MM-dd` | Dates the player is available |

**Composite key:** `(year, month, playerName)`

**Storage (Azure Table Storage):**

| Key | Value | Example |
|-----|-------|---------|
| PartitionKey | `"YYYY-MM"` | `"2025-01"` |
| RowKey | player name | `"Alex"` |

**Example:** PartitionKey=`"2025-01"`, RowKey=`"Alex"`, SelectedDates=`"2025-01-09,2025-01-14,2025-01-21"`

---

### 1.10 DoodleRow (In-Memory View)

In-memory representation of a player's doodle availability for UI rendering.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | `""` | Player name |
| `selected` | map\<string, boolean\> | empty | Key: `yyyy-MM-dd`, Value: whether date is selected |
| `allowEdit` | boolean | `false` | Whether the current user can edit this row |

---

### 1.11 ChangelogEntry (Doodle Audit)

Audit trail for doodle modifications. Keep the last **20 entries** for display.

| Field | Type | Required | Default | Constraints | Description |
|-------|------|----------|---------|-------------|-------------|
| `name` | string | yes | `""` | — | Player who made the change |
| `date` | string | yes | `""` | format: `yyyy-MM-dd` | Date of the change |
| `selectedDates` | string | no | `""` | comma-separated `yyyy-MM-dd` | The new date selections |

**Storage (Azure Table Storage):**

| Key | Value | Example |
|-----|-------|---------|
| PartitionKey | `"changelog"` | always `"changelog"` |
| RowKey | `"{Ticks}-{PlayerName}"` | `"637012345678901234-Alex"` |

The Ticks-based RowKey ensures chronological ordering and uniqueness.

---

### 1.12 AchievementDefinition

Static definitions for all unlockable achievements. Loaded from configuration data (e.g., JSON file).

| Field | Type | Required | Default | JSON Name | Description |
|-------|------|----------|---------|-----------|-------------|
| `id` | string | yes | `""` | `id` | Unique achievement identifier |
| `name` | string | yes | `""` | `name` | Display name |
| `description` | string | yes | `""` | `description` | Achievement description |
| `category` | string | yes | `""` | `category` | Category identifier |
| `tier` | string | yes | `""` | `tier` | Bronze / Silver / Gold / Platinum / Legend |
| `subTier` | int | no | `0` | `subTier` | Tier progression level (1–5) |
| `iconName` | string | no | `""` | `iconName` | Material Design icon name |
| `requirementType` | string | yes | `""` | `requirementType` | How achievement is evaluated |
| `requirementValue` | float | yes | `0` | `requirementValue` | Threshold to unlock |
| `secondaryRequirement` | string? | no | `null` | `secondaryRequirement` | Optional secondary condition |
| `secondaryValue` | float? | no | `null` | `secondaryValue` | Secondary threshold |
| `minimumMatchesRequired` | int? | no | `null` | `minimumMatchesRequired` | Minimum matches played to qualify |
| `points` | int | yes | `0` | `points` | Achievement points awarded when unlocked |
| `isSecret` | boolean | no | `false` | `isSecret` | Hidden until unlocked |

**Computed properties:**

| Property | Type | Description |
|----------|------|-------------|
| `categoryEnum` | AchievementCategory | Parsed category enum value |
| `tierEnum` | AchievementTier | Parsed tier enum value |

**Requirement types:**

| RequirementType | Evaluated Against | Description |
|-----------------|-------------------|-------------|
| `TournamentCount` | PlayerSummary.totalTournaments | Tournaments attended |
| `WinCount` | PlayerSummary.totalWins | Total match wins |
| `TightWin` | PlayerSummary.tightWins | 13–12 score wins |
| `SolidWin` | PlayerSummary.solidWins | Score 15–20 wins |
| `DominatingWin` | PlayerSummary.dominatingWins | Score 20+ wins |
| `FirstPlaceCount` | PlayerSummary.firstPlaceFinishes | 1st place finishes |
| `SecondPlaceCount` | PlayerSummary.secondPlaceFinishes | 2nd place finishes |
| `ThirdPlaceCount` | PlayerSummary.thirdPlaceFinishes | 3rd place finishes |

**Achievement JSON structure** (source file format):

```json
{
  "categories": [
    {
      "id": "category_id",
      "name": "Category Name",
      "iconName": "material_icon",
      "requirementType": "EvaluationType",
      "achievements": [
        {
          "id": "unique_id",
          "name": "Achievement Name",
          "description": "Description text",
          "tier": "Bronze",
          "subTier": 1,
          "value": 5,
          "points": 10
        }
      ]
    }
  ]
}
```

**Category breakdown (172 total achievements):**

| Category | Requirement Type | Count | Max Threshold |
|----------|-----------------|-------|---------------|
| Participation | TournamentCount | 21 | 500 tournaments |
| Wins | WinCount | 21 | 2,500 wins |
| Nail-Biters | TightWin | 21 | 500 tight wins |
| Strong Wins | SolidWin | 21 | 800 solid wins |
| Crushing Victories | DominatingWin | 21 | 250 dominating wins |
| 1st Place Finishes | FirstPlaceCount | 21 | 125 first places |
| 2nd Place Finishes | SecondPlaceCount | 21 | 155 second places |
| 3rd Place Finishes | ThirdPlaceCount | 21 | 202 third places |

---

### 1.13 AchievementProgress

Rich progress detail for a single achievement, used for UI display.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `achievementId` | string | `""` | Links to AchievementDefinition |
| `name` | string | `""` | Achievement display name |
| `description` | string | `""` | Achievement description |
| `category` | AchievementCategory | `Participation` | Category enum |
| `tier` | AchievementTier | `Bronze` | Tier enum |
| `subTier` | int | `0` | Tier progression level |
| `progress` | float | `0` | 0.0 to 1.0 completion ratio |
| `currentValue` | float | `0` | Current progress value |
| `requiredValue` | float | `0` | Target value to unlock |
| `points` | int | `0` | Points if unlocked |
| `icon` | string | `""` | Icon name |
| `isUnlocked` | boolean | `false` | Whether achievement is earned |
| `unlockedDate` | datetime? | `null` | When achievement was earned |

**Computed properties:**

| Property | Type | Formula | Description |
|----------|------|---------|-------------|
| `progressText` | string | `"Unlocked"` or `"{current} / {required}"` | Human-readable progress |
| `progressPercentage` | int | progress × 100, clamped 0–100 | Integer percentage |

---

### 1.14 PlayerAchievementStatus

Links a player to an achievement with progress tracking.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `achievementId` | string | `""` | Links to AchievementDefinition |
| `playerName` | string | `""` | Player identifier |
| `isUnlocked` | boolean | `false` | Whether achievement is earned |
| `unlockedDate` | datetime? | `null` | When achievement was unlocked |
| `progress` | float | `0` | 0.0 to 1.0 completion ratio |
| `currentValue` | float | `0` | Current progress toward requirement |
| `requiredValue` | float | `0` | Threshold needed to unlock |
| `definition` | AchievementDefinition? | `null` | Reference to the full definition |

---

### 1.15 AchievementLeaderboardEntry

Aggregated achievement stats per player for the achievement leaderboard.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `playerName` | string | `""` | Player identifier |
| `totalPoints` | int | `0` | Sum of all unlocked achievement points |
| `totalAchievements` | int | `0` | Count of unlocked achievements |
| `bronzeCount` | int | `0` | Number of Bronze achievements |
| `silverCount` | int | `0` | Number of Silver achievements |
| `goldCount` | int | `0` | Number of Gold achievements |
| `platinumCount` | int | `0` | Number of Platinum achievements |
| `completionPercentage` | float | `0` | (unlocked / total) × 100 |
| `rank` | int | `0` | Leaderboard position |

---

### 1.16 MembersList

Static list of known community members. Used as autocomplete suggestions during tournament creation and for doodle scheduling.

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Player name |
| `discordId` | string? | Optional Discord identifier (for notifications) |

The members list is a static configuration — not stored in a database. It serves as the canonical list of community participants.

---

## 2. Enumerations

### AchievementTier

| Value | Ordinal | Description |
|-------|---------|-------------|
| `Bronze` | 0 | Entry-level achievements |
| `Silver` | 1 | Intermediate achievements |
| `Gold` | 2 | Advanced achievements |
| `Platinum` | 3 | Expert-level achievements |
| `Legend` | 4 | Ultimate achievements |

### AchievementCategory

| Value | Description |
|-------|-------------|
| `Participation` | Tournament attendance milestones |
| `Wins` | Total match win milestones |
| `NailBiters` | Tight win (13–12) milestones |
| `StrongWins` | Solid win (score 15–20) milestones |
| `CrushingVictories` | Dominating win (score 20+) milestones |
| `FirstPlaceFinishes` | Tournament 1st place milestones |
| `SecondPlaceFinishes` | Tournament 2nd place milestones |
| `ThirdPlaceFinishes` | Tournament 3rd place milestones |

---

## 3. Entity Relationships

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ENTITY RELATIONSHIP DIAGRAM                  │
└─────────────────────────────────────────────────────────────────────┘

  Tournament 1 ──────* Round 1 ──────* Match *──────4 Player
       │                                                │
       │  (one tournament per date)                     │ (by name,
       │                                                │  cross-tournament)
       │                                                ▼
       │                                          PlayerSummary
       │                                           (all-time)
       │                                                │
       │                                                │ (by playerName)
       │                                                ▼
       │                                    PlayerAchievementStatus
       │                                                │
       │                                                │ (by achievementId)
       │                                                ▼
       │                                      AchievementDefinition
       │
       │  (reconstructed from)
       ▼
  MatchEntity ─────── (grouped by date) ──────── Tournament
  (persistence)

  DoodleEntry *──────1 Player (by name)
  ChangelogEntry *───1 Player (by name)
  MembersList ───────* Player (autocomplete source)
```

**Relationship details:**

| Relationship | Cardinality | Join Key | Notes |
|-------------|-------------|----------|-------|
| Tournament → Round | 1 to many | roundNumber | Ordered, sequential |
| Round → Match | 1 to many | roundNumber | count = playerCount / 4 |
| Match → Player | many to 4 | player reference | 2 per team, 4 per match |
| PlayerSummary → Player | 1 to 1 | playerName | Cross-tournament, by name |
| DoodleEntry → Player | many to 1 | playerName | Per month per player |
| ChangelogEntry → Player | many to 1 | playerName | Audit log entries |
| AchievementDefinition → PlayerAchievementStatus | many to many | achievementId + playerName | Progress tracking |
| MatchEntity → Tournament | many to 1 | date | Tournament reconstructed at query time |

---

## 4. Storage Strategy Options

### Option A: Key-Value / Table Storage (Azure Table Storage) — Current Implementation

The primary storage pattern used by the application.

| Table | PartitionKey | RowKey | Description |
|-------|-------------|--------|-------------|
| **Matches** | `"match"` | `"{yyyy-MM-dd}-Round{N}-{Seq}"` | All match results |
| **PlayerSummaries** | `"PlayerSummary"` | `"{playerName}"` | Lifetime statistics |
| **Doodles** | `"{YYYY-MM}"` | `"{playerName}"` | Monthly availability |
| **Changelogs** | `"changelog"` | `"{Ticks}-{playerName}"` | Doodle audit trail |

**Key characteristics:**

- Tournaments are **not stored as separate entities** — reconstructed by grouping matches by date
- Partition key design optimized for common query patterns
- RowKey ordering enables efficient range queries
- ETag-based optimistic concurrency

### Option B: Relational Database (SQL)

```sql
-- Core tables
tournaments    (id PK, name, description, tournament_date UNIQUE, ...)
players        (id PK, tournament_id FK, name, total_points, ...)
rounds         (id PK, tournament_id FK, round_number, ...)
matches        (id PK, round_id FK, player1_id FK, player2_id FK,
                player3_id FK, player4_id FK, team1_score, team2_score, ...)

-- Cross-tournament
player_summaries  (player_name PK, total_tournaments, total_wins, ...)
doodle_entries    (year, month, player_name, selected_dates, PK(year,month,player_name))
changelog         (id PK, timestamp, player_name, selected_dates)
achievements      (id PK, name, category, tier, requirement_type, requirement_value, ...)

-- Recommended indexes
CREATE INDEX idx_matches_date ON matches (tournament_date);
CREATE INDEX idx_players_name ON players (name);
CREATE INDEX idx_doodle_period ON doodle_entries (year, month);
```

### Option C: Document Database (MongoDB, Firestore, CosmosDB)

```
Collection: tournaments
  Document: {
    _id, name, tournamentDate,
    players: [ { name, totalPoints, ... } ],
    rounds: [
      {
        roundNumber,
        matches: [ { player1, player2, player3, player4, team1Score, team2Score } ]
      }
    ]
  }

Collection: playerSummaries
  Document: { _id: playerName, totalTournaments, totalWins, ... }

Collection: doodle
  Document: { _id: "YYYY-MM:playerName", year, month, name, selectedDates: [...] }

Collection: changelog
  Document: { timestamp, playerName, selectedDates: [...] }
```

### Option D: File-Based (JSON Files)

```
data/
├── tournaments/
│   ├── 2026-02-05.json      # One file per tournament date
│   ├── 2026-02-12.json
│   └── ...
├── player-summaries/
│   ├── Alex.json             # One file per player
│   ├── Caroline.json
│   └── ...
├── doodle/
│   ├── 2025-01.json          # One file per month
│   └── ...
└── changelog.json            # Single file, last 20 entries
```

Good for backup/export and local development. The existing codebase uses this pattern for automated backups.

---

## 5. Query Patterns

The application requires the following key queries:

| # | Query | Parameters | Used For |
|---|-------|------------|----------|
| 1 | Get **all matches** across all dates | none | ELO calculation across full history |
| 2 | Get matches **by date** | `date: yyyy-MM-dd` | Load a specific tournament |
| 3 | Get matches **by year/month** | `year, month` | Attendance and monthly statistics |
| 4 | Get matches **grouped by date** | none | Tournament list / history view |
| 5 | Get **all player summaries** | none | Achievement evaluation, leaderboards |
| 6 | Get **doodle entries** by year/month | `year, month` | Scheduling availability grid |
| 7 | Get **last 20 changelog** entries | none | Doodle audit trail display |
| 8 | Get **achievement definitions** | none | Achievement catalog, progress evaluation |
| 9 | Get **player achievement statuses** for a player | `playerName` | Individual achievement page |
| 10 | Get **members list** | none | Autocomplete suggestions |

**Query implementation by storage option:**

| Query | Table Storage | SQL | Document DB |
|-------|--------------|-----|-------------|
| All matches | Scan partition `"match"` | `SELECT * FROM matches` | `db.tournaments.find({})` |
| By date | RowKey prefix `"{date}-"` | `WHERE tournament_date = ?` | `db.tournaments.findOne({date})` |
| By year/month | RowKey range `"{yyyy-MM}-"` | `WHERE date BETWEEN ? AND ?` | `db.tournaments.find({date: {$gte, $lt}})` |
| Grouped by date | Client-side group after scan | `GROUP BY tournament_date` | Aggregation pipeline |
| Player summaries | Scan partition `"PlayerSummary"` | `SELECT * FROM player_summaries` | `db.playerSummaries.find({})` |
| Doodle by month | PartitionKey `"{YYYY-MM}"` | `WHERE year = ? AND month = ?` | `db.doodle.find({year, month})` |
| Last 20 changelog | Scan partition `"changelog"`, sort, limit 20 | `ORDER BY timestamp DESC LIMIT 20` | `db.changelog.find().sort(-1).limit(20)` |

---

## 6. Offline Storage Strategy

### Local Storage Schema

Store the current tournament state in browser local storage or device storage:

```json
{
  "currentTournament": {
    "id": "...",
    "tournamentDate": "2026-02-05",
    "players": [...],
    "rounds": [...],
    "currentRoundNumber": 3
  },
  "pendingUpdates": [
    {
      "type": "scoreUpdate",
      "matchId": 5,
      "team1Score": 15,
      "team2Score": 10,
      "timestamp": "2026-02-05T14:30:00Z"
    }
  ],
  "lastSyncTimestamp": "2026-02-05T14:25:00Z"
}
```

### Sync Strategy

1. **Store** current tournament state in local storage on every change
2. **Queue** pending match score updates when offline
3. **Monitor** connectivity status (online/offline events)
4. **Auto-sync** when connection is restored — push pending updates to server
5. **Conflict resolution:** server wins (last-write-wins for match scores)
6. **Clear** pending queue after successful sync

---

## 7. Data Migration & Backup

### Automated Backup

Periodically export all matches to JSON files organized by date hierarchy:

```
backup-data/
├── {YYYY}/
│   ├── {YYYY-MM}/
│   │   ├── {YYYY-MM-DD}.json
│   │   ├── {YYYY-MM-DD}.json
│   │   └── ...
│   └── ...
└── ...
```

### Backup File Format

Each file contains all matches for a single tournament date:

```json
{
  "backup_timestamp": "2026-02-05T18:30:00.000000Z",
  "match_date": "2026-02-05",
  "match_count": 8,
  "matches": [
    {
      "Date": "2026-02-05",
      "RoundNumber": 1,
      "ScoreTeam1": 15,
      "ScoreTeam2": 10,
      "Team1Player1Name": "Alex",
      "Team1Player2Name": "Caroline",
      "Team2Player1Name": "Chris",
      "Team2Player2Name": "Jonas"
    }
  ]
}
```

### Player Summary Regeneration

Player summaries can be **fully recomputed** from match data at any time:

1. Load all MatchEntities from storage
2. Group by date to identify tournaments
3. For each tournament, determine rankings (1st, 2nd, 3rd place)
4. For each match, categorize win type (tight/solid/dominating)
5. Aggregate per player: tournaments, wins, losses, win types, place finishes
6. Write updated PlayerSummary records

This means player summaries are a **derived/cached** data set — match data is the single source of truth.

---

*Document generated from analysis of the Mexicano Tournament Manager codebase.*
