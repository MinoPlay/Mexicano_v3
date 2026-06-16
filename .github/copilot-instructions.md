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

## Agent Topology
Multi-agent dev flow lives in `.github/agents/*.agent.md`. All caveman.

- `orchestrator.agent.md` — main, user-facing. Dispatch-only. Routes request to a per-tab feature agent.
- `<feature>.agent.md` — one per tab. Created on demand from `feature-agent.template.md`. Runs the TDD pipeline + finalizes (cache bump).
- `researcher.agent.md` — reads code + `.github/features/<feature>.md`, creates/updates MD, emits findings + acceptance pairs. No code.
- `tester.agent.md` — writes FAILING vitest with hardcoded expected data (RED). No impl.
- `developer.agent.md` — minimal `js/` change to GREEN. No test edits.

Pipeline order (strict TDD): Researcher → Tester (RED) → Developer (GREEN) → feature agent finalizes.

Rules:
- Every agent does ONLY its role. Refuse adjacent work; report back.
- `.github/features/*.md` = truth. Read first, update on behavior change.
- Failing test (hardcoded expected data) FIRST, then implementation to green.
- Tester edits only `tests/**`; Developer only `js/**`; Researcher only `.github/features/*.md`; feature agent owns the `sw.js` cache bump (once per feature).
- TDD runner: `npx vitest run <file>` (targeted), `npx vitest run` (full).
