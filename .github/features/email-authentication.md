# Approved Email Authentication

## Goal

Replace GitHub PAT authentication with Supabase Auth while supporting magic-link sign-in for
pre-approved users.

## Architecture

- Supabase Auth owns credentials and sessions.
- `players.email` is the authoritative allowlist. Only an active player row whose `email` matches
  (case-insensitively) may be approved for email sign-in.
- `approved_auth_users` records which Auth users are approved for Mexicano and stores the
  `player_id` resolved from `players.email`.
- `app_access_grants` remains the single authorization source used by RLS and Edge Functions.
  `selected_player_id` is set from the resolved player, so email users skip the player-selection
  step during onboarding.
- The local provisioning script creates or updates the Auth user, records approval, and grants
  member access.
- Magic-link sign-in resolves to the approved `auth.users.id`.
- Public self-signup is disabled. Unapproved addresses cannot create accounts.
- Existing anonymous shared-code access can remain enabled during migration, then be retired
  separately after all users have moved.
- The service-role key is used only by local/admin scripts and never shipped to the browser.

## Persistent sign-in

- Magic-link and shared-code sign-in lasts until explicit logout, server-side revocation,
  or removal of the browser's saved credentials. Normal JWT expiry silently refreshes the same
  identity; it must not create a replacement anonymous user.
- Network errors, rate limits, and temporary Auth failures preserve the saved session, player,
  and access grant and surface an error. A later request retries renewal. Only a definitive
  invalid/revoked Auth session requires signing in again.
- Refreshes are serialized, including concurrent HTTP 401 retries and same-deployment browser
  tabs (Web Locks where available). A late response cannot restore a session after logout.
- Membership is an existing, non-revoked `app_access_grants` row. Member grants store PostgreSQL
  `infinity` in `expires_at`; for admin grants that column is only the elevation deadline.
  Expired admin elevation falls back to member access, never to the login screen.
- Main and preview deployments keep their existing isolated browser storage.

Supabase's [session contract](https://supabase.com/docs/guides/auth/sessions) allows indefinite
sessions with rotating refresh tokens. Refresh errors accept both Auth response formats:
`code`/`message` and the unversioned `error_code`/`msg` format (whose numeric `code` is HTTP status).

### Deployment

Apply `supabase/migrations/20261109120000_persistent_member_access.sql`, deploy the updated
`claim-access` and `domain-mutation` Edge Functions, then publish the browser changes. The migration
preserves identities/player bindings and revocations, removes old member deadlines, and retains
existing admin deadlines. Use the updated provisioning script for future email approvals;
`APP_ACCESS_DAYS` and `AUTH_USER_ACCESS_DAYS` no longer limit membership.

In Supabase Authentication -> Sessions, keep time-boxed sessions and inactivity timeout disabled,
and single-session-per-user enforcement off. These live project settings cannot be verified from
the repository. Access JWTs should remain short-lived; refresh-token rotation stays enabled.

### Persistence acceptance pairs

- Expired magic-link or shared-code JWT + valid refresh token => same user, new token pair,
  unchanged player and membership.
- Refresh HTTP 429/503 or network failure => request rejects; saved credentials/grant survive;
  next successful refresh restores requests without another login.
- Two requests rejected with HTTP 401 => one refresh; both retry using the new access token.
- Two tabs renewing the same session => one refresh under the shared lock; second tab reuses it.
- Logout during refresh => late response does not write credentials back.
- Confirmed `refresh_token_not_found` => sign-in error, cleared session, no anonymous signup.
- Old member deadline or expired admin elevation => onboarding stays complete; admin actions
  are denied after the elevation deadline while member actions still work.
- Revoked grant => protected reads and writes remain denied.

## Rollout plan

1. Apply `supabase/migrations/20260929133000_approved_email_auth.sql`, then
   `supabase/migrations/20260929143000_players_email_allowlist.sql` (in that order).
2. In Supabase Dashboard:
   - Authentication -> Sign In / Providers -> Email: keep Email enabled.
   - Disable **Allow new users to sign up**.
   - Authentication -> URL Configuration: set the production Site URL and allowed redirect URLs.
   - Configure custom SMTP before production use.
   - Keep anonymous sign-ins enabled only while shared-code onboarding is still supported.
3. Provision approved users with `scripts/supabase/manage-auth-user.mjs`.
4. The app login screen provides:
   - Magic link: `signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo } })`.
   - Restore sessions on startup and use the returned access token for PostgREST and Edge Functions.
5. Migrate users in small batches and verify audit attribution/player binding.
6. After migration, disable anonymous sign-ins and remove the shared-code onboarding path in a
   separate tested change.

## Apply the migration

### Supabase SQL Editor

Open `supabase/migrations/20260929133000_approved_email_auth.sql`, paste the full file into a new
SQL query, and run it once. Repeat for
`supabase/migrations/20260929143000_players_email_allowlist.sql`.

### Supabase CLI

```powershell
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

## Provision an approved user

Use PowerShell environment variables for the Supabase service-role key:

```powershell
$env:SUPABASE_URL = 'https://<project-ref>.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = '<service-role-key>'
npm run auth:user:supabase -- approve approved@example.com
```

This provisions an email-confirmed account for magic-link login only. Existing password credentials
are not used by the application.

Inspect or revoke access:

```powershell
npm run auth:user:supabase -- status approved@example.com
npm run auth:user:supabase -- revoke approved@example.com
npm run auth:user:supabase -- list
```

`list` prints every allowed email derived from active `players.email` values, together with the
player it maps to and whether that player currently has active access. `approve` fails with
`<email> is not an approved Mexicano email` when the address is absent from `players.email`; add
or correct the player row first.

Revocation removes application access immediately. It intentionally does not delete the Auth user,
so access can be restored without creating a second identity.

## SQL verification

Run in the SQL Editor:

```sql
select
  a.email,
  a.approved_at,
  a.revoked_at,
  g.role,
  g.selected_player_id,
  g.expires_at,
  g.revoked_at as grant_revoked_at
from public.approved_auth_users a
left join public.app_access_grants g on g.user_id = a.user_id
order by a.email;
```

Expected: an approved user has no `revoked_at`, has a `member` grant, and has `expires_at = infinity`.

## Scenario tests

Use a non-production test user first.

| Scenario | Steps | Expected |
|---|---|---|
| Approved magic link | Provision user; request magic link; click it from the same browser; load app | Session is created for the same Auth user and protected data is returned |
| Unknown magic link | Request a magic link for an unapproved email | No Auth user is created and no usable link grants access; response may be generic to prevent email enumeration |
| Revoked user | Sign in, run `revoke`, retry a protected read and mutation | Existing token remains an identity, but RLS returns no protected rows and mutation rejects active access |
| Re-approved user | Run `approve` again, refresh/sign in again | Access works with the original Auth user ID |
| Expired admin elevation | Set an admin grant's expiry to the past | Member access remains; admin operations are denied |
| Anonymous transition | Complete old shared-code flow while anonymous sign-ins remain enabled | Existing onboarding still works during migration |
| Admin separation | Sign in as approved member and select an admin player without elevation | Admin mutation remains denied |

### Magic-link request without the app UI

```powershell
$body = @{
  email = 'approved@example.com'
  create_user = $false
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "$env:SUPABASE_URL/auth/v1/otp" `
  -Headers @{ apikey = '<public-anon-key>' } `
  -ContentType 'application/json' `
  -Body $body
```

Expected: the email arrives. The link must target an allowed redirect URL. Complete end-to-end
verification after the app callback/session handling is implemented.

### Revocation and admin-expiry tests

```sql
-- Test admin expiry using a test admin. Membership must remain active.
update public.app_access_grants g
set expires_at = now() - interval '1 minute'
from public.approved_auth_users a
where a.user_id = g.user_id
  and g.role = 'admin'
  and lower(a.email) = lower('approved@example.com');
```

After admin expiry, the protected `players` request still works; admin mutations return
`Admin access is required`. After explicit revocation, protected reads return no rows and
mutations return `Active app access is required`.

## Acceptance

- No local grant => onboarding displays magic-link and shared-code choices.
- Approved email + magic-link request => request uses `create_user: false` and the current deployed
  page as its redirect URL.
- Magic-link callback fragment => session is stored, auth parameters are removed from the URL, and
  the existing member grant is restored.
- Unapproved identity => remain on authentication with an inline error.
- An unapproved email cannot self-register.
- Revocation blocks reads and writes without deleting the identity.
- Selecting an admin player does not grant admin rights.
- An approved email user cannot bind (`bind_current_player`) any player other than the one their
  email resolves to. Edge Functions (`domain-mutation`, `elevate-admin`) always act as
  `approved_auth_users.player_id` when present (`effectivePlayerId()`), ignoring any selection.
  Shared-code sessions keep free selection while that transitional path exists.
- No service-role key or user password is committed or sent to the browser.
