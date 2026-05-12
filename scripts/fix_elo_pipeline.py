"""
fix_elo_pipeline.py

Full ELO pipeline fix — runs locally against backup-data.
Produces:
  1. backup-data/YYYY/YYYY-MM/players_overview.json  (all months)
  2. backup-data/elo_history/elo_history_<id>.json   (per player)
  3. backup-data/players.json                         (with IDs preserved)

Algorithm mirrors js/services/elo.js exactly (sequential within each match).
"""

import json
import math
import os
import re
import glob
from collections import defaultdict
from datetime import datetime

DATA_ROOT = r"C:\Private\DataHub_Mexicano\mexicano_v3\backup-data"

K = 32
INITIAL_ELO = 1000


# ── ELO math ─────────────────────────────────────────────────────────────────

def combined_opp_elo(opp1, opp2):
    return math.sqrt((opp1 ** 2 + opp2 ** 2) / 2)


def expected_score(player_elo, opp_elo):
    return 1 / (1 + 10 ** ((opp_elo - player_elo) / 400))


def calc_elo(player_elo, opp1, opp2, won):
    combined = combined_opp_elo(opp1, opp2)
    exp = expected_score(player_elo, combined)
    new = player_elo + K * ((1.0 if won else 0.0) - exp)
    return round(new * 100) / 100


def process_match(match, state):
    """Sequential ELO update — same order as js/services/elo.js processMatchElo."""
    t1p1 = match["Team1Player1Name"]
    t1p2 = match["Team1Player2Name"]
    t2p1 = match["Team2Player1Name"]
    t2p2 = match["Team2Player2Name"]
    won = match["ScoreTeam1"] > match["ScoreTeam2"]

    for n in (t1p1, t1p2, t2p1, t2p2):
        if n not in state:
            state[n] = INITIAL_ELO

    # team1 — uses original team2 ELOs
    t2p1_orig = state[t2p1]
    t2p2_orig = state[t2p2]
    state[t1p1] = calc_elo(state[t1p1], t2p1_orig, t2p2_orig, won)
    state[t1p2] = calc_elo(state[t1p2], t2p1_orig, t2p2_orig, won)
    # team2 — uses updated team1 ELOs
    state[t2p1] = calc_elo(t2p1_orig, state[t1p1], state[t1p2], not won)
    state[t2p2] = calc_elo(t2p2_orig, state[t1p1], state[t1p2], not won)


# ── Load matches ──────────────────────────────────────────────────────────────

def load_matches(data_root):
    matches = []
    for path in glob.glob(os.path.join(data_root, "**", "*.json"), recursive=True):
        if not re.match(r"^\d{4}-\d{2}-\d{2}\.json$", os.path.basename(path)):
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        matches.extend(data.get("matches", []))
    return matches


def sort_key(m):
    return f"{m['Date']}.{str(m['RoundNumber']).zfill(2)}"


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Loading matches…")
    all_matches = load_matches(DATA_ROOT)
    valid = [m for m in all_matches if not (m["ScoreTeam1"] == 0 and m["ScoreTeam2"] == 0)]
    valid.sort(key=sort_key)
    print(f"  {len(valid)} valid matches")

    # Load existing players.json to preserve IDs
    players_json_path = os.path.join(DATA_ROOT, "players.json")
    existing_ids = {}
    if os.path.exists(players_json_path):
        with open(players_json_path, encoding="utf-8") as f:
            for p in json.load(f):
                if p.get("Name") and p.get("Id"):
                    existing_ids[p["Name"].strip().lower()] = p["Id"]
    print(f"  {len(existing_ids)} existing player IDs loaded")

    # ── Replay ELO globally, snapshot after each tournament day ──────────────
    elo_state = {}           # name -> current elo
    # per_player_history[name] = [(date, elo_after_day), ...]  chronological
    per_player_history = defaultdict(list)
    # month_stats[month][name] = {points, wins, losses, games}
    month_stats = defaultdict(lambda: defaultdict(lambda: {"points": 0, "wins": 0, "losses": 0, "games": 0}))
    # elo_snapshots[month][name] = [(date, elo), ...]
    elo_snapshots = defaultdict(lambda: defaultdict(list))

    # Group by date
    by_date = defaultdict(list)
    for m in valid:
        by_date[m["Date"]].append(m)
    sorted_dates = sorted(by_date.keys())

    print("Replaying ELO…")
    for date in sorted_dates:
        month = date[:7]
        day_matches = by_date[date]
        day_players = set()

        for m in day_matches:
            # Stats
            t1won = m["ScoreTeam1"] > m["ScoreTeam2"]
            for name in (m["Team1Player1Name"], m["Team1Player2Name"]):
                s = month_stats[month][name]
                s["points"] += m["ScoreTeam1"]
                s["games"] += 1
                s["wins" if t1won else "losses"] += 1
            for name in (m["Team2Player1Name"], m["Team2Player2Name"]):
                s = month_stats[month][name]
                s["points"] += m["ScoreTeam2"]
                s["games"] += 1
                s["wins" if not t1won else "losses"] += 1
            # Track players on this day
            for name in (m["Team1Player1Name"], m["Team1Player2Name"],
                         m["Team2Player1Name"], m["Team2Player2Name"]):
                day_players.add(name)
            # ELO update
            process_match(m, elo_state)

        # Snapshot after this day
        for name in day_players:
            elo = elo_state[name]
            per_player_history[name].append((date, elo))
            elo_snapshots[month][name].append({"Date": date, "ELO": elo})

    # ── 1. Write players_overview.json ───────────────────────────────────────
    print("Writing players_overview.json files…")
    written_months = 0
    for month in sorted(month_stats.keys()):
        year = month[:4]
        month_dir = os.path.join(DATA_ROOT, year, month)
        if not os.path.isdir(month_dir):
            continue
        overview = []
        for name, stats in month_stats[month].items():
            snaps = elo_snapshots[month].get(name) or [{"Date": month + "-01", "ELO": elo_state.get(name, INITIAL_ELO)}]
            avg = round(stats["points"] / stats["games"] * 100) / 100 if stats["games"] else 0
            overview.append({
                "Name": name,
                "Total_Points": stats["points"],
                "Wins": stats["wins"],
                "Losses": stats["losses"],
                "Average": avg,
                "ELO": snaps,
            })
        overview.sort(key=lambda p: p["ELO"][-1]["ELO"] if p["ELO"] else INITIAL_ELO, reverse=True)
        out = os.path.join(month_dir, "players_overview.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(overview, f, indent=2, ensure_ascii=False)
        written_months += 1
    print(f"  {written_months} monthly overviews written")

    # ── 2. Write elo_history files ────────────────────────────────────────────
    print("Writing elo_history files…")
    elo_history_dir = os.path.join(DATA_ROOT, "elo_history")
    os.makedirs(elo_history_dir, exist_ok=True)

    now_iso = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    written_hist = 0
    for name, history in per_player_history.items():
        key = name.strip().lower()
        player_id = existing_ids.get(key)
        if not player_id:
            continue  # skip players without an ID (not in players.json yet)

        points = []
        for i, (date, elo) in enumerate(history):
            delta = round((elo - history[i - 1][1]) * 10) / 10 if i > 0 else 0
            points.append({"date": date, "elo": elo, "delta": delta})

        payload = {
            "generatedAt": now_iso,
            "playerId": player_id,
            "playerName": name,
            "points": points,
            "dates": [p["date"] for p in points],
        }
        out = os.path.join(elo_history_dir, f"elo_history_{player_id}.json")
        with open(out, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        written_hist += 1
    print(f"  {written_hist} elo_history files written")

    # ── 3. Write players.json ─────────────────────────────────────────────────
    print("Writing players.json…")
    # All-time stats
    alltime = defaultdict(lambda: {"pts": 0, "wins": 0, "losses": 0, "games": 0, "dates": set()})
    for m in valid:
        t1won = m["ScoreTeam1"] > m["ScoreTeam2"]
        for name in (m["Team1Player1Name"], m["Team1Player2Name"]):
            alltime[name]["pts"] += m["ScoreTeam1"]
            alltime[name]["games"] += 1
            alltime[name]["dates"].add(m["Date"])
            alltime[name]["wins" if t1won else "losses"] += 1
        for name in (m["Team2Player1Name"], m["Team2Player2Name"]):
            alltime[name]["pts"] += m["ScoreTeam2"]
            alltime[name]["games"] += 1
            alltime[name]["dates"].add(m["Date"])
            alltime[name]["wins" if not t1won else "losses"] += 1

    def prev_elo(name):
        hist = per_player_history.get(name, [])
        if len(hist) < 2:
            return INITIAL_ELO
        return hist[-2][1]

    # Generate unique IDs for new players not in existing_ids
    import uuid
    result = []
    for name, elo in sorted(elo_state.items(), key=lambda x: x[1], reverse=True):
        key = name.strip().lower()
        pid = existing_ids.get(key)
        if not pid:
            pid = str(uuid.uuid4())
            existing_ids[key] = pid
            print(f"  NEW player ID generated: {name} → {pid}")
        s = alltime[name]
        games = s["games"]
        result.append({
            "Id": pid,
            "Name": name,
            "ELO": elo,
            "PreviousELO": prev_elo(name),
            "Wins": s["wins"],
            "Losses": s["losses"],
            "TotalPoints": s["pts"],
            "Average": round(s["pts"] / games * 100) / 100 if games else 0,
            "Tournaments": len(s["dates"]),
        })

    with open(players_json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"  {len(result)} players written to players.json")

    # ── Verify Mino ────────────────────────────────────────────────────────────
    mino = next((p for p in result if p["Name"].lower() == "mino"), None)
    if mino:
        print(f"\nMino ELO: {mino['ELO']}  (PreviousELO: {mino['PreviousELO']})")

    print("\nDone. Commit backup-data to remote.")


if __name__ == "__main__":
    main()
