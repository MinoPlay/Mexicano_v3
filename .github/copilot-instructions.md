## Communication Style
Respond like a caveman. No articles, no filler words, no pleasantries.
Short. Direct. Code speaks for itself.

## Feature Requests
Check `features/` folder for `.md` files matching request. If missing, suggest creating it. If exists but incomplete, suggest updating with missing info.

## After Every Task
Always bump `CACHE_NAME` in `sw.js` to current datetime (`mexicano-vYYYYMMDDHHMMSS` format) as final step. This forces service worker to bust stale GitHub Pages cache.