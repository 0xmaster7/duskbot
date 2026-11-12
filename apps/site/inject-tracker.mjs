// puts the site's analytics tag (a.js, see build-pages.mjs) into the app demo at public/landing/demo/index.html, which
// is built from the dusk bot repo (apps/site-demo) and has no tag of its own. safe to run twice.
//   node inject-tracker.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const here = path.dirname(new URL(import.meta.url).pathname);
const site = path.join(here, 'public', 'landing'), demo = path.join(site, 'demo', 'index.html'), tracker = path.join(site, 'a.js');
if (fs.existsSync(demo) && fs.existsSync(tracker)) {
  let html = fs.readFileSync(demo, 'utf8');
  const tag = `<script src="/a.js?v=${createHash('sha256').update(fs.readFileSync(tracker)).digest('hex').slice(0, 8)}" data-api="${process.env.DUSK_TRACK_API || '/v1/t'}" defer></script>`;
  html = html.replace(/<script src="\/a\.js[^"]*"[^>]*><\/script>\s*/g, '');
  if (html.includes('</body>')) { fs.writeFileSync(demo, html.replace('</body>', `${tag}\n</body>`)); console.log('demo: analytics tag added'); }
}
