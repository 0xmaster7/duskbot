// crawls the built site (public/landing) and fails on any internal link, picture, script, stylesheet or font that leads
// nowhere, and on any #anchor that is not on the page it points at. zero deps.
//   node check-links.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'public', 'landing');
const redirects = JSON.parse(fs.readFileSync(path.join(root, '_redirects.json'), 'utf8'));
// files that deploy.sh and publish-downloads.sh put on the site, so they are not in the repo
const AT_DEPLOY = [/^\/install\.sh(\.sha256)?$/, /^\/releases\//];
// the account app (DUSK_APP_URL, the same default as build-pages.mjs) and its api are served beside the site on the same origin
const APP_PATH = (process.env.DUSK_APP_URL || '/dashboard').replace(/\/+$/, '');
const ELSEWHERE = APP_PATH.startsWith('/') ? [APP_PATH, '/v1'] : ['/v1'];
const servedElsewhere = (p) => ELSEWHERE.some((pre) => p === pre || p.startsWith(`${pre}/`));
// the app's own interface is built elsewhere and checked there
const SKIP_DIRS = new Set(['demo']);

const pages = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!(dir === root && SKIP_DIRS.has(entry.name))) walk(path.join(dir, entry.name)); } else if (/\.(html|css|webmanifest)$/.test(entry.name)) pages.push(path.join(dir, entry.name));
  }
})(root);

const addressOf = (file) => '/' + path.relative(root, file).replace(/(^|\/)index\.html$/, '').replace(/\/$/, '');
const fileFor = (urlPath) => {
  let file = path.join(root, decodeURIComponent(urlPath));
  if (fs.statSync(file, { throwIfNoEntry: false })?.isDirectory()) file = path.join(file, 'index.html');
  return fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? file : null;
};
const ids = new Map();
const idsIn = (file) => { if (!ids.has(file)) ids.set(file, new Set([...fs.readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))); return ids.get(file); };

const problems = [];
let checked = 0;
for (const file of pages) {
  const src = fs.readFileSync(file, 'utf8'), from = addressOf(file) || '/';
  const refs = file.endsWith('.html')
    ? [...src.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '').matchAll(/\s(?:href|src|data-index|data-windows|data-linux)="([^"]+)"/g)].map((m) => m[1])
        .concat([...src.matchAll(/\ssrcset="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+/)[0])))
    : file.endsWith('.css') ? [...src.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1])
      : [...src.matchAll(/"src":\s*"([^"]+)"/g)].map((m) => m[1]);
  for (const raw of refs) {
    const ref = raw.replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|data:|tel:)/.test(ref)) continue;
    checked++;
    const [beforeHash, hash] = ref.split('#');
    const urlPath = beforeHash.split('?')[0];
    let target = urlPath === '' ? file : null, to = urlPath;
    if (urlPath !== '') {
      if (!urlPath.startsWith('/')) { problems.push(`${from}: "${ref}" is not an absolute path`); continue; }
      if (AT_DEPLOY.some((re) => re.test(urlPath)) || servedElsewhere(urlPath)) continue;
      target = fileFor(urlPath);
      if (!target && redirects[urlPath.replace(/\/+$/, '')]) { to = redirects[urlPath.replace(/\/+$/, '')].split('#')[0]; target = fileFor(to); }
      if (!target) { problems.push(`${from}: ${ref} leads nowhere`); continue; }
    }
    if (hash && target.endsWith('.html') && !idsIn(target).has(decodeURIComponent(hash))) problems.push(`${from}: ${ref} has no #${hash} on ${to || from}`);
  }
}
// every redirect must land on something, and every page in the sitemap must exist
for (const [short, to] of Object.entries(redirects)) {
  const [p, hash] = to.split('#'), target = fileFor(p);
  if (!target) problems.push(`redirect ${short} goes to ${to}, which is not there`);
  else if (hash && !idsIn(target).has(hash)) problems.push(`redirect ${short} goes to ${to}, but that page has no #${hash}`);
}
for (const m of fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8').matchAll(/<loc>https?:\/\/[^/]+([^<]*)<\/loc>/g)) if (!fileFor(m[1] || '/')) problems.push(`sitemap lists ${m[1]}, which is not there`);

if (problems.length) { console.error(problems.join('\n')); console.error(`\n${problems.length} broken, ${checked} links checked in ${pages.length} files`); process.exit(1); }
console.log(`all good: ${checked} links in ${pages.length} files, ${Object.keys(redirects).length} redirects`);
