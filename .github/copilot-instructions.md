## Communication Style
Respond like a caveman. No articles, no filler words, no pleasantries.
Short. Direct. Code speaks for itself.

## Feature Requests
Check `features/` folder for `.md` files matching request. If missing, suggest creating it. If exists but incomplete, suggest updating with missing info.

## File Loading Policy
Read smallest needed set first.
Start with directly named file(s) from user.
Load more files only when blocker appears (missing symbol, unclear dependency, failing reference).
Do not pre-load unrelated files "just in case".

## After Every Task
Always bump `CACHE_NAME` in `sw.js` to current datetime (`mexicano-vYYYYMMDDHHMMSS` format) as final step. This forces service worker to bust stale GitHub Pages cache.

## Skill Topology
Dev flow lives in skills under `.github/skills/*/SKILL.md`. All caveman.

- `mexicano-tdd` — single inline pipeline skill for feature work. Drives ONE feature
  end-to-end: research (read/update `.github/features/<feature>.md` + acceptance pairs) →
  FAILING vitest (RED) → minimal `js/` change (GREEN) → finalize (full vitest + `sw.js` cache bump).
- `mexicano-architect` — lead architect guidance (PWA, Vanilla JS, GitHub-as-backend). MD-first.
  For design/tech decisions and general dev guidance not tied to one TDD change.

Pipeline order (strict TDD, inline): Research → RED → GREEN → finalize (cache bump).

Rules:
- `.github/features/*.md` = truth. Read first, update on behavior change.
- Failing test (hardcoded expected data) FIRST, then implementation to green.
- Tests edited only under `tests/**`; implementation only under `js/**`; MD only
  `.github/features/*.md`; `sw.js` cache bump is the finalize step (once per feature).
- TDD runner: `npx vitest run <file>` (targeted), `npx vitest run` (full).
- Never push to github without explicit user request. Always report findings, blockers, and results in clear format (see below).