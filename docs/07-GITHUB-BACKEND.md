# 07 — GitHub Backend

This document explains how to configure and use the GitHub repository backend that allows Mexicano to persist all app data in a GitHub repo instead of (or in addition to) the browser's `localStorage`.

---

## Overview

The GitHub backend feature lets each user point the app at a GitHub repository and store data there as JSON files. The data is still **also** kept in `localStorage` for instant offline access; GitHub acts as a durable, external backup and enables multi-device synchronisation.

Authentication is done with a **Personal Access Token (PAT)** that never leaves the browser — it is stored in `localStorage` and sent directly to the GitHub API over HTTPS.

---

## Setup

### 1 — Create a GitHub repository

Create a new **private** repository (recommended) under your GitHub account or organisation. The repository can be empty; the app will create the `data/` folder automatically on first push.

### 2 — Create a Personal Access Token

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**.
2. Click **Generate new token**.
3. Give it a descriptive name, e.g. `mexicano-app`.
4. Select the **`repo`** scope (full control of private repos).
5. Click **Generate token** and copy the value.

> ⚠️ Store the PAT somewhere safe — it is only shown once. You can revoke it at any time from the GitHub settings.

### 3 — Configure the app

1. Open the **Settings** page (`⚙️` tab in the bottom nav).
2. Scroll to the **GitHub Backend** section.
3. Fill in:
   | Field | Example |
   |---|---|
   | GitHub owner | `myusername` |
   | Repository name | `mexicano-data` |
   | Personal Access Token | `ghp_xxxxxxxxxxxxxxxxxxxx` |
4. Click **Save**.
5. Click **Test** to verify the connection. The sync icon next to the section title will turn ✅ on success or ❌ on failure.

---

## Sync Icon

The sync icon in the **GitHub Backend** section title shows the current state at a glance:

| Icon | Meaning |
|------|---------|
| ⬜ | Idle — no sync pending |
| 🔄 | Syncing — push or pull in progress |
| ✅ | Success — last sync completed successfully |
| ❌ | Error — last sync failed (see status message below) |

---

## Data File Mapping

All data is stored under a `data/` folder in the configured repository. Each data type maps to one JSON file:

| App data | GitHub file |
|----------|-------------|
| Members roster | `data/members.json` |
| Match results | `data/matches.json` |
| Active tournament | `data/active_tournament.json` |
| Changelog | `data/changelog.json` |
| Doodle entries (per month) | `data/doodle_YYYY-MM.json` |

Config keys (`github_config`, `theme`, `current_user`) are **not** synced to GitHub.

---

## Automatic Sync

After every write to the local store (adding a member, saving a match, etc.) a **debounced push** is scheduled. It fires 1.5 s after the last change, batching rapid updates into a single API call. The sync icon switches to 🔄 while the push is in flight.

---

## Manual Push / Pull

Two buttons are available in the GitHub Backend section:

- **⬆ Push All** — Immediately write all local data to GitHub, overwriting remote files.
- **⬇ Pull All** — Fetch all files from GitHub and overwrite local `localStorage`. The page reloads automatically after a successful pull.

> ⚠️ A confirmation dialog appears before a **Pull All** to avoid accidental data loss.

---

## Security Considerations

- The PAT is stored in plain text in `localStorage`. Anyone with access to the browser's dev tools can read it.
- Use a **dedicated PAT** with only the `repo` scope, scoped to a single private repository if possible.
- Revoke the PAT from GitHub if you no longer need the integration or if you suspect it has been compromised.
- On shared devices, use the **Clear** button to remove the config from `localStorage`.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| ❌ "Repository not found" | Wrong owner/repo name, or repo is private and PAT lacks `repo` scope | Check names and PAT scopes |
| ❌ "Invalid PAT (401 Unauthorized)" | PAT is wrong, expired, or revoked | Generate a new PAT |
| ❌ "Forbidden — check PAT scopes" | PAT exists but lacks `repo` scope | Regenerate with `repo` scope |
| ❌ "Network error" | No internet connection | Check connectivity |
| Push succeeds but data doesn't appear | Files may be in a different branch | Check repo default branch |

---

## Implementation Details

| File | Role |
|------|------|
| `js/services/github.js` | GitHub Contents API wrapper — `readFile`, `writeFile`, `testConnection`, `pushAll`, `pullAll`, `schedulePush` |
| `js/store.js` | `getGitHubConfig` / `setGitHubConfig` / `clearGitHubConfig` + auto-sync hook in `set()` |
| `js/pages/settings.js` | GitHub Backend UI section |
| `tests/e2e/github-settings.spec.js` | Playwright end-to-end tests |
