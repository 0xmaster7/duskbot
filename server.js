// tiny static server for the dusk.bot placeholder sites. zero deps.
// usage: node server.js <site>   (serves public/<site>/ on process.env.PORT)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = process.argv[2] || 'landing';
if (!/^[a-z0-9-]+$/.test(site)) throw new Error(`bad site name ${site}`);
const root = path.join(here, 'public', site);
if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`no such site: ${root}`);
const port = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.sha256': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function resolveFile(urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch { return null; }
  // a name that starts with _ is the build's note to this server (the redirects), not something to serve
  if (rel.includes('\0') || rel === '/_redirects.json') return null;
  let file = path.join(root, path.normalize(rel));
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  const st = fs.statSync(file, { throwIfNoEntry: false });
  if (st?.isDirectory()) file = path.join(file, 'index.html');
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? file : null;
}

// short and old addresses the build listed in _redirects.json, each with the page that answers it; read again when it changes
let redirects = { at: 0, map: {} };
function redirectFor(urlPath) {
  const file = path.join(root, '_redirects.json'), at = fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs || 0;
  if (at !== redirects.at) { try { redirects = { at, map: at ? JSON.parse(fs.readFileSync(file, 'utf8')) : {} }; } catch { redirects = { at, map: {} }; } }
  const key = urlPath.length > 1 ? urlPath.replace(/\/+$/, '').toLowerCase() : urlPath;
  return Object.hasOwn(redirects.map, key) ? redirects.map[key] : null;
}

// text is gzipped once per file version and kept in memory
const zips = new Map();
function zipped(file, body) {
  const key = `${file}:${fs.statSync(file).mtimeMs}`;
  if (!zips.has(key)) zips.set(key, zlib.gzipSync(body, { level: 9 }));
  return zips.get(key);
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // /demo/ is the app's own interface running on canned data; the home page shows it in a frame, and its
  // code highlighter writes style attributes
  const demo = (req.url || '').startsWith('/demo/');
  res.setHeader('Content-Security-Policy', demo
    ? "default-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; object-src 'none'"
    : "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'");
  res.setHeader('X-Frame-Options', demo ? 'SAMEORIGIN' : 'DENY');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('method not allowed\n');
  }
  const urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end('ok\n');
  }
  let file = resolveFile(urlPath), status = 200;
  // a page has one address, without the slash at its end (the demo keeps its own: its files sit beside it)
  if (file && urlPath.length > 1 && urlPath.endsWith('/') && !demo && file.endsWith('index.html')) {
    res.writeHead(308, { Location: urlPath.replace(/\/+$/, '') + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''), 'Cache-Control': 'public, max-age=300' });
    return res.end();
  }
  if (!file) {
    const to = redirectFor(urlPath);
    if (to) { res.writeHead(308, { Location: to, 'Cache-Control': 'public, max-age=300' }); return res.end(); }
    // a page that is not there gets the site's own not-found page; a missing file gets a plain answer
    file = /\.[a-z0-9]{1,5}$/i.test(urlPath) ? null : resolveFile('/404.html');
    status = 404;
    if (!file) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found\n');
    }
  }
  let body = fs.readFileSync(file);
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const headers = {
    'Content-Type': type,
    // the installer, its checksum and the update manifest must never be served stale after a refresh; a url
    // stamped with its content hash never changes, so it can be kept for good
    'Cache-Control': status === 404 ? 'no-store' : /\.(sh|sha256|json)$/.test(file) ? 'no-cache' : /[?&]v=[0-9a-f]{8}\b/.test(req.url || '') ? 'public, max-age=31536000, immutable' : /\.woff2$/.test(file) ? 'public, max-age=86400' : 'public, max-age=300',
  };
  if (/^text\/|svg|json/.test(type) && body.length > 1024) {
    headers.Vary = 'Accept-Encoding';
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) { body = zipped(file, body); headers['Content-Encoding'] = 'gzip'; }
  }
  headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.listen(port, '127.0.0.1', () => console.log(`dusk ${site} on 127.0.0.1:${port}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
