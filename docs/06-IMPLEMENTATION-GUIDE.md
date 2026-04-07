# Implementation Guide — Mexicano Tournament Management

> **Technology-Agnostic Implementation Strategy**
>
> This document provides architectural guidance, design patterns, and best practices
> for building a Mexicano Tournament Management application regardless of the chosen
> technology stack.

---

## Table of Contents

1. [Service/Module Decomposition](#1-servicemodule-decomposition)
2. [API Design Patterns](#2-api-design-patterns)
3. [Caching Strategy](#3-caching-strategy)
4. [Offline-First Architecture](#4-offline-first-architecture)
5. [Real-Time Update Patterns](#5-real-time-update-patterns)
6. [Notification Integration](#6-notification-integration)
7. [Testing Strategy](#7-testing-strategy)
8. [Deployment Considerations](#8-deployment-considerations)
9. [Security Considerations](#9-security-considerations)
10. [Extensibility Points](#10-extensibility-points)
11. [Technology Stack Recommendations](#11-technology-stack-recommendations)

---

## 1. Service/Module Decomposition

The application should be decomposed into the following independent services/modules:

```
┌─────────────────────────────────────────────────────────────────┐
│                      Presentation Layer                         │
│  Pages: Home, Tournaments, Tournament, Create, Statistics,      │
│         ELO Charts, Attendance, Doodle, Achievements            │
│  Components: Tables, Cards, Dialogs, Score Input, Charts        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│                     Business Logic Layer                         │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ TournamentService│  │ EloCalculator    │  │ PlayerStats   │  │
│  │ - Create/manage  │  │ - Classic ELO    │  │ - Calculate   │  │
│  │ - Rounds/matches │  │ - Scored ELO     │  │ - Rank        │  │
│  │ - Score entry    │  │ - History        │  │ - Win types   │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ RankingService   │  │ AttendanceService│  │ DoodleService │  │
│  │ - Rank players   │  │ - Monthly stats  │  │ - Calendar    │  │
│  │ - Generate pairs │  │ - Percentages    │  │ - CRUD        │  │
│  │ - Tie-breaking   │  │ - Filtering      │  │ - Changelog   │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│                      Data Access Layer                           │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ MatchStorage     │  │ PlayerSummary    │  │ DoodleStorage │  │
│  │ Interface        │  │ Storage Interface│  │ Interface     │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│                                                                  │
│  ┌──────────────────┐                                           │
│  │ OfflineStorage   │  Implementations: SQL, NoSQL, File,       │
│  │ Interface        │  Cloud Table Storage, In-Memory            │
│  └──────────────────┘                                           │
└─────────────────────────────────────────────────────────────────┘
```

### Service Responsibilities

#### 1. TournamentService (Central Orchestrator)

- Create tournament with validated player list
- Generate Round 1 matches (entry-order algorithm)
- Generate subsequent round matches (Mexicano algorithm)
- Handle score entry and validation
- Cascade regeneration on score edits
- Tournament lifecycle management
- Sync with storage

#### 2. EloCalculatorService (Pure Calculation, No Side Effects)

- Classic ELO calculation (win/loss binary)
- Scored ELO calculation (margin-based)
- Combined opponent ELO (geometric mean)
- Stateless — given inputs, returns outputs

#### 3. PlayerStatisticsService (Pure Calculation)

- Calculate stats from match data
- Win categorization (tight/solid/dominating)
- Head-to-head statistics
- Partnership statistics

#### 4. PlayerRankingService (Pure Calculation)

- Rank players by performance metrics
- Handle ties with skip logic
- Round-1 seeding logic

#### 5. EloDataService (Data + Caching)

- Fetch all historical matches
- Calculate and cache ELO rankings
- Provide ELO history (all-time, per-tournament)
- Cache invalidation on new data

#### 6. AttendanceService (Derived Data)

- Monthly attendance from match data
- Attendance statistics with filtering

#### 7. DoodleService (CRUD + Audit)

- Get/save/delete availability preferences
- Changelog management
- Month-based organization

#### 8. AchievementService (Evaluation + Caching)

- Load achievement definitions
- Evaluate player progress
- Generate leaderboard
- Cache with TTL
---

## 2. API Design Patterns

If exposing as a REST API (for decoupled frontend):

```
# Tournament Management
POST   /api/tournaments                    # Create tournament
GET    /api/tournaments                    # List all tournaments
GET    /api/tournaments/{date}             # Get tournament by date
DELETE /api/tournaments/{date}             # Delete tournament
POST   /api/tournaments/{date}/start       # Start tournament
POST   /api/tournaments/{date}/rounds/next # Generate next round
PUT    /api/tournaments/{date}/matches/{id} # Update match score

# ELO & Statistics
GET    /api/elo/rankings                   # Current ELO leaderboard
GET    /api/elo/rankings?type=classic|scored
GET    /api/elo/history                    # All-time ELO history
GET    /api/elo/history/{date}             # Tournament-specific ELO
GET    /api/statistics                     # Player statistics
GET    /api/statistics/{playerName}        # Individual player stats
GET    /api/statistics/{playerName}/opponents  # Head-to-head
GET    /api/statistics/{playerName}/partners   # Partnership stats

# Attendance
GET    /api/attendance/{year}/{month}      # Monthly attendance
GET    /api/attendance/statistics           # Attendance leaderboard
GET    /api/attendance/statistics?since=2025-01-01

# Doodle/Scheduling
GET    /api/doodle/{year}/{month}          # Get month calendar
PUT    /api/doodle/{year}/{month}/{player} # Update player availability
DELETE /api/doodle/{year}/{month}/{player} # Remove player availability
GET    /api/doodle/changelog               # Recent changes

# Players
GET    /api/players                        # List known members
GET    /api/players/{name}/profile         # Full player profile
```

### Design Principles

- Use date (`yyyy-MM-dd`) as tournament identifier (one per day)
- Return full updated state after mutations (not just acknowledgment)
- Include computed fields in responses (rankings, percentages)
- Support pagination for large datasets (match history)
- Use ETags/timestamps for cache validation

---

## 3. Caching Strategy

```
┌─────────────────────┬──────────────┬────────────────────────────┐
│ Data                │ TTL          │ Invalidation               │
├─────────────────────┼──────────────┼────────────────────────────┤
│ ELO Rankings        │ 10 minutes   │ On new match score saved   │
│ ELO History         │ 10 minutes   │ On new match score saved   │
│ Player Summaries    │ 1 hour       │ On summary regeneration    │
│ All Matches (list)  │ 5 minutes    │ On any match CRUD          │
│ Tournament State    │ No cache     │ Always fresh (live data)   │
│ Doodle Data         │ No cache     │ Always fresh               │
└─────────────────────┴──────────────┴────────────────────────────┘
```

### Cache Implementation

- Use in-memory cache for single-server deployments
- Use distributed cache (Redis, etc.) for multi-server deployments
- Provide manual cache clear (refresh button in UI)
- Cache key format: `{service}:{method}:{params}`

---

## 4. Offline-First Architecture

```
┌──────────────────────────────────────┐
│           Client Application         │
│                                      │
│  ┌────────────┐  ┌────────────────┐  │
│  │ Active     │  │ Offline Queue  │  │
│  │ Tournament │  │ (Pending Sync) │  │
│  │ State      │  │                │  │
│  │ (Local)    │  │ - Match scores │  │
│  └────────────┘  └────────┬───────┘  │
│                           │          │
│  ┌────────────────────────┴───────┐  │
│  │ Connectivity Monitor           │  │
│  │ - Check every 5 seconds        │  │
│  │ - Online → flush queue         │  │
│  │ - Offline → queue writes       │  │
│  └────────────────────────────────┘  │
└──────────────────┬───────────────────┘
                   │
           ┌───────┴────────┐
           │  Remote Storage │
           │  (Server/Cloud) │
           └────────────────┘
```

### Implementation Steps

1. Save current tournament to local storage on every state change
2. When saving match scores, attempt remote save first
3. If remote fails (timeout/error), queue locally with timestamp
4. Poll connectivity every N seconds
5. When online detected, flush pending queue in order
6. Conflict resolution: last-write-wins (server timestamp)
7. Show sync status indicator in UI (✓ synced, ⏳ pending, ✗ offline)

---

## 5. Real-Time Update Patterns

For multi-user scenarios (multiple people viewing the same tournament):

### Option A: Polling

- Poll for tournament updates every 5–10 seconds
- Simple to implement, works everywhere
- Higher server load

### Option B: WebSockets / SignalR / Server-Sent Events

- Push updates when tournament state changes
- Lower latency, better UX
- More complex infrastructure

### Option C: Server-Side Rendering with Live Updates

- Framework-specific (Blazor Server, LiveView, etc.)
- Automatic UI updates on server state change
- Requires persistent connection

### Recommended Events to Broadcast

- Match score updated
- Round completed
- New round generated
- Tournament started/completed

---

## 7. Testing Strategy

### 7.1 Unit Tests (Core Business Logic)

These are the most critical tests:

#### Tournament Engine

- Round 1 pairing generates correct matchups for 4, 8, 12, 16 players
- Mexicano pairing creates balanced teams from rankings
- Score validation (must sum to 25, non-negative integers)
- Score editing cascade deletes and regenerates subsequent rounds
- Player statistics recalculation is correct after score changes
- Tournament lifecycle transitions are valid

#### ELO Calculations

- Initial ELO is 1000
- Classic ELO: winner gains, loser loses (symmetrically for equal ratings)
- Scored ELO: bigger margins give bigger changes
- Combined opponent ELO (geometric mean) is correct
- ELO history accumulates correctly across tournaments

#### Player Ranking

- Primary sort by total points
- Tie-breaking by wins, then points-per-game, then name
- Tied players share rank, next rank skips
- Round 1 uses entry order

#### Player Statistics

- Win/loss counting is correct
- Win categorization (tight/solid/dominating) is correct
- Averages calculated correctly
- Head-to-head and partnership stats aggregate correctly

#### Attendance

- Players extracted from matches correctly
- Monthly aggregation counts unique dates
- Percentage calculation is correct
- Cutoff date filtering works

#### Doodle

- Save/load/delete operations maintain consistency
- Changelog tracks changes correctly
- Month-based filtering works

### 7.2 Test Data Patterns

Use the Builder pattern for test data:

```
// Match builder
matchBuilder()
    .withRound(1)
    .withTeam1("Alex", "Bob")
    .withTeam2("Carol", "Dave")
    .withScore(15, 10)
    .build()

// Tournament builder
tournamentBuilder()
    .withPlayers(["Alex", "Bob", "Carol", "Dave"])
    .withRound(1, [
        match("Alex", "Dave", "Bob", "Carol", 15, 10)
    ])
    .started()
    .build()
```

Use JSON test scenario files for complex scenarios (reusable across implementations).

### 7.3 Integration Tests

- Storage round-trip (save and load tournament)
- Full tournament flow (create → play rounds → complete)
- Offline queue flush
- Cache invalidation

---

## 8. Deployment Considerations

### Infrastructure Needed

1. Web server / hosting platform (any: cloud, VPS, PaaS)
2. Data storage (see Data Models document for options)
3. (Optional) CDN for static assets
4. (Optional) Monitoring / logging service

### Environment Configuration

```
Required:
  - STORAGE_CONNECTION_STRING   Connection to data store
  - APP_URL                     Application base URL

Optional:
  - TEAMS_WEBHOOK_URL                   For Teams notifications
  - CACHE_TTL_MINUTES                   Cache duration (default: 10)
  - OFFLINE_SYNC_INTERVAL_SECONDS       Connectivity check interval (default: 5)
  - MAX_CHANGELOG_ENTRIES               Doodle changelog limit (default: 20)
```

### Automated Jobs (Scheduled)

1. **Backup Job** (e.g., twice weekly): Export all matches to JSON backup files
2. **Summary Regeneration** (after backup): Recompute all player summaries from match data, update storage
3. Both can be CI/CD pipeline jobs, cron jobs, or cloud functions

### Infrastructure as Code

Define resources declaratively (Bicep, Terraform, CloudFormation, Pulumi):

- Logging workspace
- Application monitoring
- Storage account with table/document service

---

## 9. Security Considerations

### Authentication & Authorization

- The existing app has minimal auth (community trust model)
- For broader deployment, consider:
  - Player authentication (each player edits only their own doodle)
  - Admin role for tournament management
  - Read-only mode for spectators

### Data Protection

- No PII beyond player names
- Connection strings / API keys must not be in source code
- Use environment variables or secret management
- HTTPS enforcement

### Input Validation

- All player names: trimmed, 1–50 chars, non-empty
- Scores: integers, non-negative, sum to 25
- Dates: valid calendar dates, reasonable range
- Player count: exactly 4, 8, 12, or 16

---

## 10. Extensibility Points

Areas designed for extension:

1. **ELO Variants** — Add new ELO algorithms by implementing the calculator interface
3. **Storage Backends** — Swap storage by implementing storage interfaces (SQL, NoSQL, file, etc.)
5. **Tournament Formats** — The pairing algorithm could be swapped (round-robin, Swiss, etc.)
6. **Statistics** — Add new stat types by extending the statistics calculation
7. **Theming** — UI theming is a presentation concern — implement with any design system
8. **Localization** — All strings should be externalizable for i18n
9. **Player Profiles** — Extend with avatars, bio, social links
10. **Seasons/Periods** — Add explicit season boundaries for stat resets

---

## 11. Technology Stack Recommendations

This spec is technology-agnostic, but here are proven options:

### Full-Stack Web (Server-Rendered)

- .NET Blazor, Ruby on Rails, Django, Laravel, Phoenix LiveView
- Good for: real-time updates, simpler deployment

### SPA + API

- React/Vue/Svelte + Node.js/Python/Go/.NET API
- Good for: mobile-first, offline-capable PWA

### Mobile Native

- React Native, Flutter, Swift/Kotlin
- Good for: best mobile UX, device features

### Low-Code

- Power Apps, Retool, Appsmith
- Good for: rapid prototyping, simple deployments

### Storage Options

- **Key-Value / Document:** Azure Table Storage, DynamoDB, Firestore
- **Relational:** PostgreSQL, MySQL, SQLite
- **Document:** MongoDB, CouchDB
- **File-Based:** JSON files on disk (simplest, great for small scale)
