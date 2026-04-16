# Mexicano Tournament Manager

A Progressive Web App (PWA) for managing **Mexicano-format padel/tennis tournaments** — with ELO ratings, player statistics, attendance tracking, and scheduling.

## Features

- **Live tournament management** — create, run, and score multi-round Mexicano tournaments (4 / 8 / 12 / 16 players)
- **ELO rating system** — Classic and Scored ELO variants tracked across all tournaments
- **Player statistics** — per-tournament and all-time stats (wins, losses, points, averages, win rate)
- **Attendance tracking** — derived from match participation; monthly views and historical percentages
- **Doodle scheduling** — players indicate availability for upcoming dates
- **Offline support** — service worker caches the app for offline use
- **Dark / Light theme**

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)

## Running Locally

```bash
node server.js
```

The app starts at **http://localhost:3000**. No `npm install` is needed — the server uses only Node.js built-in modules. (Dev dependencies like Playwright are only required for running tests.)

On first launch with no existing data, demo seed data (12 players, 3 tournaments) is loaded automatically so you can explore the app immediately.

## Data Sources

### Local development — file system (`local-config.json`)

When running on the local dev server (`npm start`), the server reads an optional **`local-config.json`** file from the project root (git-ignored) to serve real match data from your file system.

Create the file:

```json
{
  "dataPath": "C:\\path\\to\\your\\backup-data"
}
```

The `dataPath` directory should contain:

| File / pattern | Purpose |
|---|---|
| `players.json` | Array of player objects with a `Name` field |
| `YYYY-MM-DD.json` (nested in any subfolder) | Tournament day files with a `matches` array (PascalCase fields) |

The server exposes these via local API endpoints:

| Endpoint | Description |
|---|---|
| `GET /api/local-data/status` | Returns `{ "available": true/false }` indicating if local data is configured |
| `GET /api/local-data/players` | Returns the contents of `players.json` |
| `GET /api/local-data/matches` | Recursively collects all matches from `YYYY-MM-DD.json` files |

On app load, if the local data API is available, matches and players are imported into `localStorage` automatically (once per session).

### Cloud / production — GitHub repository backend

When deployed (e.g., on GitHub Pages), data is persisted to a **GitHub repository** via the GitHub Contents API. No server is needed — the app calls the API directly from the browser.

#### Setup

1. Create a **private GitHub repository** for your data (e.g., `mexicano-data`).
2. Generate a **Personal Access Token (PAT)** with the `repo` scope.
3. Open the app → **Settings** (⚙️) → **GitHub Backend** section → enter owner, repo name, and PAT.

#### How it works

| Concept | Detail |
|---|---|
| **Storage format** | Match data stored as `YYYY/YYYY-MM/YYYY-MM-DD.json`; other data under `data/` |
| **Auto-sync** | Every local write triggers a debounced push (1.5 s after last change) |
| **Manual sync** | **Push All** / **Pull All** buttons in Settings |
| **Local cache** | Data is always kept in `localStorage` for instant offline access |

#### Synced data

| App data | GitHub path |
|---|---|
| Match results | `YYYY/YYYY-MM/YYYY-MM-DD.json` |
| Active tournament | `data/active_tournament.json` |
| Changelog | `data/changelog.json` |
| Doodle entries | `data/doodle_YYYY-MM.json` |

Members, theme, and current user are **local-only** and not synced to GitHub.

### Summary

| Environment | Data source | Mechanism |
|---|---|---|
| **Local dev** (no `local-config.json`) | Demo seed data | Auto-populated in `localStorage` on first load |
| **Local dev** (with `local-config.json`) | Local JSON files on disk | Served by `server.js` via `/api/local-data/*` endpoints |
| **Cloud / production** | GitHub repository | GitHub Contents API, configured in Settings |

## Testing

End-to-end tests use [Playwright](https://playwright.dev/):

```bash
npm test              # headless
npm run test:headed   # with browser UI
npm run test:ui       # Playwright interactive UI
```

## Project Structure

```
├── index.html              # SPA entry point
├── server.js               # Local dev server (Node.js, no dependencies)
├── sw.js                   # Service worker for offline caching
├── manifest.json           # PWA manifest
├── local-config.json       # (git-ignored) local data path config
├── js/
│   ├── app.js              # App bootstrap & routing
│   ├── router.js           # Client-side SPA router
│   ├── store.js            # localStorage wrapper with auto-sync
│   ├── state.js            # Reactive state management
│   ├── seed-data.js        # Demo data for first-time visitors
│   ├── services/           # Business logic (ELO, stats, GitHub sync, …)
│   ├── components/         # Reusable UI components
│   └── pages/              # Page renderers (home, tournaments, stats, …)
├── css/                    # Stylesheets (variables, base, components, pages)
├── assets/                 # Icons and images
├── docs/                   # Detailed design documentation
└── scripts/                # Python utility scripts (data generation)
```

## Documentation

See the `docs/` folder for detailed design documents:

1. [Application Overview](docs/01-OVERVIEW.md)
2. [Data Models](docs/02-DATA-MODELS.md)
3. [Tournament Engine](docs/03-TOURNAMENT-ENGINE.md)
4. [ELO & Statistics](docs/04-ELO-AND-STATISTICS.md)
5. [Attendance & Scheduling](docs/05-ATTENDANCE-AND-SCHEDULING.md)
6. [Implementation Guide](docs/06-IMPLEMENTATION-GUIDE.md)
7. [GitHub Backend](docs/07-GITHUB-BACKEND.md)
