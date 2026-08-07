#!/usr/bin/env python3
"""Backup Supabase -> GitHub JSON archive.

Reads raw source-of-truth from Supabase and writes it back out in the exact
GitHub archive layout (the same files the app used to produce), so GitHub remains
a human-readable, restorable backup. Idempotent: only files whose content changed
are rewritten, so a caller can `git commit` on diff.

Layout written under --out-dir:
  players.json
  YYYY/YYYY-MM/YYYY-MM-DD.json              (match day files, PascalCase)
  YYYY/YYYY-MM/doodle_YYYY-MM.json
  YYYY/YYYY-MM/doodle_changelog_YYYY-MM.json
  data/attendance_manual.json
  data/changelog.json
  data/administrators.json
  data/active_tournament.json               (only when an active tournament exists)

Derived data (ELO, stats, overviews, elo_history, tournaments index) is NOT
written — it is recomputed by the app at runtime.

Env vars:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (service_role recommended; anon works
                                             if RLS allows read)

Usage:
  python scripts/backup_supabase_to_github.py --out-dir ./_archive/mexicano_v3/backup-data

Requires: requests
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict

import requests


class Supabase:
    def __init__(self, url: str, key: str):
        self.rest = url.rstrip("/") + "/rest/v1"
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}"}

    def select(self, table: str, columns: str = "*", order: str | None = None) -> list:
        params = {"select": columns}
        if order:
            params["order"] = order
        rows: list = []
        # PostgREST paginates; walk via Range headers.
        step = 1000
        start = 0
        while True:
            headers = {**self.headers, "Range-Unit": "items", "Range": f"{start}-{start + step - 1}"}
            res = requests.get(f"{self.rest}/{table}", headers=headers, params=params, timeout=60)
            if res.status_code == 404:
                return rows
            res.raise_for_status()
            batch = res.json()
            rows.extend(batch)
            if len(batch) < step:
                break
            start += step
        return rows


def match_to_backup(m: dict) -> dict:
    out = {
        "Date": m["match_date"],
        "RoundNumber": m["round_number"],
        "ScoreTeam1": m["score_team1"],
        "ScoreTeam2": m["score_team2"],
        "Team1Player1Name": m["team1_player1_name"],
        "Team1Player2Name": m["team1_player2_name"],
        "Team2Player1Name": m["team2_player1_name"],
        "Team2Player2Name": m["team2_player2_name"],
    }
    for src, dst in (
        ("team1_player1_elo", "Team1Player1Elo"),
        ("team1_player2_elo", "Team1Player2Elo"),
        ("team2_player1_elo", "Team2Player1Elo"),
        ("team2_player2_elo", "Team2Player2Elo"),
    ):
        if m.get(src) is not None:
            out[dst] = m[src]
    return out


def write_json(out_dir: str, rel_path: str, data) -> bool:
    """Write data as pretty JSON; return True if the file changed."""
    full = os.path.join(out_dir, rel_path.replace("/", os.sep))
    os.makedirs(os.path.dirname(full), exist_ok=True)
    payload = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=False)
    if os.path.isfile(full):
        with open(full, "r", encoding="utf-8") as fh:
            if fh.read() == payload:
                return False
    with open(full, "w", encoding="utf-8") as fh:
        fh.write(payload)
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="Backup Supabase to a GitHub JSON archive")
    ap.add_argument("--out-dir", required=True, help="Root of the backup-data layout to write")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.", file=sys.stderr)
        return 2

    sb = Supabase(url, key)
    changed = 0

    # players.json (registry only)
    players = sb.select("players", "name, match_padel_id", order="name.asc")
    players_out = [{"Name": p["name"], "MatchPadelId": p.get("match_padel_id")} for p in players]
    changed += write_json(args.out_dir, "players.json", players_out)

    # matches -> per-day files
    matches = sb.select("matches", order="match_date.asc,round_number.asc")
    by_date: dict[str, list] = defaultdict(list)
    for m in matches:
        by_date[m["match_date"]].append(m)
    for date, day in by_date.items():
        year, month = date[:4], date[:7]
        rel = f"{year}/{month}/{date}.json"
        payload = {
            "backup_timestamp": None,  # deterministic (avoid churn); commit time is the record
            "match_date": date,
            "match_count": len(day),
            "matches": [match_to_backup(m) for m in day],
        }
        changed += write_json(args.out_dir, rel, payload)

    # active tournament (embedded file, only if present)
    active = sb.select("active_tournament", "data")
    if active and isinstance(active[0].get("data"), dict) and not active[0]["data"].get("isCompleted"):
        changed += write_json(args.out_dir, "data/active_tournament.json", active[0]["data"])

    # doodle -> per-month files
    for d in sb.select("doodle"):
        ym = d["year_month"]
        year = ym[:4]
        changed += write_json(args.out_dir, f"{year}/{ym}/doodle_{ym}.json", d.get("entries", []))
        if d.get("changelog"):
            changed += write_json(
                args.out_dir, f"{year}/{ym}/doodle_changelog_{ym}.json", d["changelog"]
            )

    # data/ singletons
    attendance = sb.select("attendance_manual", order="entry_date.asc")
    attendance_out = [
        {"date": a["entry_date"], "players": a.get("players", []), "note": a.get("note", "")}
        for a in attendance
    ]
    changed += write_json(args.out_dir, "data/attendance_manual.json", attendance_out)

    changelog = sb.select("changelog", "entry", order="created_at.desc")
    changed += write_json(args.out_dir, "data/changelog.json", [c["entry"] for c in changelog])

    admins = sb.select("administrators", "name", order="name.asc")
    changed += write_json(args.out_dir, "data/administrators.json", [a["name"] for a in admins])

    print(f"Backup complete. {changed} file(s) changed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
