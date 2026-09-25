# Supabase Migration

## Goal

Supabase is the canonical writable data source. `DataHub_Mexicano` becomes a generated backup and compatibility export, never a second writable source.

## Confirmed architecture

- Backfill DataHub, run shadow/parity reads, then perform an atomic cutover.
- Keep onboarding shape: shared app access code, then player selection.
- Player selection attributes actions but does not grant authorization.
- Admin actions require a separate, expiring admin elevation.
- Supabase Auth anonymous sessions identify a device session.
- Server-side access grants and RLS authorize reads/writes.
- Cached data may render offline; domain writes are blocked while offline.
- Browser never receives Supabase service-role, GitHub relay, Telegram, VAPID private, access-code hash, or admin-code hash secrets.

## Source-of-truth policy

### Canonical

- Player identities, aliases, and roles.
- Tournament lifecycle, roster, rounds, match participants, and scores.
- Doodle availability and manual/tournament attendance.
- Shared app settings.
- Push subscriptions.
- Append-only audit events.
- Notification outbox records.

### Derived, versioned projections

- Current ELO and tournament ELO changes.
- ELO history and chart snapshots.
- Player rankings and statistics.
- Monthly/player summaries.

Raw matches remain canonical. Derived records carry an ELO calculation version and can be rebuilt deterministically.

### Local-only

- Device UI preferences.
- Cached route data.
- Supabase refresh/session state managed by the auth client.
- Current selected player cache, backed by the server-side access grant.
- Notification history stored in IndexedDB.

## Canonical model

- `players`, `player_aliases`, `player_roles`
- `app_access_grants`
- `tournaments`, `tournament_players`
- `matches`, `match_players`
- `doodle_periods`, `doodle_availability`
- `attendance_records`, `attendance_players`
- `app_settings`
- `push_subscriptions`
- `audit_events`
- `notification_outbox`
- `elo_calculation_versions`, `elo_snapshots`
- `projection_runs`, `backup_runs`

Matches reference stable player UUIDs. Legacy player names are resolved through a reviewed alias map; ambiguous identities fail import.

## Access flow

1. Create/restore an anonymous Supabase Auth session.
2. Submit shared code to `claim-access`.
3. Server verifies the secret and records an ordinary, expiring grant for `auth.uid()`.
4. Fetch active players and bind the chosen `player_id`.
5. Admin code calls `elevate-admin`; server records a short-lived admin grant.
6. RLS checks active grants. Selecting an administrator name alone grants nothing.

Shared/admin codes are rate-limited, rotatable, revocable, hashed server-side, and never retained by the app after successful exchange.

## App data boundary

Pages use a domain backend facade, not GitHub or Supabase directly. During migration:

- Supabase adapter is primary when configured.
- Concurrent consumers share one in-flight canonical hydration; route rendering must not start
  duplicate full-dataset reads.
- Parent rows fetch bounded child relations through PostgREST embeds so tournament players,
  match players, and attendance players do not require separate paginated table scans.
- Every paginated PostgREST resource uses a deterministic total order ending in a unique key.
  Shared round/order values must never define match page boundaries by themselves because that
  can skip or duplicate rows between pages.
- Hydration builds and caches monthly statistics plus attendance-date compatibility projections
  once from canonical matches and persisted ELO snapshots. Selecting a month must not replay the
  complete ELO history or trigger another full hydration.
- Legacy GitHub adapter is read-only and may be used for shadow comparison.
- localStorage/IndexedDB are caches, not canonical domain storage.
- Mutations use explicit backend methods and optimistic version checks.
- `Store.set()` must not trigger implicit network writes.

### Hydration acceptance

- Three concurrent first-load calls => one shared hydration request batch.
- One hydration batch => six logical PostgREST resources; nested tournament/match/attendance
  children are returned with their parent rows.
- Tournament route `#/tournament/2026-09-24` => load active players, tournament metadata, and
  only matches belonging to `2026-09-24`; do not load ELO snapshots, doodle availability, or
  attendance records.
- Home route on `2026-09-25` => load players, lightweight tournament metadata, and match/ELO
  details only for August 2026, September 2026, and the latest completed tournament; do not load
  doodle availability, attendance records, or complete match/ELO history.
- Home startup monthly consumers => join the in-flight Home route hydration instead of starting
  a concurrent full-history hydration.
- Home tournament metadata => do not embed historical match rows.
- Partial Home hydration => use Home-specific in-memory match/summary caches and leave the
  full-history Store match cache unchanged.
- Re-rendering the same tournament route after its route hydration completes => no second
  PostgREST batch unless an explicit mutation refresh invalidates it.
- Routes whose pages own their data request (`#/logs`, `#/settings`) => no canonical snapshot
  hydration during app startup.
- More than 1,000 matches with repeated round/order values => pagination orders by tournament,
  round, match order, then match ID, so every canonical match is hydrated exactly once.
- Hydrated January matches + persisted January ELO snapshots => `monthly_2026-01` is ready before
  a month is selected.
- Hydrated match participation => raw attendance dates are ready without reading legacy
  `players_overview.json`.

### Legacy tournament import

- `backup-data/tournaments.json` is authoritative for historical tournament membership and
  completion state.
- A dated file absent from `tournaments.json` is not imported as historical data merely because
  it contains a stale `{ tournament: ... }` snapshot.
- At most one unfinished tournament snapshot may be imported as active: the newest unfinished
  dated file whose date is later than the latest indexed completed tournament.
- Active snapshot rounds are normalized into canonical matches and match-player rows; opening an
  imported active tournament must not produce “No tournament found”.

## Notifications

Database mutation and `notification_outbox` insertion occur in one transaction. A server-side dispatcher triggers retained DataHub GitHub Actions relays using a server-held GitHub token.

Rules:

- Persist first, notify second.
- Every logical notification has an idempotency key.
- Retry state and permanent failures are visible in audit/admin logs.
- Push subscriptions live in Supabase and are excluded from GitHub backups.
- Browser no longer dispatches GitHub events with a PAT.

## ELO

- Initial ELO: 1000.
- K-factor: 32.
- Combined opponent strength: RMS.
- Preserve current sequential player update order and two-decimal rounding.
- Incomplete `0-0` matches do not affect ELO.
- Calculation rules have an immutable version identifier.
- Normal UI reads use persisted projections.
- Full replay must reproduce projections from canonical matches.
- Embedded legacy match ELO is export compatibility data, not canonical match data.

## DataHub backup

Workflow lives in `DataHub_Mexicano`.

- Scheduled Tuesday/Thursday at 08:15 `Europe/Copenhagen`.
- Two UTC cron triggers (`06:15`, `07:15`) plus Copenhagen local-time guard.
- Manual dispatch supported.
- Writes legacy-compatible JSON and sanitized canonical snapshots.
- Manifest includes schema/projection versions, source watermark, row counts, and file hashes.
- Excludes auth/access secrets, sessions, service credentials, and Web Push endpoint/key material.
- Validates completeness before commit and records the resulting commit SHA in `backup_runs`.
- Restore verification must recreate counts, checksums, and projections in an empty database.

## Cutover

1. Import and reconcile all legacy records.
2. Build and validate projections.
3. Run Supabase/GitHub shadow reads.
4. Stop legacy-only writes for final reconciliation.
5. Create and verify an on-demand DataHub backup.
6. Switch the app to Supabase and publish a service-worker version bump.
7. Keep GitHub compatibility reads only during stabilization.

Rollback requires exporting current Supabase data first. Old GitHub mutation code must not be re-enabled against a stale scheduled backup.

## Acceptance

- DataHub inventory with 316 tournament files => importer reports all 316 files and every contained match.
- Missing required match field => importer reports a validation error; it does not coerce the field to `0`.
- Same import run twice => second run creates no duplicate canonical identities, tournaments, matches, or participants.
- Historical name alias with one reviewed target => match references the target player UUID.
- Ambiguous/unmapped name => import fails with source path and name.
- Raw matches + calculation version => deterministic ELO snapshots tagged with that version.
- Anonymous session without access grant => protected read/write denied.
- Ordinary grant + selected admin player => admin mutation denied.
- Valid admin elevation => admin mutation allowed until expiry.
- Offline cached route => route renders cached data.
- Offline mutation => blocked before local success UI or notification.
- Failed domain transaction => no notification outbox row and no relay.
- Retried outbox item => one logical relay dispatch.
- Backup trigger at Danish summer/winter => exactly one run at local 08:15.
- Backup export => legacy JSON plus canonical manifest; no auth secrets or push endpoint/key material.
- Shadow read mismatch => discrepancy is logged and cutover remains blocked.
