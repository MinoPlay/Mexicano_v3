# PAT-in-URL Bootstrap

## Purpose
Let an admin share ONE link that carries the GitHub PAT, so a new device is
configured without the user copy/pasting the token into the onboarding dialog.

Open link -> PAT saved to config -> onboarding Step 1 (PAT entry) skipped.

## Shareable URL shape
PAT goes in a query param named `pat`, in the URL **search** part (before the
hash), because this is a hash-based SPA on GitHub Pages:

```
https://minoplay.github.io/Mexicano_v3/?pat=ghp_xxx#/
```

A hash-query form is also accepted:

```
https://minoplay.github.io/Mexicano_v3/#/?pat=ghp_xxx
```

## Module
`js/services/pat-url.js`

```js
export function parsePatFromUrl(href)
// -> { pat: string|null, cleanUrl: string }
// Reads `pat` from search query first, then hash query.
// Strips the pat param from BOTH parts, returns cleaned href.

export function buildPatUrl(baseUrl, pat)
// -> "<baseUrl>?pat=<encoded>" (pat added to search part, hash preserved)
```

## Behavior
- `parsePatFromUrl` returns the raw pat string (trimmed) and a `cleanUrl` with
  the `pat` param removed from search AND hash query. Other params preserved.
- No `pat` present -> `{ pat: null, cleanUrl: <href unchanged> }`.
- Empty `pat=` -> treated as absent (`pat: null`).
- Multiple params -> only `pat` removed, order of remaining preserved.

## Wiring (app.js init, before showOnboardingDialog)
1. `parsePatFromUrl(location.href)`.
2. If `pat`: `Store.setGitHubConfig({ owner:'MinoPlay', repo:'DataHub_Mexicano', pat, basePath:'mexicano_v3/backup-data' })`.
3. `history.replaceState(null, '', cleanUrl)` — remove token from address bar/history.
4. Continue: `showOnboardingDialog()` sees PAT present, skips Step 1.

## Security note
Token lands in browser history/URL only until step 3 strips it. Link itself
still contains the PAT — treat the shareable link as a secret.

## Acceptance (input => expected)
Fixed config: owner=MinoPlay, repo=DataHub_Mexicano, basePath=mexicano_v3/backup-data

| input href | pat | cleanUrl |
|---|---|---|
| `https://x.io/app/?pat=ghp_ABC#/` | `ghp_ABC` | `https://x.io/app/#/` |
| `https://x.io/app/#/?pat=ghp_ABC` | `ghp_ABC` | `https://x.io/app/#/` |
| `https://x.io/app/#/settings` | `null` | `https://x.io/app/#/settings` |
| `https://x.io/app/?pat=#/` | `null` | `https://x.io/app/?pat=#/` (unchanged) |
| `https://x.io/app/?foo=1&pat=ghp_ABC&bar=2#/x` | `ghp_ABC` | `https://x.io/app/?foo=1&bar=2#/x` |

`buildPatUrl('https://x.io/app/#/', 'ghp_ABC')` => `https://x.io/app/?pat=ghp_ABC#/`
