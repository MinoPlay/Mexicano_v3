#!/usr/bin/env python3
"""One-time migration: GitHub JSON archive -> Supabase.

Reads the existing GitHub backup layout (raw source-of-truth only) and upserts it
into Supabase. Idempotent: re-running merges on the natural keys, so it is safe to
run repeatedly.

DERIVED DATA IS NOT MIGRATED. ELO ratings, player stats, monthly overviews,
per-player elo_history and the tournaments index are recomputed at runtime by the
client, so we intentionally drop those fields (players.json ELO/Wins/... columns,
players_overview.json, elo_history/*.json, tournaments.json).

Source of match/doodle/... data can be either:
  * a local checkout of the archive repo   (--source-dir PATH), or
  * the GitHub Contents API                (--gh-owner/--gh-repo/--gh-base-path + GH_PAT)

Layout expected under the base path:
  players.json
  YYYY/YYYY-MM/YYYY-MM-DD.json          (match day files; PascalCase fields)
  YYYY/YYYY-MM/doodle_YYYY-MM.json
  YYYY/YYYY-MM/doodle_changelog_YYYY-MM.json
  data/attendance_manual.json
  data/changelog.json
  data/administrators.json

Env vars:
  SUPABASE_URL                 e.g. https://xxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY    service_role key (NEVER commit this)
  GH_PAT                       GitHub PAT (only when using the API source)

Usage:
  python scripts/migrate_to_supabase.py --source-dir C:\\path\\to\\backup-data
  python scripts/migrate_to_supabase.py --gh-owner MinoPlay --gh-repo DataHub_Mexicano \\
         --gh-base-path mexicano_v3/backup-data

Requires: requests  (pip install requests)
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from typing import Any, Iterable

import requests

DATE_FILE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}\.json$")
DOODLE_RE = re.compile(r"^doodle_(\d{4}-\d{2})\.json$")
DOODLE_CHANGELOG_RE = re.compile(r"^doodle_changelog_(\d{4}-\d{2})\.json$")


# ─── Source abstraction ──────────────────────────────────────────────────────
class Source:
    """Reads JSON files from a base path (local dir or GitHub API)."""

    def read_json(self, rel_path: str) -> Any | None:
        raise NotImplementedError

    def walk_json(self) -> Iterable[str]:
        """Yield every *.json path (relative to base) in the archive."""
        raise NotImplementedError


class LocalSource(Source):
    def __init__(self, root: str):
        self.root = os.path.abspath(root)

    def read_json(self, rel_path: str) -> Any | None:
        full = os.path.join(self.root, rel_path.replace("/", os.sep))
        if not os.path.isfile(full):
            return None
        with open(full, "r", encoding="utf-8") as fh:
            return json.load(fh)

    def walk_json(self) -> Iterable[str]:
        for dirpath, _dirs, files in os.walk(self.root):
            for f in files:
                if f.endswith(".json"):
                    full = os.path.join(dirpath, f)
                    yield os.path.relpath(full, self.root).replace(os.sep, "/")


class GitHubSource(Source):
    API = "https://api.github.com"

    def __init__(self, owner: str, repo: str, base_path: str, pat: str):
        self.owner = owner
        self.repo = repo
        self.base = base_path.strip("/")
        self.headers = {
            "Authorization": f"Bearer {pat}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _url(self, rel_path: str) -> str:
        path = f"{self.base}/{rel_path}".strip("/")
        return f"{self.API}/repos/{self.owner}/{self.repo}/contents/{path}"

    def read_json(self, rel_path: str) -> Any | None:
        res = requests.get(self._url(rel_path), headers=self.headers, timeout=30)
        if res.status_code == 404:
            return None
        res.raise_for_status()
        payload = res.json()
        content = base64.b64decode(payload["content"]).decode("utf-8")
        return json.loads(content)

    def walk_json(self) -> Iterable[str]:
        yield from self._walk("")

    def _walk(self, rel: str) -> Iterable[str]:
        res = requests.get(self._url(rel), headers=self.headers, timeout=30)
        if res.status_code == 404:
            return
        res.raise_for_status()
        for item in res.json():
            child = f"{rel}/{item['name']}".strip("/")
            if item["type"] == "dir":
                yield from self._walk(child)
            elif item["type"] == "file" and item["name"].endswith(".json"):
                yield child


# ─── Supabase upsert helper ──────────────────────────────────────────────────
class Supabase:
    def __init__(self, url: str, service_key: str):
        self.rest = url.rstrip("/") + "/rest/v1"
        self.headers = {
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
        }

    def upsert(self, table: str, rows: list[dict], on_conflict: str | None = None):
        if not rows:
            return
        url = f"{self.rest}/{table}"
        params = {}
        if on_conflict:
            params["on_conflict"] = on_conflict
        headers = {**self.headers, "Prefer": "resolution=merge-duplicates,return=minimal"}
        # Chunk to stay under payload limits.
        for i in range(0, len(rows), 500):
            chunk = rows[i : i + 500]
            res = requests.post(url, headers=headers, params=params, json=chunk, timeout=60)
            if not res.ok:
                raise RuntimeError(f"upsert {table} failed ({res.status_code}): {res.text}")

    def replace_all(self, table: str, rows: list[dict]):
        """Delete all rows then insert (for tables without a natural upsert key)."""
        res = requests.delete(
            f"{self.rest}/{table}",
            headers={**self.headers, "Prefer": "return=minimal"},
            params={"id": "gte.0"} if table == "changelog" else {"name": "neq.\x00"},
            timeout=60,
        )
        if not res.ok and res.status_code != 404:
            raise RuntimeError(f"clear {table} failed ({res.status_code}): {res.text}")
        headers = {**self.headers, "Prefer": "return=minimal"}
        for i in range(0, len(rows), 500):
            chunk = rows[i : i + 500]
            if not chunk:
                continue
            r = requests.post(f"{self.rest}/{table}", headers=headers, json=chunk, timeout=60)
            if not r.ok:
                raise RuntimeError(f"insert {table} failed ({r.status_code}): {r.text}")


# ─── Transformers (PascalCase backup -> snake_case rows) ─────────────────────
def match_from_backup(m: dict, match_date: str) -> dict:
    return {
        "match_date": m.get("Date") or match_date,
        "round_number": m.get("RoundNumber"),
        "score_team1": m.get("ScoreTeam1", 0),
        "score_team2": m.get("ScoreTeam2", 0),
        "team1_player1_name": m.get("Team1Player1Name"),
        "team1_player2_name": m.get("Team1Player2Name"),
        "team2_player1_name": m.get("Team2Player1Name"),
        "team2_player2_name": m.get("Team2Player2Name"),
        "team1_player1_elo": m.get("Team1Player1Elo"),
        "team1_player2_elo": m.get("Team1Player2Elo"),
        "team2_player1_elo": m.get("Team2Player1Elo"),
        "team2_player2_elo": m.get("Team2Player2Elo"),
    }


def collect_matches(source: Source) -> tuple[list[dict], dict | None]:
    """Return (match_rows, active_tournament_obj). Active tournament, if present in
    a day file's `tournament` embed and not completed, is returned separately."""
    rows: list[dict] = []
    active: dict | None = None
    for path in source.walk_json():
        name = path.rsplit("/", 1)[-1]
        if not DATE_FILE_RE.match(name):
            continue
        data = source.read_json(path)
        if not isinstance(data, dict):
            continue
        match_date = data.get("match_date") or name[:-5]
        if isinstance(data.get("matches"), list):
            for m in data["matches"]:
                rows.append(match_from_backup(m, match_date))
        tourn = data.get("tournament")
        if isinstance(tourn, dict) and not tourn.get("isCompleted"):
            active = tourn
    return rows, active


def main() -> int:
    ap = argparse.ArgumentParser(description="Migrate GitHub JSON archive to Supabase")
    ap.add_argument("--source-dir", help="Local path to the backup-data root")
    ap.add_argument("--gh-owner")
    ap.add_argument("--gh-repo")
    ap.add_argument("--gh-base-path", default="")
    ap.add_argument("--dry-run", action="store_true", help="Read + report, no writes")
    args = ap.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not args.dry_run and (not supabase_url or not service_key):
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars required.", file=sys.stderr)
        return 2

    if args.source_dir:
        source: Source = LocalSource(args.source_dir)
    elif args.gh_owner and args.gh_repo:
        pat = os.environ.get("GH_PAT")
        if not pat:
            print("ERROR: GH_PAT env var required for GitHub source.", file=sys.stderr)
            return 2
        source = GitHubSource(args.gh_owner, args.gh_repo, args.gh_base_path, pat)
    else:
        print("ERROR: provide --source-dir OR --gh-owner/--gh-repo.", file=sys.stderr)
        return 2

    # ── Gather ──────────────────────────────────────────────────────────────
    print("Reading players.json ...")
    players_raw = source.read_json("players.json") or []
    players = [
        {"name": p.get("Name"), "match_padel_id": p.get("MatchPadelId")}
        for p in players_raw
        if p.get("Name")
    ]

    print("Walking match day files ...")
    match_rows, active = collect_matches(source)
    print(f"  players={len(players)}  matches={len(match_rows)}  active_tournament={'yes' if active else 'no'}")

    print("Reading doodle files ...")
    doodle_rows: list[dict] = []
    doodle_entries: dict[str, Any] = {}
    doodle_changelog: dict[str, Any] = {}
    for path in source.walk_json():
        name = path.rsplit("/", 1)[-1]
        m = DOODLE_RE.match(name)
        if m:
            doodle_entries[m.group(1)] = source.read_json(path) or []
            continue
        mc = DOODLE_CHANGELOG_RE.match(name)
        if mc:
            doodle_changelog[mc.group(1)] = source.read_json(path) or []
    for ym in sorted(set(doodle_entries) | set(doodle_changelog)):
        doodle_rows.append(
            {
                "year_month": ym,
                "entries": doodle_entries.get(ym, []),
                "changelog": doodle_changelog.get(ym, []),
            }
        )

    print("Reading data/ singletons ...")
    attendance_raw = source.read_json("data/attendance_manual.json") or []
    attendance_rows = [
        {"entry_date": e.get("date"), "players": e.get("players", []), "note": e.get("note", "")}
        for e in attendance_raw
        if e.get("date")
    ]
    changelog_raw = source.read_json("data/changelog.json") or []
    changelog_rows = [{"entry": e} for e in changelog_raw]
    admins_raw = source.read_json("data/administrators.json") or []
    admin_rows = [{"name": n} for n in admins_raw if n]

    if args.dry_run:
        print("DRY RUN — no writes. Summary:")
        print(f"  players={len(players)} matches={len(match_rows)} doodle={len(doodle_rows)}")
        print(f"  attendance={len(attendance_rows)} changelog={len(changelog_rows)} admins={len(admin_rows)}")
        return 0

    # ── Write ───────────────────────────────────────────────────────────────
    sb = Supabase(supabase_url, service_key)
    print("Upserting players ...")
    sb.upsert("players", players, on_conflict="name")
    print("Upserting matches ...")
    sb.upsert(
        "matches",
        match_rows,
        on_conflict="match_date,round_number,team1_player1_name,team1_player2_name,team2_player1_name,team2_player2_name",
    )
    print("Upserting doodle ...")
    sb.upsert("doodle", doodle_rows, on_conflict="year_month")
    print("Upserting attendance_manual ...")
    sb.upsert("attendance_manual", attendance_rows, on_conflict="entry_date")
    print("Replacing administrators ...")
    sb.replace_all("administrators", admin_rows)
    print("Replacing changelog ...")
    sb.replace_all("changelog", changelog_rows)
    if active:
        print("Upserting active_tournament ...")
        sb.upsert("active_tournament", [{"id": True, "data": active}], on_conflict="id")

    print("Migration complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
