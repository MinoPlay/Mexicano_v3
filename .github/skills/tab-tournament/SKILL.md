---
name: tab-tournament
description: >
  Reference skill for the Tournament detail tab (route /tournament/:date) of the Mexicano PWA,
  including the side-by-side Matches and Leaderboard panels. Covers purpose, rules, key files,
  data flow. Use when working on the tournament detail page.
---

# Tournament (detail) tab

## Purpose
The Tournament detail tab renders one tournament at `#/tournament/:date`, where `:date` is a `yyyy-MM-dd` tournament date. The route is mapped in `js/app.js` to `renderTournament(container, params)` from `js/pages/tournament.js`.

The desktop page is a live tournament workspace and historical viewer with Matches and Leaderboard visible side by side in `.tournament-desktop`. It no longer uses route-level or in-page Matches/Leaderboard tabs.

## Rules / Logic
`renderTournament(container, params)` owns page-local state: `date`, `tournament`, `viewingRound` (`-1` means latest), `isLoading`, and the `State.on('tournament-changed')` subscription.

Loading rules:

- If `getActiveTournament()` matches the route date, render it first and, with Supabase configured, background-refresh active or completed day data.
- Otherwise load local completed data through `loadTournamentByDate(date)`.
- If local data is missing and Supabase is configured, call `ensureDayMatchesLoaded(date)` and retry.
- If no tournament exists, render an empty state linking to `#/create-tournament`.

Header rules:

- Previous/next buttons navigate across `Store.getTournamentsIndex()` sorted newest-first.
- `getStatusBadge(tournament)` renders Completed, In Progress, or Not Started.
- Access code appears in the toolbar. Admins see the inline access-code editor and saving calls `updateAccessCode(date, codeToSave)`.

Matches panel rules:

- `renderMatchesTab(content, roundIdx, totalRounds, isLatestRound)` renders the selected round into the left panel.
- Round navigation mutates `viewingRound` and re-renders.
- Matches render as inline `.match-card` entries inside `.round-matches`; `js/components/match-card.js` is not imported here.
- Court labels use `tournament.courts?.[idx] ?? idx + 1`.
- Confirmation checkmarks are computed from `tournament.players[].confirmed`.
- Admins can click incomplete match cards to open `openScoreSheet(roundIdx, matchIdx)`. Non-admins and completed tournaments are read-only.
- Score validation requires non-negative numbers totaling 25. Saving calls `setMatchScore(tournament, round.roundNumber, match.id, s1, s2)`, closes the sheet, re-renders, and emits `State.emit('tournament-changed', tournament)`.
- Admin latest-round actions include Next Round, End Tournament, and Delete Tournament. Ending uses `showProgressConfirmDialog()` with `COMPLETION_STEPS` and `runTournamentCompletion()`.
- Any current user who is a player and not confirmed sees `#confirm-attendance-btn`; clicking calls `confirmAttendanceAndPush(user)` and best-effort sends `sendTournamentConfirmationAlert()`.

Leaderboard panel rules:

- `renderLeaderboardTab(content)` renders the right panel every time the page renders.
- If day match history exists in `Store.getMatches()`, it calls `renderDayStatsInto(content, dayMatches, date, isLatest, name => { window.location.hash = '/players?p=...' })`.
- If no match history is loaded, it falls back to `rankPlayers(tournament.players)` and renders inline standings from active/in-progress player stats.
- Leaderboard player names navigate to the Players hub rather than opening the old Statistics profile dialog.

## Key Files & Symbols
- `js/pages/tournament.js` — exports `renderTournament`; local helpers include `fitNamesToMaxWidth`, `formatDate`, `getStatusBadge`, `renderMatchesTab`, `renderLeaderboardTab`, `openScoreSheet`, `showConfirmDialog`, `showProgressConfirmDialog`, and `esc`.
- `js/pages/statistics.js` — `renderDayStatsInto` renders the rich completed-day leaderboard.
- `js/services/tournament.js` — `getActiveTournament`, `setMatchScore`, `startNextRound`, `runTournamentCompletion`, `COMPLETION_STEPS`, `loadTournamentByDate`, `getLatestCompleteTournamentDate`, `updateAccessCode`, `deleteTournament`, `confirmAttendanceAndPush`, `isMatchComplete`, and `isRoundComplete`.
- `js/services/ranking.js` — `rankPlayers` for fallback active-tournament standings.
- `js/services/backend.js` — lazy active/day hydration (`fetchActiveTournamentJson`, `ensureDayMatchesLoaded`, `readDayMatches`).
- `js/services/telegram.js` — `sendTournamentConfirmationAlert`.
- `js/store.js` — active tournament, matches, tournaments index, current user, admin state, and Supabase config.
- `js/state.js` — `State.on` and `State.emit` for tournament changes.
- `js/app.js` — registers `/tournament/:date`.
- `css/desktop.css` — `tournament-desktop`, `tournament-side`, `panel`, and desktop match layout classes.

## Data
The page reads active tournament objects with `tournamentDate`, `accessCode`, `courts`, `players`, `rounds`, `currentRoundNumber`, `isStarted`, and `isCompleted`.

Completed match rows use flattened fields:

```js
{
  date,
  roundNumber,
  team1Player1Name,
  team1Player2Name,
  team2Player1Name,
  team2Player2Name,
  scoreTeam1,
  scoreTeam2
}
```

Store/cache sources include active tournament, completed matches, tournaments index, current user, admin state, and Supabase route hydration. The route load for `#/tournament/:date` remains date-scoped unless the page explicitly needs the requested day.

## Sub-tabs / Sections
There are no sub-tabs. The page sections are:

- Header — prev/next navigation, date, round indicator, and status badge.
- Toolbar — access code display/editor.
- Matches panel — round navigation, match cards, score sheet, confirmation button, and admin actions.
- Leaderboard side panel — completed-day rich stats or active-player fallback.
- Dialogs/sheets — score bottom sheet, delete/overwrite confirmation, and completion progress dialog.

## Related Feature Docs
- `.github/features/tournament-management.md` — tournament lifecycle, scoring, admin/write policy, access code, and GitHub/Supabase integration.
- `.github/features/tournament-confirmation-popup.md` — player attendance confirmation and alerts.
- `.github/features/tournament-round-logs.md` — completion/error logging contract.
- `.github/features/desktop-ui.md` — side-by-side Tournament detail layout.

## Update Protocol
Update this skill whenever `js/pages/tournament.js` render/scoring/round logic, side-by-side layout, leaderboard navigation, data shape, or routing changes, or when the linked feature MDs change.
