# Preview Deployments (parallel branch versions on GitHub Pages)

## Goal
Test different setups in parallel without breaking main. Every branch live at own URL.

## URLs
- `main` → `https://minoplay.github.io/Mexicano_v3/`
- any other branch → `https://minoplay.github.io/Mexicano_v3/preview/<slug>/`
- index of all previews → `https://minoplay.github.io/Mexicano_v3/preview/`
- `<slug>` = branch name lowercased, every char outside `[a-z0-9-]` → `-`
  (e.g. `feature/limits` → `feature-limits`).

## Deploy (`.github/workflows/pages.yml`)
- Triggers: `push` (all branches), `delete` (branch), `workflow_dispatch`.
- Each run rebuilds the WHOLE site from every remote branch (`git archive`) → deleted
  branch disappears on next run (auto cleanup). `concurrency: pages`, cancel in progress.
- Dev-only files stripped: `node_modules`, `tests`, `docs`, `.github`, `.agents`, `scripts`, `package*.json`, etc.
- One-time repo setup:
  - Pages source = **GitHub Actions**:
    `gh api -X PUT repos/MinoPlay/Mexicano_v3/pages -f build_type=workflow`
  - Environment `github-pages` → Deployment branches: allow **all branches**
    (default rule only lets `main` deploy).

## Isolation (same origin → must namespace)
Deploy id from URL path (`js/deploy-env.js`):
- `getDeployId(pathname)` → `''` for main, `<slug>` when path has `/preview/<slug>/`.
- `nsPrefix(id)` → `''` for main, `preview-<slug>:` for preview.

Rules:
- **Main unchanged**: all keys, DB names, cache names identical to before (no migration).
- **localStorage + sessionStorage**: in a preview `installStorageNamespace` patches
  `Storage.prototype` so every key is transparently prefixed with `preview-<slug>:`;
  `length`/`key(i)`/`clear()` only see/touch own-namespace keys. Installed as the very first
  import of `js/app.js` (`js/storage-ns-init.js`).
  → own PAT/GitHub config, user, tournament state per preview.
- **Cross-tab `storage` event** in app.js compares against namespaced key.
- **IndexedDB** notification history DB: `nsPrefix + 'mexicano-notifications'`.
- **Cache API**: `getCacheName(version, id)` → `mexicano-v<N>` (main) /
  `mexicano-<slug>-v<N>` (preview). `isOwnCache(name, id)` — SW `activate` and
  `refreshApp()` delete only own-family caches (main never wipes preview caches, and v.v.).
- **SW scope**: main SW scope `/Mexicano_v3/` also covers `/preview/*` → main SW must NOT
  handle requests under `/preview/` (`shouldHandleRequest(req, origin, scopePath)`).
- Push subscription is per SW registration → per deploy automatically.
- Notification permission / cookies stay shared (origin-level) — accepted.

## Backend
Preview uses whatever GitHub config is set in ITS Settings. Default PAT bootstrap still
points to prod data repo `MinoPlay/DataHub_Mexicano` → writes + Telegram + push are REAL.
User choice, by design.

## Caveat — branches without this code
Isolation lives in the app code. A branch forked BEFORE this feature deploys fine but is NOT
isolated (shares main's localStorage; its SW `activate` wipes all other caches). Rebase/merge
main into the branch to get isolation. Slug collisions (e.g. `a/b` vs `a-b`) → last one wins.

## UI
Home title shows ` · preview:<slug>` suffix when running as preview.

## Acceptance pairs
- `getDeployId('/Mexicano_v3/')` → `''`
- `getDeployId('/Mexicano_v3/index.html')` → `''`
- `getDeployId('/Mexicano_v3/preview/feature-limits/')` → `'feature-limits'`
- `getDeployId('/Mexicano_v3/preview/feature-limits/sw.js')` → `'feature-limits'`
- `getDeployId('/')` → `''`
- `slugifyBranch('feature/limits')` → `'feature-limits'`; `slugifyBranch('Supabase_POC')` → `'supabase-poc'`
- `nsPrefix('')` → `''`; `nsPrefix('x')` → `'preview-x:'`
- `getCacheName(97, '')` → `'mexicano-v97'`; `getCacheName(97, 'x')` → `'mexicano-x-v97'`
- `isOwnCache('mexicano-v96', '')` → true; `isOwnCache('mexicano-x-v96', '')` → false;
  `isOwnCache('mexicano-x-v96', 'x')` → true; `isOwnCache('mexicano-v96', 'x')` → false
- preview ns `x`: `localStorage.setItem('a','1')` → raw key `preview-x:a`; `getItem('a')` → `'1'`;
  main-set key `mexicano_theme` invisible (`getItem` null, not in `key(i)`/`length`); `clear()`
  keeps main keys.
- `shouldHandleRequest(GET https://o/Mexicano_v3/preview/x/app.js, 'https://o', '/Mexicano_v3/')` → false
- `shouldHandleRequest(GET https://o/Mexicano_v3/preview/x/app.js, 'https://o', '/Mexicano_v3/preview/x/')` → true
- `shouldHandleRequest(GET https://o/Mexicano_v3/js/app.js, 'https://o', '/Mexicano_v3/')` → true
