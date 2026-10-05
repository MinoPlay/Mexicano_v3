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

## Client (`js/services/supabase.js`)
Resource loaders, each cached in memory (`supabase_res_<key>`) with in-flight dedupe:
`loadPlayers`, `loadTournamentIndex`, `loadActiveTournament`, `loadDayMatches(dates)`,
`loadEloForDates(dates)`, `loadMonth(ym)`, `loadParticipation(months?)`,
`loadManualAttendance`, `loadDoodleMonth(ym)`, `loadPlayerSummary`, `loadEloHistory(ids)`.

| Route | Loads |
|---|---|
| `/` | players ∥ index ∥ active → matches for current month + previous month + latest completed day ∥ `get_player_elo(those dates)` |
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
- If the migration is missing (404 / `PGRST205` / `PGRST202`), loaders fall back to the full snapshot.
- The manual-attendance editor loads players, manual attendance and the tournament index before
  opening, because the save replaces the whole list server-side.

## Measuring
Open the app with `?perf=1` (or `localStorage['perf-log']='1'`): console logs `[perf]` lines for
startup, each route load, every `selectAll` (rows, pages) and RPC.

## Acceptance (tests/services/route-data.test.js, route-loader.test.js)
- Home: exactly one matches request filtered by `tournaments.tournament_date=in.(…)` and one
  `get_player_elo` call; no doodle/attendance/player_totals reads; repeat visit = zero requests.
- Home merges its days into already loaded matches.
- Tournaments list = one request to `tournament_index`.
- Attendance never requests `/rest/v1/matches`.
- Navigating away mid-load does not repaint the old route.
