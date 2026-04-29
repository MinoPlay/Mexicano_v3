"""
generate_monthly_overviews.py

Reads all tournament day files from the backup-data repo, computes per-month
player statistics and ELO snapshots, and writes players_overview.json into
each monthly folder.

Output format per month:
  [{
    "Name": "...",
    "Total_Points": 245,
    "Wins": 12,
    "Losses": 8,
    "Average": 12.25,
    "ELO": [
      {"Date": "2024-01-10", "ELO": 1025.5},
      {"Date": "2024-01-17", "ELO": 1042.57}
    ]
  }, ...]
  Sorted by last ELO entry descending.
"""

import json
import math
import os
import re
import glob
from collections import defaultdict

DATA_ROOT = r"C:\Private\DataHub_Mexicano\mexicano_v3\backup-data"

K = 32
INITIAL_ELO = 1000


def calculate_combined_opponent_elo(opp1_elo, opp2_elo):
    return math.sqrt((opp1_elo ** 2 + opp2_elo ** 2) / 2)


def calculate_expected_score(player_elo, opponent_elo):
    return 1 / (1 + 10 ** ((opponent_elo - player_elo) / 400))


def calculate_classic_elo(player_elo, opp1_elo, opp2_elo, did_win):
    combined_opp = calculate_combined_opponent_elo(opp1_elo, opp2_elo)
    expected = calculate_expected_score(player_elo, combined_opp)
    actual = 1.0 if did_win else 0.0
    new_elo = player_elo + K * (actual - expected)
    return round(new_elo * 100) / 100


def build_sort_key(match):
    rn = str(match["RoundNumber"]).zfill(2)
    return f"{match['Date']}.{rn}"


def process_match_elo(match, players):
    """Process a single match and update player ELOs (sequential within match)."""
    t1p1 = match["Team1Player1Name"]
    t1p2 = match["Team1Player2Name"]
    t2p1 = match["Team2Player1Name"]
    t2p2 = match["Team2Player2Name"]
    team1_won = match["ScoreTeam1"] > match["ScoreTeam2"]

    for name in [t1p1, t1p2, t2p1, t2p2]:
        if name not in players:
            players[name] = INITIAL_ELO

    players[t1p1] = calculate_classic_elo(
        players[t1p1], players[t2p1], players[t2p2], team1_won
    )
    players[t1p2] = calculate_classic_elo(
        players[t1p2], players[t2p1], players[t2p2], team1_won
    )
    players[t2p1] = calculate_classic_elo(
        players[t2p1], players[t1p1], players[t1p2], not team1_won
    )
    players[t2p2] = calculate_classic_elo(
        players[t2p2], players[t1p1], players[t1p2], not team1_won
    )


def load_all_matches(data_root):
    """Load all matches from YYYY/YYYY-MM/YYYY-MM-DD.json files."""
    pattern = os.path.join(data_root, "**", "*.json")
    all_matches = []

    for filepath in glob.glob(pattern, recursive=True):
        filename = os.path.basename(filepath)
        if not re.match(r"^\d{4}-\d{2}-\d{2}\.json$", filename):
            continue

        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)

        for m in data.get("matches", []):
            all_matches.append(m)

    return all_matches


def get_match_month(match):
    """Extract YYYY-MM from a match's Date field."""
    return match["Date"][:7]


def main():
    all_matches = load_all_matches(DATA_ROOT)

    # Filter out 0-0 matches
    valid = [m for m in all_matches if not (m["ScoreTeam1"] == 0 and m["ScoreTeam2"] == 0)]

    # Sort chronologically
    valid.sort(key=build_sort_key)

    # Group matches by month
    matches_by_month = defaultdict(list)
    for m in valid:
        matches_by_month[get_match_month(m)].append(m)

    sorted_months = sorted(matches_by_month.keys())

    # Replay ELO across all months chronologically, snapshotting after each month
    elo_state = {}  # name -> elo (running state)
    months_written = 0

    for month in sorted_months:
        month_matches = matches_by_month[month]

        # Compute monthly stats before ELO replay (uses only this month's matches)
        month_stats = {}  # name -> {points, wins, losses, games}
        for m in month_matches:
            names_team1 = [m["Team1Player1Name"], m["Team1Player2Name"]]
            names_team2 = [m["Team2Player1Name"], m["Team2Player2Name"]]
            team1_won = m["ScoreTeam1"] > m["ScoreTeam2"]

            for name in names_team1:
                if name not in month_stats:
                    month_stats[name] = {"points": 0, "wins": 0, "losses": 0, "games": 0}
                month_stats[name]["points"] += m["ScoreTeam1"]
                month_stats[name]["games"] += 1
                if team1_won:
                    month_stats[name]["wins"] += 1
                else:
                    month_stats[name]["losses"] += 1

            for name in names_team2:
                if name not in month_stats:
                    month_stats[name] = {"points": 0, "wins": 0, "losses": 0, "games": 0}
                month_stats[name]["points"] += m["ScoreTeam2"]
                month_stats[name]["games"] += 1
                if not team1_won:
                    month_stats[name]["wins"] += 1
                else:
                    month_stats[name]["losses"] += 1

        # Replay ELO for this month's matches, snapshotting after each tournament day
        # Group matches by date (tournament day) within the month
        from collections import defaultdict as _dd
        matches_by_day = _dd(list)
        for m in month_matches:
            matches_by_day[m["Date"]].append(m)
        sorted_days = sorted(matches_by_day.keys())

        # elo_snapshots[name] = list of {"Date": ..., "ELO": ...} in day order
        elo_snapshots = {}
        for day in sorted_days:
            for m in matches_by_day[day]:
                process_match_elo(m, elo_state)
            # Collect all players who appear on this day
            day_players = set()
            for m in matches_by_day[day]:
                for key in ("Team1Player1Name", "Team1Player2Name", "Team2Player1Name", "Team2Player2Name"):
                    day_players.add(m[key])
            for name in day_players:
                if name not in elo_snapshots:
                    elo_snapshots[name] = []
                elo_snapshots[name].append({"Date": day, "ELO": elo_state[name]})

        # Build overview for this month
        overview = []
        for name, stats in month_stats.items():
            avg = round(stats["points"] / stats["games"] * 100) / 100 if stats["games"] > 0 else 0
            snapshots = elo_snapshots.get(name, [{"Date": month + "-01", "ELO": elo_state.get(name, INITIAL_ELO)}])
            overview.append({
                "Name": name,
                "Total_Points": stats["points"],
                "Wins": stats["wins"],
                "Losses": stats["losses"],
                "Average": avg,
                "ELO": snapshots,
            })

        overview.sort(key=lambda p: p["ELO"][-1]["ELO"] if p["ELO"] else INITIAL_ELO, reverse=True)

        # Write to the monthly folder
        year = month[:4]
        month_dir = os.path.join(DATA_ROOT, year, month)
        if os.path.isdir(month_dir):
            output_path = os.path.join(month_dir, "players_overview.json")
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(overview, f, indent=2, ensure_ascii=False)
            months_written += 1

    print(f"Written players_overview.json to {months_written} monthly folders")


if __name__ == "__main__":
    main()
