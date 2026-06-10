# Feature: Add Member → players.json Entry

## Overview
When a new member is added via Settings, the app creates a corresponding player
entry in `players.json` on the GitHub backend with zeroed stats and a new UUID.
The change is pushed immediately and the local members cache is refreshed.

## Trigger
Settings page → Members section → "Add" button submit.

## Behaviour

### Pre-conditions
- GitHub must be configured (owner, repo, PAT). If not → throw error, block add.
- `players.json` must exist in the repo. If not → throw error, block add.
- Member name must not already exist in players.json (case-insensitive). If duplicate → throw.

### New Player Entry Shape
```json
{
  "Name": "<trimmed name>",
  "ELO": 1000,
  "PreviousELO": 1000,
  "Wins": 0,
  "Losses": 0,
  "TotalPoints": 0,
  "Average": 0,
  "Tournaments": 0,
  "Id": "<crypto.randomUUID()>",
  "MatchPadelId": 0
}
```

### Post-conditions
1. New entry appended to `players.json` array on GitHub.
2. Local `members` cache and `players_summary` cache invalidated and refreshed from updated array.
3. Members list in Settings UI refreshed.

## Implementation

### `addPlayerToPlayersJson(name)` — `js/services/github.js`
1. Verify GitHub configured — throw if not.
2. Build `playersPath` via `matchesBase()`.
3. `readFile(playersPath)` — get array + SHA. Throw if null.
4. Check no duplicate name (case-insensitive) — throw if found.
5. Build new player object with `crypto.randomUUID()`.
6. Append to array and `writeFile(playersPath, array, sha)`.
7. Refresh: `Cache.del('members')`, `Cache.del('players_summary')`, update Store from new array.

### Settings submit handler — `js/pages/settings.js`
- `await addPlayerToPlayersJson(name)` after `addMember(name)`.
- Button disabled + text "Adding…" while async.
- Toast "Name added" on success.
- Toast error message on failure (member also rolled back from local store).
