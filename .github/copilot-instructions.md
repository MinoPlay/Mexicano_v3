## Communication Style
Respond short. Direct. Code speaks for itself.

## Feature Requests
Check `features/` folder for `.md` files matching request. If missing, suggest creating it. If exists but incomplete, suggest updating with missing info.

## File Loading Policy
Read smallest needed set first.
Start with directly named file(s) from user.
Load more files only when blocker appears (missing symbol, unclear dependency, failing reference).
Do not pre-load unrelated files "just in case".

## After Every Task
Always bump version as final step (no git hook does this — manual). Increment `APP_VERSION` by +1 in `sw.js`. That's the ONLY edit — `sw.js` is a module service worker that declares `APP_VERSION` (single source of truth) and derives `CACHE_NAME = mexicano-v<APP_VERSION>` automatically; `js/version.js` imports `APP_VERSION` from `sw.js`. This forces service worker to bust stale GitHub Pages cache.

## Skill Topology
Dev flow lives in skills under `.github/skills/*/SKILL.md`. All caveman.

- `mexicano-tdd` — single inline pipeline skill for feature work. Drives ONE feature
  end-to-end: research (read/update `.github/features/<feature>.md` + acceptance pairs) →
  FAILING vitest (RED) → minimal `js/` change (GREEN) → finalize (full vitest + `sw.js` cache bump).
- `mexicano-architect` — lead architect guidance (PWA, Vanilla JS, GitHub-as-backend). MD-first.
  For design/tech decisions and general dev guidance not tied to one TDD change.

### Tab reference skills (`.github/skills/tab-<name>/SKILL.md`)
One reference skill per page/route. Each documents purpose, rules/logic, key files & symbols,
data (store/state/services), sub-tabs, related feature docs, and an update protocol. Normal prose
(not caveman). Read the matching tab skill first when working on a page.

- `tab-home` — `/` (js/pages/home.js): latest tournament + current-month tables.
- `tab-tournaments` — `/tournaments` (js/pages/tournaments.js): tournaments list.
- `tab-tournament` — `/tournament/:date` (js/pages/tournament.js): Matches / Leaderboard sub-tabs.
- `tab-create-tournament` — `/create-tournament` (js/pages/create-tournament.js).
- `tab-statistics` — `/statistics` (js/pages/statistics.js): Statistics/Attendance + profile Overview/Head-to-Head/Partners.
- `tab-elo-charts` — `/elo-charts` (js/pages/elo-charts.js).
- `tab-attendance` — `/attendance` (js/pages/attendance.js): Calendar / Statistics sub-tabs.
- `tab-doodle` — `/doodle` (js/pages/doodle.js): scheduling + Telegram alerts.
- `tab-logs` — `/logs` admin-gated (js/pages/git-logs.js).
- `tab-settings` — `/settings` (js/pages/settings.js).

**Keep tab skills in sync:** whenever you change a page's render logic, sub-tabs, data shape,
routing, or admin gating, update its `tab-<name>/SKILL.md` in the same task.

Pipeline order (strict TDD, inline): Research → RED → GREEN → finalize (cache bump).

Rules:
- `.github/features/*.md` = truth. Read first, update on behavior change.
- Failing test (hardcoded expected data) FIRST, then implementation to green.
- Tests edited only under `tests/**`; implementation only under `js/**`; MD only
  `.github/features/*.md`; `sw.js` cache bump is the finalize step (once per feature).
- TDD runner: `npx vitest run <file>` (targeted), `npx vitest run` (full).
- Never push to github without explicit user request. Always report findings, blockers, and results in clear format (see below).