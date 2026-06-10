#!/usr/bin/env python3
"""
backfill_match_elos.py

WHEN TO USE: One-time (or recovery) operation when tournament day JSON files are
missing the embedded per-match ELO fields (Team1Player1Elo, etc.). Safe to re-run
— skips files where all matches already have ELO fields.

WHAT IT DOES:
  Walks all YYYY-MM-DD.json files in chronological order, chains player ELO state
  across every day, and writes the post-match ELO values directly into each match
  object. Does NOT update players.json or players_overview — run fix_elo_pipeline
  afterward if those also need rebuilding.

HOW TO RUN:
    python scripts/backfill_match_elos.py --data-root /path/to/backup-data
"""

import argparse
import json
import math
import os
import re

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}\.json$")
K = 32
INITIAL_ELO = 1000.0


def combined_opponent_elo(opp1, opp2):
    return math.sqrt((opp1 ** 2 + opp2 ** 2) / 2)


def expected_score(player_elo, opp_elo):
    return 1 / (1 + 10 ** ((opp_elo - player_elo) / 400))


def new_elo(player_elo, opp1_elo, opp2_elo, did_win):
    combined = combined_opponent_elo(opp1_elo, opp2_elo)
    exp = expected_score(player_elo, combined)
    actual = 1.0 if did_win else 0.0
    result = player_elo + K * (actual - exp)
    return round(result * 100) / 100


def ensure_player(players, name):
    if name not in players:
        players[name] = INITIAL_ELO


def process_match(match, players):
    """
    Replicates JS processMatchElo asymmetry:
    - Team1 players computed using Team2 ELOs BEFORE update
    - Team2 players computed using Team1 ELOs AFTER update
    """
    p1n = match["Team1Player1Name"]
    p2n = match["Team1Player2Name"]
    p3n = match["Team2Player1Name"]
    p4n = match["Team2Player2Name"]

    for n in [p1n, p2n, p3n, p4n]:
        ensure_player(players, n)

    team1_won = match["ScoreTeam1"] > match["ScoreTeam2"]

    # Team1 uses Team2 ELOs before update
    t2p3_before = players[p3n]
    t2p4_before = players[p4n]

    players[p1n] = new_elo(players[p1n], t2p3_before, t2p4_before, team1_won)
    players[p2n] = new_elo(players[p2n], t2p3_before, t2p4_before, team1_won)

    # Team2 uses Team1 ELOs after update
    players[p3n] = new_elo(players[p3n], players[p1n], players[p2n], not team1_won)
    players[p4n] = new_elo(players[p4n], players[p1n], players[p2n], not team1_won)


def has_elo_fields(match):
    return (match.get("Team1Player1Elo") is not None and
            match.get("Team1Player2Elo") is not None and
            match.get("Team2Player1Elo") is not None and
            match.get("Team2Player2Elo") is not None)


def collect_day_files(root):
    files = []
    for dirpath, _, filenames in os.walk(root):
        for fname in filenames:
            if DATE_PATTERN.match(fname):
                files.append(os.path.join(dirpath, fname))
    return sorted(files)  # lexicographic = chronological


def main():
    parser = argparse.ArgumentParser(description="Backfill embedded ELO fields into tournament day JSON files.")
    parser.add_argument("--data-root", required=True, help="Path to backup-data directory (e.g. /path/to/DataHub_Mexicano/mexicano_v3/backup-data)")
    args = parser.parse_args()
    BACKUP = args.data_root

    day_files = collect_day_files(BACKUP)
    print(f"Found {len(day_files)} day files in {BACKUP}")

    players = {}  # name → current ELO (chained across all days)
    updated = 0
    skipped = 0

    for filepath in day_files:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        matches = data.get("matches", [])
        if not matches:
            skipped += 1
            continue

        all_have_elo = all(has_elo_fields(m) for m in matches)

        # Sort by RoundNumber to process in correct order
        sorted_matches = sorted(matches, key=lambda m: m.get("RoundNumber", 0))

        for m in sorted_matches:
            # Skip 0-0 matches (no ELO change)
            if m["ScoreTeam1"] == 0 and m["ScoreTeam2"] == 0:
                continue

            process_match(m, players)

            if not all_have_elo:
                m["Team1Player1Elo"] = players[m["Team1Player1Name"]]
                m["Team1Player2Elo"] = players[m["Team1Player2Name"]]
                m["Team2Player1Elo"] = players[m["Team2Player1Name"]]
                m["Team2Player2Elo"] = players[m["Team2Player2Name"]]

        if all_have_elo:
            skipped += 1
        else:
            # Preserve original match order in file
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            print(f"  Updated: {os.path.basename(filepath)}")
            updated += 1

    print(f"\nDone. Updated {updated} files, skipped {skipped} files.")


if __name__ == "__main__":
    main()
