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
  "generatedAt": "2026-05-08T00:00:00.000Z",
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

- ELO tab keeps multi-select.
- For selected players, app loads matching `elo_history_{playerId}.json` files.
- App merges selected files into chart datasets.
- If selected player file is missing, UI shows: `No ELO history file for: <name>`.
- If chart has no points for selection, UI shows settings hint to generate history.
- Latest Tournament section shows tournament date label next to title.
- Legacy `elo_history.json` is not read or written.
