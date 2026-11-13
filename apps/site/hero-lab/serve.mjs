// preview server for the hero lab: /lab/* is this folder, everything else is the built site (public/landing)
//   node apps/site/hero-lab/serve.mjs [port, default 7481]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname), land = path.join(here, '..', 'public', 'landing');
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = u.startsWith('/lab/') ? path.join(here, u.slice(5)) : path.join(land, u);
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); r.end(b); });
}).listen(Number(process.argv[2]) || 7481, '127.0.0.1');
