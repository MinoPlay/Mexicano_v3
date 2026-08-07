# Supabase Backend — Setup & Usage

Mexicano can use Supabase (Postgres) as backend instead of GitHub. This doc = what was
done to init it, and what you paste to use it.

## What Supabase stores (raw only)

Only source-of-truth data. Everything else computed at runtime (`js/services/derive.js`).

| Stored (raw) | Computed at runtime (NOT stored) |
|---|---|
| players, matches | ELO + elo_history |
| active_tournament | statistics, overviews |
| doodle, attendance_manual | tournaments index |
| changelog, administrators | rankings |

Tables: `players, matches, active_tournament, doodle, attendance_manual, changelog, administrators`.
RLS = permissive (anon/authenticated full read+write).

## Values you paste in app Settings → Supabase Backend

Only two:

| Field | Value |
|---|---|
| Supabase URL | `https://edasyhcgpdhsynufbcll.supabase.co` |
| Anon key | Dashboard → Project Settings → API → **Project API keys → `anon` `public`** |

Save → Test → app now reads/writes Supabase. Backend switch is automatic:
`Store.activeBackend()` returns `supabase` when URL + anon key set, else `github`.

> Anon key is the public client key (safe in browser). Do NOT paste the `service_role` key in Settings.

## Keys reference (what each is for)

| Key | Where | Used for |
|---|---|---|
| `anon` public | Settings UI + client | normal app read/write |
| `service_role` | migration script / backup Action ONLY | bypass RLS bulk writes. Never in browser/repo |
| Personal Access Token (`sbp_...`) | Account → Access Tokens | one-time schema apply via Management API. Revoke after |

## How init was done (one-time, already completed)

This machine had **no IPv6** (direct DB host `db.<ref>.supabase.co` is IPv6-only) and
**ports 5432/6543 firewalled**, so normal `psql` / pooler could not connect. Only HTTPS/443
worked. Schema was therefore applied via the **Management API** over HTTPS.

### 1. Install driver / deps

```powershell
python -m pip install "psycopg[binary]" requests
```

(`psycopg` only needed if your network allows direct/pooler Postgres. If 5432/6543 blocked, skip it and use Management API below.)

### 2. Apply schema

Preferred (works anywhere, needs `sbp_` token):

```powershell
$env:SBP = 'sbp_xxx'                 # Supabase Personal Access Token
$env:SQLPATH = 'C:\Private\Mexicano_v3\supabase\migrations\0001_init.sql'
# POST file contents to Management API:
#   https://api.supabase.com/v1/projects/<ref>/database/query
```

Alt (if Postgres port reachable): `psql "<connection string>" -f supabase\migrations\0001_init.sql`
or paste the SQL in Dashboard → SQL Editor.

Verify tables:
```
select table_name from information_schema.tables where table_schema='public';
```

### 3. Upload existing data (migration script)

Uses Supabase REST (HTTPS) + `service_role` key. Idempotent (safe to re-run).

```powershell
$env:SUPABASE_URL = 'https://edasyhcgpdhsynufbcll.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = '<service_role key>'   # Dashboard → API, or Management API
cd C:\Private\Mexicano_v3
# dry run first (no writes):
python scripts\migrate_to_supabase.py --source-dir 'C:\Private\DataHub_Mexicano\mexicano_v3\backup-data' --dry-run
# real run:
python scripts\migrate_to_supabase.py --source-dir 'C:\Private\DataHub_Mexicano\mexicano_v3\backup-data'
```

Source can also be GitHub: `--gh-owner --gh-repo --gh-base-path` with `GH_PAT` env.

### 4. Verify counts

Result of this init:

| table | rows |
|---|---|
| players | 70 |
| matches | 6914 |
| doodle | 48 |
| attendance_manual | 2 |
| active_tournament | 1 |
| changelog | 0 |
| administrators | 0 |

## Backup Supabase → GitHub (JSON archive)

Daily GitHub Action `.github/workflows/backup-supabase.yml` dumps Supabase back to GitHub JSONs
(GitHub becomes read-only archive). Set repo secrets:

- `SUPABASE_URL` = `https://edasyhcgpdhsynufbcll.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = service_role key

Manual run: `python scripts\backup_supabase_to_github.py` with same env.

## Files

| File | Purpose |
|---|---|
| `supabase/migrations/0001_init.sql` | schema + RLS |
| `scripts/migrate_to_supabase.py` | populate Supabase from backup/GitHub |
| `scripts/backup_supabase_to_github.py` | dump Supabase → GitHub JSON |
| `js/services/supabase.js` | Supabase backend (mirrors github.js) |
| `js/services/backend.js` | switch facade (supabase vs github) |
| `js/services/derive.js` | runtime ELO/stats derivation |
