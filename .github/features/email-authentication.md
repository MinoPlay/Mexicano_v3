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

Expected: an approved user has no `revoked_at`, has a `member` grant, and has a future `expires_at`.

## Scenario tests

Use a non-production test user first.

| Scenario | Steps | Expected |
|---|---|---|
| Approved magic link | Provision user; request magic link; click it from the same browser; load app | Session is created for the same Auth user and protected data is returned |
| Unknown magic link | Request a magic link for an unapproved email | No Auth user is created and no usable link grants access; response may be generic to prevent email enumeration |
| Revoked user | Sign in, run `revoke`, retry a protected read and mutation | Existing token remains an identity, but RLS returns no protected rows and mutation rejects active access |
| Re-approved user | Run `approve` again, refresh/sign in again | Access works with the original Auth user ID |
| Expired grant | Temporarily set test grant expiry to the past | Protected reads and writes are denied |
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

### Revocation and expiry tests

```sql
-- Test expiry. Replace the address, then restore by running the approve script again.
update public.app_access_grants g
set expires_at = now() - interval '1 minute'
from public.approved_auth_users a
where a.user_id = g.user_id
  and lower(a.email) = lower('approved@example.com');
```

After expiry or revocation, repeat the protected `players` request with the existing token. Expected:
an empty result because RLS no longer sees active access. Edge Function mutations must return
`Active app access is required`.

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
