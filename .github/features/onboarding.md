# Onboarding — Supabase Access + Player Setup

## Purpose

First launch has two required steps:

1. Authenticate with an approved-email magic link or the transitional shared Mexicano app access
   code.
2. Select the current player profile.

Supabase Auth replaces the GitHub PAT. Supabase project URL and public anon key are shipped as
public application configuration.

## Trigger

- Full onboarding: no active Supabase grant/session.
- Player-only step: active ordinary grant exists but no bound current player.
- Skip: active grant and current player ID are present.

## Access

- Magic-link requests set `create_user: false`; callback tokens are captured before hash routing,
  then the user's existing access grant is loaded.
- Transitional shared-code access creates/restores an anonymous session and calls `claim-access`.
- Successful authentication stores role/expiry only; passwords and access codes are never persisted.
- Players are loaded from Supabase after the grant succeeds.
- When the grant has a `selected_player_id` (set by email approval from `players.email`), the player
  name is fetched and bound automatically and the player-selection step is skipped.
- Selecting a player calls `bind_current_player` and stores the returned/bound player ID locally for cache lookup.

## Admin

Selecting an administrator name does not grant admin access. Settings provides a separate admin-code elevation action for designated admin players. Admin elevation is short-lived and server-authorized.

## Public project config

`data/supabase-config.json` contains:

```json
{
  "url": "https://<project>.supabase.co",
  "anonKey": "<public-anon-key>"
}
```

These values are public client configuration, not secrets. Service-role and access-code hashes never appear in the repository/browser.

The deployed config file is authoritative on every app start. If its project URL or anon key differs
from the persisted browser config, the app replaces the stale config and clears the old project-bound
session, access grant, and selected-player binding before onboarding continues.

## UX

- No dismiss/skip button.
- Magic-link and shared-code options are visible together.
- A successful magic-link request reports that the user should check their email.
- Invalid/expired access reports an inline error.
- Missing public project configuration reports deployment misconfiguration; it does not ask users for URL/key.
- Player list failure is an error; arbitrary free-text identity is not allowed.
- On success, normal route loading starts from Supabase.

## Acceptance

- no grant => magic-link and shared-code choices shown.
- approved email + magic-link callback => ordinary grant restored and player selection shown.
- unknown magic-link email => no account is created.
- valid code => ordinary grant stored, raw code absent from storage.
- invalid code => remain on step 1 with error.
- persisted config for another project + current deployed config => deployed config stored and old project session/grant/player binding cleared.
- ordinary grant + no player => player selection shown.
- select player => server binding succeeds before dialog closes.
- select admin player without admin elevation => `Store.isAdministrator()` is false.
- valid separate admin code for admin-designated player => admin role active until expiry.
