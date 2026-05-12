# Onboarding — PAT + Player Setup

## Purpose
When a user opens the app for the first time (no GitHub config saved), guide them through:
1. Entering their GitHub Personal Access Token (PAT)
2. Selecting themselves from the player list

This replaces the silent failure / empty state that previously occurred with no config.

## Trigger Conditions
- **Full onboarding** (both steps): `!Store.getGitHubConfig()?.pat`
- **Step 2 only** (player pick): PAT exists but `!Store.getCurrentUser()`
- **Skip entirely**: PAT and `current_user` both present

## Component
`js/components/onboarding-dialog.js`

```js
export async function showOnboardingDialog()
// Returns Promise<void> — resolves when onboarding is complete
```

Called from `js/app.js` `init()` before `loadFromGitHub()`.

## Step 1 — GitHub PAT
- Fullscreen overlay, centered card (max-width 360px)
- Password input for PAT
- "Connect" button → calls `testConnection()` from `github.js`
- Shows inline success/error feedback
- On success: `Store.setGitHubConfig({ owner, repo, pat, basePath })` using fixed defaults
- Advance to Step 2

Fixed defaults (same as Settings page):
```
owner:    MinoPlay
repo:     DataHub_Mexicano
basePath: mexicano_v3/backup-data
```

## Step 2 — Player Selection
- Fetch `players.json` from GitHub → extract `Name` fields → sorted list
- Show as clickable player buttons
- On selection → `Store.setCurrentUser(name)` → resolve Promise (close dialog)
- Fallback (players.json missing or empty): show text input so user can type name

## UX Rules
- No close / dismiss / skip button — user must complete onboarding
- No nav visible during onboarding (dialog sits on top with overlay)
- Step indicator shown (dots or "Step 1 of 2")

## Data Written
| Key | Location | Value |
|-----|----------|-------|
| `mexicano_github_config` | localStorage | `{ owner, repo, pat, basePath }` |
| `mexicano_current_user`  | localStorage | `"PlayerName"` |

No GitHub files are created or modified during onboarding.

## After Completion
Normal `loadFromGitHub()` runs, fetching all data with the newly saved config.
