# 05 — Attendance Tracking & Doodle/Scheduling

> Technology-agnostic specification for attendance derivation, scheduling polls, and the members list.

---

## 1. Attendance Tracking

### 1.1 Overview

- Attendance is **not** tracked separately — it is derived from match participation data.
- If a player appears in any match on a given date, they are considered to have "attended" that tournament.
- This is a zero-maintenance approach: attendance updates automatically as matches are recorded.

### 1.2 Monthly Attendance

**Algorithm:**

```
function getMonthlyAttendance(year, month):
    // Get all matches for the given month
    matches = storage.getMatchesByYearMonth(year, month)

    // Group matches by date
    dateGroups = matches.groupBy(date)

    result = []
    for each (date, matchesOnDate) in dateGroups:
        // Extract ALL unique player names from all matches on this date
        players = matchesOnDate.flatMap(m => [
            m.team1Player1Name,
            m.team1Player2Name,
            m.team2Player1Name,
            m.team2Player2Name
        ]).distinct()

        result.add({
            date: date,
            players: players,
            playerCount: players.count
        })

    // Sort by date ascending
    return result.sortBy(date ASC)
```

### 1.3 Attendance Statistics

**Algorithm:**

```
function getAttendanceStatistics(matches, cutoffDate = null):
    // Optional: filter matches to only those on or after cutoffDate
    if cutoffDate != null:
        matches = matches.filter(m => m.date >= cutoffDate)

    // Determine total number of tournament dates
    tournamentDates = matches.map(m => m.date).distinct()
    totalTournaments = tournamentDates.count

    // Count how many tournament dates each player attended
    playerAttendance = {}  // playerName → set of dates attended

    for each match in matches:
        date = match.date
        for playerName in [match.team1Player1Name, match.team1Player2Name,
                           match.team2Player1Name, match.team2Player2Name]:
            playerAttendance.getOrCreate(playerName, emptySet).add(date)

    // Calculate statistics
    stats = []
    for each (playerName, dates) in playerAttendance:
        stats.add({
            playerName: playerName,
            attendanceCount: dates.count,
            attendancePercentage: (dates.count / totalTournaments) * 100,
            totalTournaments: totalTournaments
        })

    // Sort by attendance count descending, then name ascending
    return stats.sortBy(attendanceCount DESC, playerName ASC)
```

**Example:**

```
Period: January 2026 (8 tournaments held)
Player "Alex": appeared in matches on 6 of those dates
→ Attendance: 6 / 8 = 75%

Player "Bob": appeared in matches on 8 of those dates
→ Attendance: 8 / 8 = 100%
```

### 1.4 Attendance Display

**Monthly View:**

- Calendar-style view showing each tournament date in the month.
- For each date, list of players who attended.
- Player count per date.

**Statistics View (Table):**

| Rank | Player | Tournaments Attended | Total Tournaments | Attendance % |
|------|--------|----------------------|-------------------|--------------|
| 1    | Bob    | 8                    | 8                 | 100%         |
| 2    | Alex   | 6                    | 8                 | 75%          |

**Filtering:**

- By month/year (primary filter).
- Optional cutoff date (e.g., "only count from 2025-01-01 onwards").

---

## 2. Doodle/Scheduling System

### 2.1 Overview

- Players indicate which dates they are available for upcoming tournaments.
- Organized by month — each player selects dates for a specific month.
- Helps tournament organizers choose optimal dates based on player availability.
- Similar to Doodle poll functionality, but built into the app.

### 2.2 Data Model

**DoodleEntry:**

```
Fields:
  - playerName: string (the player selecting dates)
  - year: int (calendar year)
  - month: int (1-12)
  - selectedDates: list<string> (dates in "yyyy-MM-dd" format)

Storage key: composite of (year, month, playerName) — one entry per player per month
```

**DoodleRow (Display Model):**

```
Fields:
  - name: string (player name)
  - selected: map<string, boolean> (date → isSelected)
  - allowEdit: boolean (whether this row can be edited by current user)
```

### 2.3 Doodle Operations

**Get Doodle for Month:**

```
function getDoodle(year, month):
    // Retrieve all entries for this month
    entries = storage.getDoodleEntries(year, month)

    // Get all possible dates in this month (weekdays, or specific days)
    // Usually: all dates in the month that fall on the regular play days

    rows = []
    for each entry in entries:
        selected = {}
        for each date in allDatesInMonth(year, month):
            selected[date] = entry.selectedDates.contains(date)

        rows.add(new DoodleRow(
            name: entry.playerName,
            selected: selected,
            allowEdit: true  // or based on authentication
        ))

    return rows
```

**Save Doodle:**

```
function saveDoodle(playerName, year, month, selectedDates):
    // Validate
    assert selectedDates are all within the given year/month
    assert playerName is non-empty

    // Delete previous selection for this player/month
    storage.deleteDoodle(playerName, year, month)

    // Save new selection
    entry = new DoodleEntry(
        playerName: playerName,
        year: year,
        month: month,
        selectedDates: selectedDates
    )
    storage.saveDoodleEntry(entry)

    // Log to changelog
    logDoodleChange(playerName, year, month, selectedDates)
```

**Delete Doodle:**

```
function deleteDoodle(playerName, year, month):
    storage.deleteDoodleEntry(playerName, year, month)
    logDoodleChange(playerName, year, month, [])  // Empty selection logged
```

### 2.4 Changelog / Audit Trail

Track recent doodle changes for transparency:

```
function logDoodleChange(playerName, year, month, selectedDates):
    entry = new ChangelogEntry(
        timestamp: now(),
        playerName: playerName,
        selectedDates: selectedDates,
        year: year,
        month: month
    )
    storage.saveChangelogEntry(entry)

    // Keep only last 20 entries
    allEntries = storage.getChangelogEntries()
    if allEntries.count > 20:
        oldestEntries = allEntries.sortBy(timestamp ASC).take(allEntries.count - 20)
        for each old in oldestEntries:
            storage.deleteChangelogEntry(old)
```

**Display:** Show recent changes like:

```
"Alex updated availability for March 2026 — selected: Mar 3, Mar 10, Mar 17"
"Bob updated availability for March 2026 — selected: Mar 5, Mar 12"
```

### 2.5 Doodle UI Flow

**Calendar Matrix View:**

```
           | Mar 3 | Mar 5 | Mar 10 | Mar 12 | Mar 17 | Mar 19 |
-----------|-------|-------|--------|--------|--------|--------|
Alex       |   ✓   |       |   ✓    |        |   ✓    |        |
Bob        |       |   ✓   |        |   ✓    |        |        |
Carol      |   ✓   |   ✓   |   ✓    |   ✓    |   ✓    |   ✓    |
Totals     |   2   |   2   |   2    |   2    |   2    |   1    |
```

**Features:**

- Tabbed by month (navigate between months).
- Each player has a row showing their date selections.
- Column totals show how many players are available per date.
- Players can toggle their own dates on/off.
- "Select All" / "Deselect All" shortcuts.
- Highlight dates with highest availability.
- Show changelog/recent updates below the calendar.

**Month Navigation:**

- Default to current month and next month.
- Allow navigating to any future month.
- Past months are view-only.

---

## 3. Members List

### 3.1 Overview

- A static list of known community members.
- Used as **autocomplete suggestions** when entering player names during tournament creation.
- Not a strict constraint — new names can be entered that are not in the list.
- Helps avoid typos and inconsistent naming (e.g., "Alex" vs "alex" vs "Alexander").

### 3.2 Data Model

```
MembersList:
  - members: list<string> (player names)

Storage: Can be a simple configuration file, database table, or hardcoded list
```

### 3.3 Usage in Tournament Creation

```
function getPlayerNameSuggestions(partialInput):
    return membersList
        .filter(name => name.toLowerCase().startsWith(partialInput.toLowerCase()))
        .sortBy(name ASC)
```

---

## 4. Integration: Attendance + Doodle

These features complement each other:

- **Doodle** (forward-looking): "Which dates CAN you play?"
- **Attendance** (backward-looking): "Which dates DID you play?"

**Possible Enhancement:**

- Compare doodle responses to actual attendance to identify no-shows.
- Use attendance patterns to predict future availability.
- Highlight players with declining attendance.
