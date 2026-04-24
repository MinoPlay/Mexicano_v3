const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// ─── Local data config (gitignored) ───
let LOCAL_DATA_PATH = null;
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'local-config.json'), 'utf8'));
  if (cfg.dataPath && fs.existsSync(cfg.dataPath)) {
    LOCAL_DATA_PATH = cfg.dataPath;
    console.log(`Local data path: ${LOCAL_DATA_PATH}`);
  }
} catch { /* no local config — that's fine */ }

// ─── Local dev secrets (gitignored) ───
const DEFAULT_GH_CONFIG = {
  owner: 'MinoPlay',
  repo: 'DataHub',
  basePath: 'mexicano_v3/backup-data',
};
let LOCAL_DEV_CONFIG = null;
try {
  const secrets = JSON.parse(fs.readFileSync(path.join(ROOT, 'local-secrets.json'), 'utf8'));
  if (secrets.pat) {
    LOCAL_DEV_CONFIG = { ...DEFAULT_GH_CONFIG, ...secrets };
    console.log('Local secrets loaded (PAT present)');
  }
} catch { /* no local-secrets.json — that's fine */ }

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const stream = fs.createReadStream(filePath);
  stream.on('open', () => {
    res.writeHead(200, { 'Content-Type': contentType });
    stream.pipe(res);
  });
  stream.on('error', () => {
    // File not readable — fall back to index.html
    serveIndex(res);
  });
}

function serveIndex(res) {
  const indexPath = path.join(ROOT, 'index.html');
  const stream = fs.createReadStream(indexPath);
  stream.on('open', () => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    stream.pipe(res);
  });
  stream.on('error', () => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  });
}

// ─── Local data helpers ───

function serveLocalFile(res, filePath) {
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

function serveLocalMatches(res) {
  const allMatches = [];

  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(full);
      } else if (entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) {
        try {
          const content = JSON.parse(fs.readFileSync(full, 'utf8'));
          if (content.matches && Array.isArray(content.matches)) {
            for (const m of content.matches) {
              allMatches.push({
                date: m.Date,
                roundNumber: m.RoundNumber,
                scoreTeam1: m.ScoreTeam1,
                scoreTeam2: m.ScoreTeam2,
                team1Player1Name: m.Team1Player1Name,
                team1Player2Name: m.Team1Player2Name,
                team2Player1Name: m.Team2Player1Name,
                team2Player2Name: m.Team2Player2Name,
              });
            }
          }
        } catch { /* skip malformed files */ }
      }
    }
  }

  try {
    walkDir(LOCAL_DATA_PATH);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(allMatches));
    console.log(`Served ${allMatches.length} local matches`);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // ─── Dev config API (serves local-secrets.json for local GitHub auth) ───
  if (url.pathname === '/api/dev-config') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(LOCAL_DEV_CONFIG || {}));
    return;
  }

  // ─── Local data API ───
  if (url.pathname === '/api/local-data/matches' && LOCAL_DATA_PATH) {
    serveLocalMatches(res);
    return;
  }
  if (url.pathname === '/api/local-data/players' && LOCAL_DATA_PATH) {
    serveLocalFile(res, path.join(LOCAL_DATA_PATH, 'players.json'));
    return;
  }
  if (url.pathname === '/api/local-data/doodle' && LOCAL_DATA_PATH) {
    const yearMonth = url.searchParams.get('yearMonth'); // e.g. "2026-04"
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid yearMonth' }));
      return;
    }
    const year = yearMonth.slice(0, 4);
    const filePath = path.join(LOCAL_DATA_PATH, year, yearMonth, `doodle_${yearMonth}.json`);
    serveLocalFile(res, filePath);
    return;
  }
  if (url.pathname === '/api/local-data/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ available: !!LOCAL_DATA_PATH }));
    return;
  }

  // CORS preflight for write endpoint
  if (req.method === 'OPTIONS' && url.pathname === '/api/local-data/write') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/local-data/write' && LOCAL_DATA_PATH) {
    const ALLOWED_PATTERNS = [
      /^\d{4}\/\d{4}-\d{2}\/doodle_\d{4}-\d{2}\.json$/,     // doodle
      /^\d{4}\/\d{4}-\d{2}\/\d{4}-\d{2}-\d{2}\.json$/,       // tournament day
      /^data\/active_tournament\.json$/,                         // active tournament
    ];
    const MAX_BODY = 512 * 1024; // 512 KB

    let body = '';
    let bodySize = 0;
    req.on('data', chunk => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY) {
        req.destroy();
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload too large' }));
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try {
        const { path: relPath, data } = JSON.parse(body);

        if (typeof relPath !== 'string' || !ALLOWED_PATTERNS.some(p => p.test(relPath))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Path not allowed' }));
          return;
        }

        const target = path.resolve(LOCAL_DATA_PATH, relPath);
        const rel = path.relative(LOCAL_DATA_PATH, target);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden' }));
          return;
        }

        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
        console.log(`WRITE ${relPath}`);

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  const sanitized = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, sanitized);

  // Prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    console.log(`${req.method} ${url.pathname} 403`);
    return;
  }

  const finish = (statusCode) => {
    console.log(`${req.method} ${url.pathname} ${statusCode}`);
  };

  // Intercept writeHead to capture status for logging
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = (code, ...args) => {
    res.on('finish', () => finish(code));
    origWriteHead(code, ...args);
  };

  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isFile()) {
      serveFile(res, filePath);
    } else if (!err && stats.isDirectory()) {
      // Try index.html inside the directory
      const dirIndex = path.join(filePath, 'index.html');
      fs.access(dirIndex, fs.constants.R_OK, (e) => {
        if (!e) {
          serveFile(res, dirIndex);
        } else {
          serveIndex(res);
        }
      });
    } else {
      // SPA fallback
      serveIndex(res);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
