# Data Pipeline

## What
Automated pipeline that regenerates player statistics JSON files when tournament data changes.

## Repos
- Scripts live in: `DataHub_Mexicano/mexicano_v3/scripts/`
- Data lives in: `DataHub_Mexicano/mexicano_v3/backup-data/`
- Workflow lives in: `DataHub_Mexicano/.github/workflows/update-data-pipeline.yml`

## Scripts

### generate_monthly_overviews.py
Replays full ELO history across all match data and writes `players_overview.json`
into each monthly folder (`backup-data/YYYY/YYYY-MM/players_overview.json`).

```
python generate_monthly_overviews.py                   # current month (default)
python generate_monthly_overviews.py --month 2026-06   # specific month
python generate_monthly_overviews.py --all             # all months
python generate_monthly_overviews.py --data-root PATH  # override data root
```

Output per month: `[{ Name, Total_Points, Wins, Losses, Average, ELO: [{Date, ELO}] }]`

### generate_players.py
Reads all `players_overview.json` files (no raw match processing), aggregates
all-time stats per player, and writes `backup-data/players.json`.
Preserves the `Id` field (and other identity fields) from existing `players.json`
by merging entries on `Name`.

```
python generate_players.py                   # reads all overview files
python generate_players.py --data-root PATH  # override data root
```

Output: `[{ Id, Name, ELO, PreviousELO, Wins, Losses, TotalPoints, Average, Tournaments }]`

## Workflow Triggers

| Trigger | Behavior |
|---------|----------|
| Push — `tournaments.json` modified | Regenerate current month overview → rebuild players.json |
| `workflow_dispatch` (all_time: false) | Same as push trigger |
| `workflow_dispatch` (all_time: true) | Regenerate ALL months' overviews → rebuild players.json |

## Local Run
```bash
cd C:\Private\DataHub_Mexicano\mexicano_v3\scripts

# Current month
python generate_monthly_overviews.py
python generate_players.py

# Specific month
python generate_monthly_overviews.py --month 2026-05
python generate_players.py

# Full history rebuild
python generate_monthly_overviews.py --all
python generate_players.py
```

## Data Flow
```
tournaments.json modified
        ↓
generate_monthly_overviews.py (--month YYYY-MM or --all)
        ↓ writes
backup-data/YYYY/YYYY-MM/players_overview.json
        ↓
generate_players.py (reads all overview files)
        ↓ writes
backup-data/players.json
```
