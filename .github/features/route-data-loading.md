# Route-Scoped Data Loading

## Why
Home took ~6 s: it downloaded every match (~6.5k rows with embedded players, ~2.5 MB)
page by page, sequentially, only to replay ELO in the browser. Every other route loaded
the full snapshot. Now each route loads only what it renders, and ELO is computed in Postgres.

## Server side (`supabase/migrations/20260930150000_route_scoped_reads.sql`)
- `get_player_elo(p_dates date[], p_player_ids uuid[])` → `(player_id, tournament_date, elo, previous_elo)`
  end-of-day rows, only for players who **played** on the given dates (or the given players).
  The replay walks all matches in-DB (date → round → match_order); only the filtered rows leave the DB.
- `get_current_elo(p_before date)` → latest ELO + previous per player.
- Views (`security_invoker`): `tournament_index` (per-date counts/status), `player_attendance`
  (distinct date × player), `player_totals` (all-time wins/losses/points/games/tournaments).
- ELO rules mirror `js/services/elo.js` exactly (see `elo-rating-system.md`).
  Parity test: `tests/supabase-route-reads.test.js` (PGlite, full history).

### Precomputed summaries (`supabase/migrations/20261006090000_precomputed_home_summaries.sql`)
- `player_tournament_elo` (player × tournament date: `elo`, `previous_elo`, `elo_delta`).
- `player_monthly_summary` (year_month × player: `wins`, `losses`, `points`, `games`, `average`,
  month-end `elo`, month-start `previous_elo`, `elo_delta`). 0-0 skipped, tie = loss.
- `home_route_summary` (single row JSON snapshot; not read by the client yet).
- Rebuilt in full by `rebuild_home_summaries()` from statement-level triggers on `matches`,
  `match_players`, `tournaments` — reads stay fresh with no browser cache. RLS: `has_active_access()`.

### Precomputed player summaries (`supabase/migrations/20261006120000_precomputed_player_summaries.sql`)
- `player_totals_summary` (same columns/rules as `player_totals`), rebuilt by
  `rebuild_player_totals_summary()` from triggers on the same tables.
- `player_current_elo` view (`security_invoker`) = latest `player_tournament_elo` row per player
  (same shape as `get_current_elo()`).

### Client fallback
`readPrecomputed(primary, fallback)`: precomputed reads fall back to the legacy view/RPC on a
missing-schema error (not to the full snapshot).
- `loadPlayerSummary` → `player_totals_summary` ∥ `player_current_elo` (fallback `player_totals` ∥ `get_current_elo`).
- `loadEloForDates` → `player_tournament_elo?tournament_date=in.(…)` (fallback `get_player_elo(p_dates)`).
- `loadEloHistory` → `player_tournament_elo?player_id=in.(…)` (fallback `get_player_elo(p_player_ids)`).

## Client (`js/services/supabase.js`)
Resource loaders, each cached in memory (`supabase_res_<key>`) with in-flight dedupe:
`loadPlayers`, `loadTournamentIndex`, `loadActiveTournament`, `loadDayMatches(dates)`,
`loadEloForDates(dates)`, `loadMonth(ym)`, `loadParticipation(months?)`,
`loadManualAttendance`, `loadDoodleMonth(ym)`, `loadPlayerSummary`, `loadEloHistory(ids)`.

| Route | Loads |
|---|---|
| `/` | players ∥ index ∥ active ∥ `player_monthly_summary` (previous + current month) → latest completed day's matches ∥ `player_tournament_elo` (that day). No `get_player_elo` replay. If the summary tables are missing → legacy: matches for both months + latest day ∥ `get_player_elo(those dates)` |
| `/tournaments` | `tournament_index` |
| `/tournament/:date` | index, active, that day's matches, player summary |
| `/create-tournament` | active, participation (previous + current month), players |
| `/statistics` | index + latest day, player summary (`player_totals` + `get_current_elo`), manual attendance; months on demand |
| `/elo-charts` | index + latest day, player summary; per-player history via `get_player_elo(p_player_ids)` |
| `/attendance` | `player_attendance` (all), manual attendance — no matches |
| `/doodle` | viewed month's availability + changelog, that month's matches + ELO, summary, manual attendance |
| `/logs`, `/settings` | nothing |
| `#/__full__` | full snapshot (explicit fallback only) |

## Rules
- Navigation (`hashchange`) runs the route loader (`js/services/route-loader.js`); the page
  re-renders once only if new data arrived **and** the user is still on that route.
- Returning users (config + session + role) start the route load at app start, in parallel
  with admins/dev-config/onboarding.
- `selectAll` fetches page 1 with `Prefer: count=exact`, then remaining pages in parallel.
- Concurrent requests share one session refresh.
- The home route only schedules `pullMonthlyOverview` for months whose overview cache is still empty, avoiding redundant reloads when route hydration already filled the current/previous month data.
- Any successful mutation calls `invalidateReadCache()`; the next visit reloads.
- If the migration is missing (404 / `PGRST205` / `PGRST202`), loaders fall back to the full snapshot
  — except precomputed-summary reads, which fall back to the legacy view/RPC (see above).
- The manual-attendance editor loads players, manual attendance and the tournament index before
  opening, because the save replaces the whole list server-side.

## Measuring
Open the app with `?perf=1` (or `localStorage['perf-log']='1'`): console logs `[perf]` lines for
startup, each route load, every `selectAll` (rows, pages) and RPC.

## Acceptance (tests/services/route-data.test.js, route-loader.test.js)
- Home: two parallel waves; one matches request (latest completed day only), one
  `player_monthly_summary` request (`year_month=in.(prev,current)`), one `player_tournament_elo`
  request (`tournament_date=eq.latest`), zero `get_player_elo` calls; no doodle/attendance/player_totals
  reads; repeat visit = zero requests. Missing summary tables → legacy replay, not full snapshot.
- Home merges its days into already loaded matches.
- Tournaments list = one request to `tournament_index`.
- Attendance never requests `/rest/v1/matches`.
- Navigating away mid-load does not repaint the old route.
