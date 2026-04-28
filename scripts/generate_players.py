"""
generate_players.py

Reads all tournament day files from the backup-data repo, replays the ELO
algorithm chronologically (matching js/services/elo.js exactly), and writes
players.json at the data repo root.

Output format:
  [{ "Name": "...", "ELO": 1042.57 }, ...]
  Sorted by ELO descending.
"""

import json
import math
import os
import re
import glob

DATA_ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'DataHub_Mexicano', 'mexicano_v3', 'backup-data')

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

    # P1 (team1 player1)
    players[t1p1] = calculate_classic_elo(
        players[t1p1], players[t2p1], players[t2p2], team1_won
    )
    # P2 (team1 player2)
    players[t1p2] = calculate_classic_elo(
        players[t1p2], players[t2p1], players[t2p2], team1_won
    )
    # P3 (team2 player1)
    players[t2p1] = calculate_classic_elo(
        players[t2p1], players[t1p1], players[t1p2], not team1_won
    )
    # P4 (team2 player2)
    players[t2p2] = calculate_classic_elo(
        players[t2p2], players[t1p1], players[t1p2], not team1_won
    )


def main():
    all_matches = load_all_matches(DATA_ROOT)

    # Filter out 0-0 matches
    valid = [m for m in all_matches if not (m["ScoreTeam1"] == 0 and m["ScoreTeam2"] == 0)]

    # Sort chronologically by date then round number
    valid.sort(key=build_sort_key)

    # Replay ELO while tracking per-player snapshots at end of each date
    players = {}  # name -> elo
    # date_snapshots[name][date] = elo at end of that date
    date_snapshots = {}

    current_date = None
    for match in valid:
        if match["Date"] != current_date:
            # Snapshot the previous date's final ELOs for all players who played
            if current_date is not None:
                for name, elo in players.items():
                    date_snapshots.setdefault(name, {})[current_date] = elo
            current_date = match["Date"]
        process_match_elo(match, players)

    # Snapshot the last date
    if current_date is not None:
        for name, elo in players.items():
            date_snapshots.setdefault(name, {})[current_date] = elo

    # For each player, find their second-to-last tournament date (dates they played in)
    # A player "played in" a date if their ELO changed on that date vs the previous snapshot
    def get_previous_elo(name):
        if name not in date_snapshots:
            return INITIAL_ELO
        snapshots = date_snapshots[name]
        dates = sorted(snapshots.keys())
        # Find dates where this player actually participated (ELO changed)
        played_dates = []
        prev_elo = INITIAL_ELO
        for d in dates:
            if snapshots[d] != prev_elo:
                played_dates.append(d)
            prev_elo = snapshots[d]
        if len(played_dates) <= 1:
            return INITIAL_ELO
        second_to_last = played_dates[-2]
        return snapshots[second_to_last]

    # All-time stats aggregation
    alltime = {}
    for m in valid:
        t1names = [m["Team1Player1Name"], m["Team1Player2Name"]]
        t2names = [m["Team2Player1Name"], m["Team2Player2Name"]]
        team1_won = m["ScoreTeam1"] > m["ScoreTeam2"]
        date = m["Date"]
        for name in t1names:
            if name not in alltime:
                alltime[name] = {"pts": 0, "wins": 0, "losses": 0, "games": 0, "dates": set()}
            alltime[name]["pts"] += m["ScoreTeam1"]
            alltime[name]["games"] += 1
            alltime[name]["dates"].add(date)
            alltime[name]["wins" if team1_won else "losses"] += 1
        for name in t2names:
            if name not in alltime:
                alltime[name] = {"pts": 0, "wins": 0, "losses": 0, "games": 0, "dates": set()}
            alltime[name]["pts"] += m["ScoreTeam2"]
            alltime[name]["games"] += 1
            alltime[name]["dates"].add(date)
            alltime[name]["wins" if not team1_won else "losses"] += 1

    # Build output sorted by ELO descending
    result = sorted(
        [
            {
                "Name": name,
                "ELO": elo,
                "PreviousELO": get_previous_elo(name),
                "Wins": alltime.get(name, {}).get("wins", 0),
                "Losses": alltime.get(name, {}).get("losses", 0),
                "TotalPoints": alltime.get(name, {}).get("pts", 0),
                "Average": round(alltime.get(name, {}).get("pts", 0) / max(alltime.get(name, {}).get("games", 1), 1) * 100) / 100,
                "Tournaments": len(alltime.get(name, {}).get("dates", set())),
            }
            for name, elo in players.items()
        ],
        key=lambda p: p["ELO"],
        reverse=True,
    )

    output_path = os.path.join(DATA_ROOT, "players.json")
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"Written {len(result)} players to {output_path}")


if __name__ == "__main__":
    main()
