# Per-Player ELO History Files

## Goal
Replace single large `elo_history.json` with one history file per player.

## Storage Contract

- `players.json` now includes stable player ID:
```json
{
  "Id": "uuid",
  "Name": "Alice",
  "ELO": 1082.5,
  "PreviousELO": 1070.0,
  "Wins": 10,
  "Losses": 8,
  "TotalPoints": 220,
  "Average": 13.75,
  "Tournaments": 5
}
```

- Per-player history files live at:
`backup-data/elo_history/elo_history_{playerId}.json`

- File shape:
```json
{
  "playerId": "uuid",
  "playerName": "Alice",
  "points": [
    { "date": "2026-04-01", "elo": 1000, "delta": 0 },
    { "date": "2026-04-08", "elo": 1016, "delta": 16 }
  ],
  "dates": ["2026-04-01", "2026-04-08"]
}
```

## Generation Rules

1. Settings action **Generate per-player ELO history**:
   - reads all monthly `YYYY/YYYY-MM/players_overview.json`
   - rebuilds per-player history
   - writes one file for each player ID in `players.json`

2. Tournament completion auto-update:
   - order remains: `generateMonthlyOverviews` -> `generatePlayersJson`
   - then regenerate ELO history only for participating players

## ELO Tab Read Flow

- ELO tab keeps multi-select in a **single combined block** of rolling cache chips. The chip block **wraps onto multiple rows** so long names never push controls outside the viewport. The `+ Add` and `−`/remove controls are **not** in this block.
- `+ Add` and the remove-toggle control both live in the page header, right-anchored next to the "ELO Charts" title. `+ Add` is a bigger `+` icon button; clicking it opens the typeahead there.
- Cache chips render greyed-out when deselected and highlighted when selected; clicking a chip toggles that player in/out of the chart (selection always keeps ≥1 player). Chip stays in the block regardless of select state.
- Rolling cache updater: `updateEloCache(cache, name)` — dedupes; appends `name` at the end; **unlimited size, no eviction**; ignores empty/null; never mutates input. Cache persists in localStorage prefs under `elo-cache`.
- Remove control: a `−` button next to `+ Add`. Clicking `−` enters **remove mode** — every cache chip shows a `−` indicator (danger-tinted) and clicking a chip removes it from the cache (and deselects it, re-selecting the first remaining cached player if selection would empty). The `−` button becomes a `✓` (save) button; clicking `✓` persists the trimmed cache and exits remove mode. Pure remover: `removeFromEloCache(cache, name)` — filters out `name`; never mutates input.
- `+ Add` types a name not yet in the cache; picking it appends it to the cache and selects it. Typeahead suggestions exclude names already in the cache.
- Member picker `+ Add` is a typeahead: click reveals text input; typing filters available (unselected) players case-insensitively by substring, sorted A→Z. ArrowUp/Down navigate, Enter picks active (or first) match, Escape/blur closes. Pure filter: `filterMemberSuggestions(allMembers, selectedMembers, query)`.
- For selected players, app loads matching `elo_history_{playerId}.json` files.
- App merges selected files into chart datasets.
- If selected player file is missing, UI shows: `No ELO history file for: <name>`.
- If chart has no points for selection, UI shows settings hint to generate history.
- Latest Tournament section shows tournament date label next to title.
- Latest Tournament chart starts at **Round 0** = each player's ELO before this tournament (pre-tournament seed / `PreviousELO`). Actual tournament rounds (1..N) follow.
- Legacy `elo_history.json` is not read or written.
