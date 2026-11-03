---
name: tab-logs
description: Reference for the admin-gated Supabase Audit Logs route.
---

# Logs tab

## Purpose

`renderLogs()` in `js/pages/git-logs.js` shows append-only Supabase `audit_events`, newest first. It replaces the old local round-log viewer.

## Access

Navigation remains visible only when:

```js
Store.isAdministrator() && Store.isLogsEnabled()
```

RLS independently requires an active admin grant to select `audit_events`. Selecting an administrator player does not grant access.

## Rendering

Each event shows action, entity type/id, actor player, timestamp, and structured `after_data` or metadata. The page has loading, empty, and explicit error states. Audit events cannot be cleared from the UI.

## Data flow

`git-logs.js` -> `backend.fetchAuditEvents()` -> `supabase.listAuditEvents()` -> PostgREST `audit_events`.

Legacy `round-log.js` remains for local diagnostic compatibility but is no longer the Logs page data source.

## Key files

- `js/pages/git-logs.js`
- `js/services/backend.js`
- `js/services/supabase.js`
- `js/components/nav.js`
- `supabase/migrations/20260924120000_supabase_source_of_truth.sql`

Update this skill when audit shape, RLS, nav gating, or Logs rendering changes.
