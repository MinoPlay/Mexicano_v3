---
name: mexicano-tdd
description: >
  Strict TDD pipeline for Mexicano features. Drives ONE feature end-to-end inline:
  research (read/update feature MD + acceptance pairs) -> write FAILING vitest (RED)
  -> minimal js/ change (GREEN) -> finalize (full vitest + bump sw.js CACHE_NAME).
  Use when user asks to add, change, fix, or implement a feature/tab in Mexicano
  (home, tournaments, tournament, create-tournament, statistics, elo-charts,
  attendance, doodle, logs, settings). Caveman style.
---

Drive ONE Mexicano feature through strict TDD, inline, in this conversation. Caveman talk.

## Truth
`.github/features/*.md` = truth. Read matching MD first. Missing -> create. Stale -> update.

## Paths (by feature/tab)
- Feature MD: `.github/features/<feature>.md`
- Page code: `js/pages/<feature>.js` (+ `js/components/`, `js/services/`, `state.js`, `store.js`)
- Test: `tests/pages/<feature>.test.js` (mirror code path; tournament uses `tests/tournament/*.test.js`)

## Pipeline (strict order, red-then-green)
1. **Research** — read `.github/features/<feature>.md` + smallest set of `js/` files (named
   file first, expand only on blocker). Record: files, exported symbols, data shapes (JSON),
   edge cases. Define acceptance criteria as concrete `input => expected` pairs (hardcodable).
   Create/update the feature MD to match intended behavior. No test/impl code yet.
2. **RED** — write FAILING vitest from acceptance pairs. Import real symbol from `js/...`.
   Hardcode expected values (no mocking the answer). Run `npx vitest run <test-file>`.
   Confirm RED for the RIGHT reason (missing/incorrect impl, NOT typo/import error).
3. **GREEN** — minimal `js/` change to pass. ES6 modules, vanilla JS, no frameworks, no build.
   `npx vitest run <test-file>` until GREEN. Then `npx vitest run` (full) — no regressions.
4. **Finalize** — confirm whole suite passes. Ensure feature MD matches final behavior.
   Bump version: `APP_VERSION` +1 in `js/version.js` (only edit — `sw.js` imports it and derives `CACHE_NAME`). Manual, last step, once.

## Hard limits
- Tests edited only under `tests/**`. Implementation only under `js/**`. MD only `.github/features/*.md`.
- Failing test (hardcoded expected data) FIRST, then impl to green. Never green-by-accident.
- Minimal scope: implement only what the test demands. No extra features, no refactors.
- No new deps. No npm build. Match existing patterns (router, store, state, services).
- Never push to GitHub without explicit user request.

## Report format
1. **MD**: created/updated/found + path.
2. **RED**: failing test path + line + hardcoded expected values.
3. **GREEN**: targeted pass line + full `npx vitest run` summary.
4. **Cache**: new CACHE_NAME value.
