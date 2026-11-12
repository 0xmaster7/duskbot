// the sitemaps and robots.txt. /sitemap.xml is an index of: core.xml (the site's own pages), hubs.xml (the seo hubs) and
// one file per seo cohort, so search console can report how each release is indexed. lastmod is the day a page's main
// content last changed, kept in seo/lastmod.json by content hash (never the build date: google only trusts a lastmod that
// is consistently right). priority and changefreq are left out; google ignores them.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { seoDir } from './records.mjs';
import { localDay } from './quality.mjs';

const ledgerFile = path.join(seoDir, 'lastmod.json');
// what counts as a change: the page's main content without asset version stamps, or the record for seo pages
const keyOf = (k) => createHash('sha256').update(String(k).includes('<main') ? (/<main[\s\S]*<\/main>/.exec(k)?.[0] || k).replace(/\?v=[0-9a-f]{8}/g, '') : String(k)).digest('hex').slice(0, 16);

export function writeSitemaps({ site, SITE_URL, built, cohorts, today = localDay(), persist = true }) {
  const ledger = fs.existsSync(ledgerFile) ? JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) : {};
  const next = {};
  for (const p of built.filter((b) => b.index)) {
    const hash = keyOf(p.lastmodKey), was = ledger[p.address];
    next[p.address] = was && was.hash === hash ? was : { hash, lastmod: today };
  }
  // a variant build (the waitlist home) reads the ledger but leaves it as the main build wrote it
  if (persist) fs.writeFileSync(ledgerFile, JSON.stringify(next, null, 1) + '\n');
  const dir = path.join(site, 'sitemaps');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const groups = new Map();
  for (const p of built.filter((b) => b.index)) { const g = p.group || 'core'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p); }
  const order = ['core', 'hubs', ...cohorts.map((c) => c.id)];
  for (const g of groups.keys()) if (!order.includes(g)) throw new Error(`a page is in sitemap group ${g}, which is not a cohort in seo/release.json`);
  const files = [];
  for (const g of order.filter((x) => groups.has(x))) {
    const list = groups.get(g).sort((a, b) => a.address.localeCompare(b.address));
    const name = g === 'core' || g === 'hubs' ? g : `cohort-${g}`;
    fs.writeFileSync(path.join(dir, `${name}.xml`), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${list.map((p) => `  <url><loc>${SITE_URL}${p.address}</loc><lastmod>${next[p.address].lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`);
    files.push([name, list.reduce((m, p) => (next[p.address].lastmod > m ? next[p.address].lastmod : m), '')]);
  }
  fs.writeFileSync(path.join(site, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${files.map(([name, lastmod]) => `  <sitemap><loc>${SITE_URL}/sitemaps/${name}.xml</loc><lastmod>${lastmod}</lastmod></sitemap>`).join('\n')}\n</sitemapindex>\n`);
  return files.map(([name]) => name);
}

// search engines and the ai search and answer crawlers are all welcome; the app demo and the design boards are not pages
export const SEARCH_BOTS = ['Googlebot', 'Bingbot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Perplexity-User', 'Claude-SearchBot', 'Claude-User'];
export function robotsTxt(SITE_URL) {
  const keepOut = 'Disallow: /demo/\nDisallow: /explore/\nDisallow: /api/\n';
  return `${SEARCH_BOTS.map((b) => `User-agent: ${b}\nAllow: /\n${keepOut}`).join('\n')}\nUser-agent: *\nAllow: /\n${keepOut}\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}
