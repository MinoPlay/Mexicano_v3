# Feature: Logs Toggle

Admin setting to enable/disable the round Logs feature.

## Truth
- Setting stored in localStorage key `mexicano_logs_enabled` (boolean).
- Accessed via `Store.isLogsEnabled()` / `Store.setLogsEnabled(bool)`.
- **Default = enabled (`true`)** when nothing stored — preserves prior behavior.

## Behavior
- **Enabled + admin**: 📝 Logs tab visible in bottom nav; `logRoundResult()` writes
  round entries to localStorage (as before).
- **Disabled**: 📝 Logs tab hidden in bottom nav; `logRoundResult()` is a no-op
  (nothing logged). Existing stored logs are left untouched.
- Non-admin: Logs tab always hidden and nothing logged, regardless of toggle
  (admin gate still applies on top of the toggle).

## UI
- Settings page → admin-only checkbox "Enable Logs".
- Toggling dispatches `mexicano:user-changed` so the bottom nav re-renders live.

## Acceptance (input => expected)
- No stored value => `Store.isLogsEnabled()` === `false`.
- `setLogsEnabled(false)` => `isLogsEnabled()` === `false` (persisted).
- `setLogsEnabled(true)` => `isLogsEnabled()` === `true`.
- admin + enabled => nav has `.nav-item[data-path="/logs"]`.
- admin + disabled => nav has NO `/logs` item.
- admin + disabled => `logRoundResult(t, r)` leaves `getRoundLog()` empty.
- admin + enabled => `logRoundResult(t, r)` adds 1 entry to `getRoundLog()`.
