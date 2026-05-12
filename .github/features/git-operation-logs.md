# Git Operation Logs

## Purpose
Debug and inspect all GitHub API operations (read, write, delete, list) performed during a session. Useful for understanding sync behaviour and diagnosing issues.

## Storage
- Stored in `localStorage` key: `mexicano_github_log`
- Max entries: 200 (oldest auto-evicted)
- **Not** pushed to GitHub — local only
- Persists across page navigation within the same browser session/tab

## Log Entry Shape
```json
{
  "ts": "2026-05-12T10:00:00.000Z",
  "action": "WRITE",
  "path": "mexicano_v3/backup-data/data/active_tournament.json",
  "caller": "writeFile ← pushAll",
  "detail": "update"
}
```

### Fields
| Field | Description |
|-------|-------------|
| `ts` | ISO timestamp of the operation |
| `action` | Operation type (see below) |
| `path` | Repo-relative file path |
| `caller` | Call chain (direct caller ← upstream caller) extracted from stack trace |
| `detail` | Optional extra info (e.g., "create" vs "update", error message) |

## Action Types
| Action | Meaning |
|--------|---------|
| `READ` | File fetched from GitHub |
| `READ_404` | File not found (404) |
| `LIST` | Directory listing fetched |
| `WRITE` | File write initiated |
| `WRITE_OK` | File write succeeded |
| `WRITE_FAIL` | File write failed |
| `WRITE_CONFLICT` | 409 conflict — retrying with fresh SHA |
| `DELETE` | File delete initiated |
| `DELETE_OK` | File delete succeeded |
| `DELETE_FAIL` | File delete failed |
| `PUSH_START` | `pushAll` started |
| `PUSH_DONE` | `pushAll` completed |
| `READ_TOURNAMENTS_INDEX` | Fetching tournaments.json |
| `TOURNAMENTS_INDEX_LOADED` | tournaments.json loaded |
| `TOURNAMENTS_INDEX_HEAL` | Stale entries detected in tournaments.json |
| `TOURNAMENTS_INDEX_HEALED` | Stale entries fixed and written |
| `TOURNAMENTS_INDEX_MISSING` | tournaments.json not found — traversing repo |
| `TOURNAMENTS_INDEX_CREATED` | tournaments.json created from scratch |
| `UPDATE_TOURNAMENT_ENTRY` | Upserting one entry in tournaments.json |

## UI — `/git-logs` page
- Bottom nav tab: 🔌 Logs
- Shows entries newest-first
- Each entry: colour-coded action badge + file path + caller chain + optional detail + timestamp
- "🗑 Clear" button in header removes all entries from localStorage immediately

## API
```js
import { getGitHubLog, clearGitHubLog } from './services/github.js';

getGitHubLog();   // returns array of entries, most recent first
clearGitHubLog(); // removes mexicano_github_log from localStorage
```
