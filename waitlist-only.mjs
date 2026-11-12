// builds a one-page dusk.bot: the waitlist at /, no header, footer or links to other pages, and only the files it uses.
//   node waitlist-only.mjs <out-dir>     (run node build-pages.mjs first)
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const src = path.join(here, 'public', 'landing');
const out = path.resolve(process.argv[2] || path.join(here, 'public', 'waitlist-only'));

let html = fs.readFileSync(path.join(src, 'waitlist', 'index.html'), 'utf8');
html = html
  .replace(/<a class="skip"[^>]*>[\s\S]*?<\/a>\s*/, '')
  .replace(/<header class="bar">[\s\S]*?<\/header>\s*/, '')
  .replace(/<footer class="foot">[\s\S]*?<\/footer>\s*/, '')
  .replace(/\s*<a class="wl-link" href="\/">[\s\S]*?<\/a>/, '')
  .replace('https://dusk.bot/waitlist', 'https://dusk.bot/')
  .replace('<body>', '<body class="solo">')
  .replace(/data-api="\/v1\/t"/, `data-api="${process.env.DUSK_WAITLIST_TRACK_API || '/v1/t'}"`);
const stray = [...html.matchAll(/href="(\/[^"#]*)"/g)].map((m) => m[1]).filter((h) => !/\.[a-z0-9]{2,12}(\?|$)/i.test(h));
if (stray.length) { console.error('links to other pages remain:', [...new Set(stray)].join(' ')); process.exit(1); }

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);

// every file the page and its stylesheets point at
const want = new Set(['favicon.ico', 'site.webmanifest', 'art/og6/home.jpg', 'art/icon-512.png', 'art/icon-maskable-512.png']);
for (const m of html.matchAll(/(?:href|src|content)="(?:https:\/\/dusk\.bot)?\/([^"?#]+\.[a-z0-9]{2,12})/gi)) want.add(m[1]);
for (const f of [...want].filter((f) => f.endsWith('.css'))) {
  for (const m of fs.readFileSync(path.join(src, f), 'utf8').matchAll(/url\("?\/([^")?#]+)/g)) want.add(m[1]);
}
for (const f of want) {
  const from = path.join(src, f);
  if (!fs.existsSync(from)) { console.error('missing', f); process.exit(1); }
  fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  fs.copyFileSync(from, path.join(out, f));
}
// the email art and fonts that mail clients load from dusk.bot/email
fs.cpSync(path.join(src, 'email'), path.join(out, 'email'), { recursive: true });
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: https://dusk.bot/sitemap.xml\n');
fs.writeFileSync(path.join(out, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://dusk.bot/</loc></url>\n</urlset>\n');
console.log(`waitlist-only site: ${want.size + 3} files in ${out}`);
