const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
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
