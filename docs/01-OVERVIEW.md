# 01 — Mexicano Tournament Manager: Application Overview

> Technology-agnostic specification for building a Mexicano Tournament Management
> application from scratch. This document is the entry point for any team or
> individual wanting to implement the system in **any** technology stack.

---

## Table of Contents

1. [Introduction & Purpose](#1-introduction--purpose)
2. [Feature Map](#2-feature-map)
3. [Application Architecture](#3-application-architecture-technology-agnostic)
4. [Pages / Screens Inventory](#4-pages--screens-inventory)
5. [Navigation Structure](#5-navigation-structure)
6. [Data Flow Overview](#6-data-flow-overview)
7. [Cross-Cutting Concerns](#7-cross-cutting-concerns)

---

## 1. Introduction & Purpose

### What Is Mexicano?

Mexicano is a dynamic **2-vs-2 padel/tennis tournament format** in which
pairings change every round based on accumulated performance. After each round
the leaderboard is recalculated, and the next round's teams are formed so that
the strongest player in each group of four is paired with the weakest, producing
balanced and competitive matches throughout the event.

### What Does This Application Do?

The **Mexicano Tournament Manager** is a full-featured web application that
covers the complete lifecycle of recurring Mexicano tournaments:

| Concern | Description |
|---------|-------------|
| **Live tournament management** | Create, run, and score multi-round Mexicano tournaments for 4, 8, 12, or 16 players in real time. |
| **ELO rating system** | Track player skill with two independent ELO variants (Classic and Scored) across all tournaments. |
| **Player statistics** | Per-tournament and all-time stats: wins, losses, points, averages, win rate, and categorised win types. |
| **Attendance tracking** | Derive attendance from match participation; display monthly views and historical percentages. |
| **Scheduling / Doodle** | Players indicate availability for upcoming dates. Organizers use a calendar matrix to pick tournament days. |
| **Offline support** | Queue changes when connectivity is lost and auto-sync when it returns. |

### Target Audience

A recurring group of roughly **25 players** who play regularly (e.g., twice per
week). The app is designed for a single community, not multi-tenant use.

---

## 2. Feature Map

### 2.1 Tournament Engine

The tournament engine is the core of the application.

**Player requirements**

- Exactly **4, 8, 12, or 16 players** (multiples of 4).
- Player names must be **unique** (case-insensitive) and between **1–50
  characters**.

**Court distribution**

| Players | Courts | Matches per Round |
|---------|--------|-------------------|
| 4       | 1      | 1                 |
| 8       | 2      | 2                 |
| 12      | 3      | 3                 |
| 16      | 4      | 4                 |

**Scoring**

- Every match distributes exactly **25 points** between two teams.
- Both players on a team receive the **same** score (e.g., if Team 1 wins
  15-10, each Team 1 player gets 15 points).
- Validation rule: `team1Score ≥ 0 AND team2Score ≥ 0 AND team1Score +
  team2Score = 25`.

**Pairing — Round 1 (entry order)**

Players are grouped into consecutive groups of four by their entry order. Within
each group the first and last are teamed together against the middle two:

```
Group [A, B, C, D]:
  Match → A + D  vs  B + C
```

**Pairing — Subsequent rounds (Mexicano algorithm)**

1. Sort all players by the ranking rules (see below).
2. Take consecutive groups of four from the sorted list.
3. Within each group, pair rank 1 + rank 4 vs rank 2 + rank 3.

This ensures the strongest player compensates for the weakest in each group,
while mid-tier players face each other directly.

**Ranking rules** (highest priority first):

1. **Total Points** (descending)
2. **Wins** (descending)
3. **Points Per Game** (descending)
4. **Player Name** (alphabetical, ascending — final tiebreaker)

Players with identical Total Points **and** Wins share the same rank. The next
rank skips by the number of tied players (e.g., two players tied at rank 2 →
next rank is 4).

**Round progression**

- The tournament supports **unlimited rounds** — it continues until manually
  stopped.
- A round is complete when **all** its matches have valid scores (sum = 25).
- The next round cannot start until the current round is fully complete.
- Generating the next round recalculates all statistics from scratch and applies
  the Mexicano pairing algorithm.

**Editing rules**

- A tournament is editable for **1 day** after its date. After that it becomes
  read-only.
- Editing a score in the **current** round only affects that match.
- Editing a score in a **previous** round triggers a full recalculation: all
  player stats are reset and recomputed from every completed match, and all
  rounds after the edited round are deleted and regenerated with the new
  pairings.

### 2.2 ELO Rating System

Two independent ELO variants run side-by-side:

| Variant | Actual Score Formula | Use Case |
|---------|---------------------|----------|
| **Classic ELO** | 1 (win) or 0 (loss) — binary | Head-to-head fairness; only win/loss matters |
| **Scored ELO** | `teamScore / 25` — continuous 0–1 | Rewards margin of victory |

**Calculation**

```
Combined Opponent ELO = √(opponent1_elo² + opponent2_elo²)

Expected Score = 1 / (1 + 10^((combinedOpponentElo − playerElo) / 400))

New ELO = playerElo + K × (actualScore − expectedScore)
```

| Constant | Value |
|----------|-------|
| K-Factor | 32 |
| Rating denominator | 400 |
| Starting ELO (new player) | 1000 |

**Data tracked**

- ELO history per player per tournament date.
- ELO change per tournament (delta from previous).
- All-time trajectory for chart visualisation.

### 2.3 Player Statistics

**Per-tournament metrics** (recalculated after every score entry):

| Metric | Definition |
|--------|------------|
| Total Points | Sum of all points earned across rounds |
| Games Played | Number of matches played |
| Wins | Matches where player's team scored > opponent |
| Losses | Matches where player's team scored < opponent |
| Points Per Game | `TotalPoints / GamesPlayed` |
| Win Percentage | `(Wins / GamesPlayed) × 100` |

**Win categories** (tracked across all tournaments for achievements):

| Category | Condition |
|----------|-----------|
| Tight Wins (Nail-Biters) | Win with exactly 1-point margin (13-12) |
| Solid Wins (Strong Wins) | Win with margin 15–20 |
| Dominating Wins (Crushing) | Win with margin ≥ 20 |

**Placement tracking**: 1st / 2nd / 3rd place finishes per tournament.

**All-time statistics** are aggregated into persistent player summaries:
total tournaments, total wins/losses, win categories, and placement counts.

### 2.4 Achievement System

**Categories** (8 total, each with 21 tiers):

1. **Participation** — Tournament attendance milestones
2. **Wins** — Total match victories
3. **Nail-Biters** — Tight 13-12 wins
4. **Strong Wins** — Comfortable-margin wins (15–20)
5. **Crushing Victories** — Dominant wins (≥ 20 margin)
6. **1st Place Finishes**
7. **2nd Place Finishes**
8. **3rd Place Finishes**

**Tiers** (5 levels):

| Tier | Sub-Tiers | Point Range |
|------|-----------|-------------|
| Bronze | 4 | 1–10 |
| Silver | 5 | 15–50 |
| Gold | 4 | 50–150 |
| Platinum | 4 | 100–350 |
| Legend | 4 | 400–650 |

Each achievement has:
- A unique identifier
- Human-readable name and description
- Tier and sub-tier
- Point value awarded on unlock
- Requirement type (e.g., `TournamentCount`, `WinsCount`) and target value
- Optional secret flag (hidden until unlocked)

**Progress tracking** per player-achievement:
- `isUnlocked`, `currentValue`, `requiredValue`
- `progress` (0.0–1.0), `unlockedDate`
- Display: `"X / Y"` or `"Unlocked"`

**Leaderboard entry**:

```
playerName, totalPoints, totalAchievements,
bronzeCount, silverCount, goldCount, platinumCount,
completionPercentage, rank
```

### 2.5 Attendance Tracking

- Derived from match data: extract unique player names per tournament date.
- A player appearing in one or more matches on a date counts as **one
  attendance** for that date.
- Views: monthly calendar, per-player attendance count, attendance percentage
  (`attendanceCount / totalTournaments × 100`).
- Supports optional cut-off date for recent-only calculations.

### 2.6 Doodle / Scheduling

- Players indicate their availability for upcoming dates within a given month.
- Data model: `(year, month, playerName, selectedDates[])`.
- UI: a calendar matrix — rows are players, columns are dates, cells are
  toggleable availability indicators.
- A **changelog / audit trail** records every update (who changed what, when).
- Organizers use the aggregated availability to pick optimal tournament dates.

### 2.7 Offline Support

- Detect connectivity via the platform's online/offline API.
- **Online**: all operations sync immediately to persistent storage.
- **Offline**:
  - Current tournament state saved to local/client storage.
  - Score updates queued in a pending sync list.
- **Reconnect**:
  - Pending matches synced to persistent storage.
  - Queue cleared on success.
  - Application state re-initialised from persistent storage.

### 2.8 Notifications

Webhook-based integration (e.g., Microsoft Teams Incoming Webhook).

| Method | Theme | Use Case |
|--------|-------|----------|
| `SendMessage` | Default (blue) | General notifications |
| `SendAlert` | Red | Warnings / errors |
| `SendSuccess` | Green | Confirmations |
| `SendToUrl` | Custom | Arbitrary webhook target |

Message payload follows a card format with title, subtitle, markdown body, and
theme colour.

---

## 3. Application Architecture (Technology-Agnostic)

The system follows a **layered architecture** with clear separation of concerns.
Every layer communicates only with the layer directly below it. Business logic
is framework-agnostic and independently testable.

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                          │
│                                                                 │
│   Pages / Screens          Reusable Components                  │
│   ─────────────────        ─────────────────────────            │
│   Home / Dashboard         Tables & Data Grids                  │
│   Tournaments List         Cards (Match, Court, Player)         │
│   Tournament View          Score Input (slider + presets)       │
│   Create Tournament        Dialogs (Player Profile, ELO, etc.)  │
│   Statistics               Charts (ELO progression)             │
│   ELO Charts               Navigation (sidebar / drawer)        │
│   Attendance               Theme Toggle (light / dark)          │
│   Doodle / Scheduling      Snackbar / Toast notifications       │
│   Player Profile (dialog)                                       │
│   Mobile Tournament                                             │
├─────────────────────────────────────────────────────────────────┤
│                     BUSINESS LOGIC LAYER                        │
│                                                                 │
│   Tournament Service         ELO Calculator Service             │
│   ├─ Create tournament       ├─ Classic ELO                     │
│   ├─ Generate pairings       └─ Scored ELO                      │
│   ├─ Update scores                                              │
│   ├─ Advance rounds          Player Statistics Service          │
│   └─ Recalculate stats       ├─ Per-tournament stats            │
│                               └─ All-time aggregation           │
│   Player Ranking Service                                        │
│   └─ Sort by rules                                              │
│                                                                 │
│   Attendance Service                                            │
│   └─ Derive from matches                                        │
│                              Doodle Service                     │
│                              └─ CRUD availability               │
├─────────────────────────────────────────────────────────────────┤
│                     DATA ACCESS LAYER                           │
│                                                                 │
│   ┌──────────────────────────────────────────────────────┐      │
│   │           Abstract Storage Interface                 │      │
│   │   (Matches, PlayerSummaries, Doodle, Changelog)      │      │
│   └───────┬──────────────┬──────────────┬────────────────┘      │
│           │              │              │                       │
│   Cloud Storage    Relational DB   File-Based / JSON            │
│   (Table/Document) (SQL)           (Local / Embedded)           │
│           │              │              │                       │
│   ┌───────┴──────────────┴──────────────┴────────────────┐      │
│   │           Offline Storage Adapter                    │      │
│   │   (Client-side: LocalStorage, IndexedDB, SQLite)     │      │
│   └──────────────────────────────────────────────────────┘      │
├─────────────────────────────────────────────────────────────────┤
│                     INTEGRATION LAYER                           │
│                                                                 │
│   Scheduled Jobs                                                │
│   ├─ Backup match data (e.g., bi-weekly)                        │
│   ├─ Generate player summaries                                  │
│   └─ Sync / data export                                         │
└─────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

| Layer | Responsibility | Testability |
|-------|---------------|-------------|
| **Presentation** | Render UI, capture user input, call business logic services. No business rules here. | UI / integration tests |
| **Business Logic** | All domain rules: pairing, scoring, ELO, stats, achievements. Framework-agnostic. | Unit tests (no I/O) |
| **Data Access** | Persist and retrieve entities. Abstractions allow swapping storage backends. | Integration tests with fakes/mocks |
| **Integration** | External communication:scheduled jobs, CI/CD triggers. | Contract / integration tests |

---

## 4. Pages / Screens Inventory

| # | Screen | Route | Purpose |
|---|--------|-------|---------|
| 1 | **Home / Dashboard** | `/` | ELO rankings overview, quick stats, welcome landing page |
| 2 | **Tournaments List** | `/tournaments` | Browse all past and current tournaments by date |
| 3 | **Tournament View** | `/tournament/{date}` | View and manage the active tournament: rounds, matches, live scoring, leaderboard |
| 4 | **Create Tournament** | `/create-tournament` | Select player count, pick a date, enter player names, start the tournament |
| 5 | **Statistics** | `/statistics` | Detailed per-tournament and all-time player statistics with filtering and sorting |
| 6 | **ELO Charts** | `/elo-charts` | ELO progression charts — all-time trends and per-tournament deltas |
| 7 | **Attendance** | `/attendance` | Monthly attendance calendar, per-player attendance counts and percentages |
| 8 | **Doodle / Scheduling** | `/doodle` | Availability calendar for upcoming dates; players toggle their availability |
| 10 | **Player Profile** | *(dialog / overlay)* | Detailed view of an individual player: stats, ELO history, achievements, match history, opponents, partners |
| 11 | **Mobile Tournament** | `/mobile` | Optimised mobile view for live tournament scoring with court cards and FAB actions |

### Key UI Components

| Component | Description |
|-----------|-------------|
| **Score Input Sheet** | Bottom sheet / overlay with team name header, two numeric inputs (auto-calculating to 25), quick-pick buttons (e.g., 15-10, 13-12), a slider, and confirm/cancel actions. |
| **Match Card** | Displays one match: four player names, score (or tap-to-score if incomplete), court number. |
| **Player List / Leaderboard** | Sortable table showing rank, name, points, wins, losses, average, win rate. |
| **Round View** | Contains all match cards for a round, with completion progress indicator. |
| **Player Profile Dialog** | Tabbed dialog: overview stats, ELO chart, achievement progress, match history, head-to-head records. |
| **Data Grid** | Generic sortable/filterable table used across Statistics, Attendance, and Achievements screens. |

---

## 5. Navigation Structure

### Desktop (Sidebar / Drawer)

```
┌──────────────────────────────┐
│  🏸 Mexicano                 │
├──────────────────────────────┤
│  TOURNAMENT                  │
│    🏠  Home                  │
│    📋  Tournaments           │
│    ▶️  Latest Tournament     │
│                              │
│  STATISTICS                  │
│    📊  Statistics            │
│    📈  ELO Charts            │
│    📅  Attendance            │
│                              │
│  COMMUNITY                   │
│    🗓️  Doodle               │
│    🏆  Achievements          │
│                              │
│  ─────────────────           │
│    📱  Mobile View           │
│    ➕  Create Tournament     │
└──────────────────────────────┘
```

### Mobile

- **Hamburger menu** or **bottom navigation bar** with the most-used items
  (Home, Latest Tournament, Doodle, Achievements).
- Full navigation accessible via hamburger / drawer.

### Tournament-Aware Navigation

When a tournament is active, the app bar / header should display:
- Tournament name or date
- Current round number and completion status
- Quick-access button to jump to the active tournament

---

## 6. Data Flow Overview

### 6.1 Tournament Flow

```
Create Tournament
       │
       ▼
  Validate player count & names
       │
       ▼
  Assign player IDs (auto-increment)
       │
       ▼
  Generate Round 1 (entry-order pairing)
       │
       ▼
  ┌─── Score Entry Loop ───────────────────────────┐
  │                                                 │
  │   User enters / edits a match score             │
  │       │                                         │
  │       ▼                                         │
  │   Validate (sum = 25, non-negative)             │
  │       │                                         │
  │       ▼                                         │
  │   Persist match to storage                      │
  │       │                                         │
  │       ▼                                         │
  │   Recalculate ALL player stats from scratch     │
  │       │                                         │
  │       ▼                                         │
  │   If editing a previous round:                  │
  │     → Delete all subsequent rounds              │
  │     → Regenerate next round with new rankings   │
  │       │                                         │
  │       ▼                                         │
  │   Round complete? ──No──► Wait for more scores  │
  │       │                                         │
  │      Yes                                        │
  │       │                                         │
  │       ▼                                         │
  │   Generate next round (Mexicano pairing)        │
  │       │                                         │
  │       └────────────── loop ─────────────────────┘
  │
  ▼
Tournament ends (manual stop)
       │
       ▼
  Final stats & ELO persisted
```

### 6.2 Statistics Flow

```
Match data (all completed matches)
       │
       ▼
  Aggregate per player:
    totalPoints, wins, losses, gamesPlayed,
    tightWins, solidWins, dominatingWins,
    1st/2nd/3rd place finishes
       │
       ▼
  Calculate derived metrics:
    pointsPerGame, winPercentage
       │
       ▼
  Apply ranking rules → assign ranks
       │
       ▼
  Persist player summaries
       │
       ▼
  Display in leaderboards & statistics screens
```

### 6.3 ELO Flow

```
Match result (players, scores)
       │
       ▼
  For each player in the match:
    1. Compute combined opponent ELO
    2. Compute expected score
    3. Compute actual score (Classic: 0/1, Scored: teamScore/25)
    4. Apply: newElo = oldElo + K × (actual − expected)
       │
       ▼
  Update cumulative ELO per player
       │
       ▼
  Record (player, date, newElo) in ELO history
       │
       ▼
  Display progression charts & leaderboards
```

### 6.4 Attendance Flow

```
Match data
       │
       ▼
  Extract unique player names per tournament date
  (deduplicate across matches on same date)
       │
       ▼
  Build attendance records: [(date, [playerNames])]
       │
       ▼
  Aggregate monthly / all-time:
    per player: attendanceCount, attendancePercentage
       │
       ▼
  Display in monthly calendar & statistics views
```

### 6.5 Scheduling (Doodle) Flow

```
Player opens Doodle for month
       │
       ▼
  Load existing availability for (year, month)
       │
       ▼
  Player toggles dates → save selection
       │
       ▼
  Record change in changelog (audit trail)
       │
       ▼
  Optionally send webhook notification
       │
       ▼
  Organizer views matrix:
    rows = players, columns = dates, cells = available?
       │
       ▼
  Organizer picks tournament dates based on availability
```

---

## 7. Cross-Cutting Concerns

### 7.1 Caching

| Data | Strategy | TTL |
|------|----------|-----|
| Achievement leaderboard | In-memory cache | ~10 minutes |
| ELO data (charts) | In-memory cache | ~10 minutes |
| Player summaries | In-memory cache | ~10 minutes |
| Active tournament | In-memory (single instance) | Session lifetime |

A manual **refresh** action should be available to invalidate caches on demand
(e.g., a refresh button in the app bar).

### 7.2 Error Handling

- **Validation errors** surface immediately at the UI layer (e.g., invalid
  score, duplicate player name).
- **Error boundaries** around major page components prevent one failing section
  from crashing the entire app.
- **Graceful degradation**: if persistent storage is unavailable, fall back to
  offline mode and queue changes.
- **Optimistic concurrency**: use ETags or version stamps when updating shared
  data to detect conflicts.

### 7.3 Responsive Design

| Context | Optimisation |
|---------|--------------|
| **Mobile** (< 768 px) | Mobile-first for live tournament scoring. Court cards stacked vertically. Bottom sheet for score input. FAB for quick actions (leaderboard, next round). |
| **Tablet** (768–1024 px) | Two-column layout: matches + leaderboard side by side. |
| **Desktop** (> 1024 px) | Full sidebar navigation. Multi-column statistics grids. Expanded charts. |

### 7.4 Theming

- Support **light** and **dark** mode.
- User preference persisted in client storage (e.g., `localStorage`).
- Theme toggle accessible from the app bar / header.
- All UI components should respect the active theme (no hard-coded colours).

### 7.5 Offline / Connectivity

- Continuously monitor online status.
- Fire an event when status changes so the UI can display an indicator.
- All write operations check connectivity and route through the offline queue
  when disconnected.

### 7.6 Data Integrity

- Tournament editability window (1 day) prevents stale modifications.
- Score validation is enforced at both the UI and business logic layers.
- Player name uniqueness is checked case-insensitively before tournament
  creation.
- Statistics are always recalculated from raw match data (single source of
  truth), never incrementally patched.

---

*This document is the starting point. See the other specification documents in
`docs/` for detailed rules on the tournament engine, ELO system, statistics,
achievements, attendance, scheduling, and implementation guidance.*
