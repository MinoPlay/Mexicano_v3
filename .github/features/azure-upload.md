# Azure Upload

## What
Upload a backup JSON file from the GitHub backend to Azure Tables storage — configured and triggered from the Settings page.

## Why
Manual Azure upload previously required editing `scripts/config.json` by hand. Settings UI provides file picker, persisted connection string, and a ready-to-copy CLI command.

## How It Works

### Settings UI (Azure Upload section)
- Collapsible section (`<details>`) — only visible when GitHub backend is configured.
- **Connection string** — `<input type="password">` saved to `localStorage` key `mexicano_azure_conn_str`.
- **File selector** — dropdown populated by listing backup `.json` files from the GitHub backend (traverses `YYYY/YYYY-MM/` folders via the GitHub Contents API).
- **Generated command** — read-only input showing:
  ```
  python scripts/upload_to_azure.py --file "backup-data/YYYY/YYYY-MM/YYYY-MM-DD.json" --connection-string "<conn>"
  ```
- **Copy button** — copies command to clipboard.

### Python Script (`scripts/upload_to_azure.py`)
Accepts two required CLI args:
```
--file PATH          Path to the local JSON backup file
--connection-string  Azure Storage Tables connection string
```

## Data Flow
1. User selects backup file from GitHub dropdown.
2. User enters / loads saved Azure connection string.
3. User copies generated command.
4. User runs command locally (Python + azure-data-tables package required).
5. Script fetches JSON from local `backup-data/` folder, transforms to Azure Tables entities, uploads in batches of 100.

## localStorage Key
`mexicano_azure_conn_str` — Azure connection string (persisted, never synced to GitHub).
