// builds the dusk.bot pages: wraps each page body in the shared layout, turns the legal drafts (Markdown in the Dusk Bot
// repo's docs/legal) into terms/, privacy/, license/ and security/, the docs (pages/docs/*.md, see build-docs.mjs) into
// docs/, pages/changelog.md into changelog/, and writes the sitemap, robots.txt, the manifest and the redirects. zero deps.
//   node sites/dusk/build-pages.mjs [path to the Dusk Bot checkout]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DuskPixel, CROWD, COLOURS, bodyName, colourName } from './mascot-src/pixel/crowd.js';
import { buildDocs } from './build-docs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, 'public', 'landing');
const repo = process.argv[2] || path.join(process.env.HOME, 'Desktop/code/OpenMausBot');
// every link to the account web app goes through APP_URL, and every absolute address of this site through SITE_URL.
// DUSK_APP_URL is a path on this origin (default /app, where preview.dusk.bot serves the app) or a full address
export const APP_URL = (process.env.DUSK_APP_URL || '/app').replace(/\/+$/, '');
export const SITE_URL = (process.env.SITE_URL || 'https://dusk.bot').replace(/\/+$/, '');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*|#[^)\s]+|mailto:[^)\s]+|\{\{(?:app|site)[^}]*\}\})\)/g, '<a href="$2">$1</a>');
  // one legal draft pointing at another by file name is a page here
  s = s.replace(/\[([^\]]+)\]\((terms|privacy|license|security)\.md\)/g, '<a href="/$2">$1</a>');
  // a link into the app's own repository has nowhere to go on the site, so only its words stay
  s = s.replace(/\[([^\]]+)\]\(\.\.?\/[^)\s]*\)/g, '$1');
  s = s.replace(/(^|[\s(])((?:hello|privacy|security)@dusk\.bot)/g, '$1<a href="mailto:$2">$2</a>');
  // [[⌘ K]] is a key combination, one cap per word
  s = s.replace(/\[\[((?:[^\]]|\](?=\]\]))+)\]\]/g, (_, keys) => `<span class="keys">${keys.trim().split(/\s+/).map((k) => `<kbd>${k}</kbd>`).join('')}</span>`);
  return s;
}

export const slug = (text) => text.toLowerCase().replace(/<[^>]+>|&\w+;|`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// markdown for the legal drafts, the docs and the changelog. besides the usual: a fenced block becomes a copyable command,
// a line that starts with < or {{ passes through as html (so a page can drop in a piece of the app or a macro), and
// "> note:" / "> careful:" quotes become callouts
export function markdown(md) {
  const out = [], lines = md.replace(/\r\n/g, '\n').split('\n'), seen = new Map();
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      const level = m[1].length;
      let id = slug(m[2]);
      const n = seen.get(id) || 0; seen.set(id, n + 1); if (n) id += `-${n + 1}`;
      out.push(`<h${level} id="${id}">${inline(m[2])}</h${level}>`); i++; continue;
    }
    if ((m = /^```(\w*)\s*$/.exec(line))) {
      const body = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      const plain = m[1] === 'text';
      out.push(`<div class="code${plain ? ' plain' : ''}"><pre><code>${esc(body.join('\n'))}</code></pre>${plain ? '' : '<button class="copy" type="button" data-copy>copy</button>'}</div>`); continue;
    }
    if (/^(<|\{\{)/.test(line)) {
      const body = []; while (i < lines.length && lines[i].trim()) body.push(lines[i++]);
      out.push(body.join('\n')); continue;
    }
    if (/^---+\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (line.startsWith('>')) {
      const body = []; while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^>\s?/, ''));
      const text = body.join(' '), kind = /^(note|tip|careful):\s*/i.exec(text);
      out.push(kind ? `<p class="callout ${kind[1].toLowerCase()}">${inline(text.slice(kind[0].length))}</p>` : `<blockquote>${inline(text)}</blockquote>`); continue;
    }
    if (line.startsWith('|')) {
      const rows = []; while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push(`<div class="table"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line), items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''), blocks = '';
        // an indented line carries on the item; an indented fenced block is a command inside the step
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
          if (/^\s+```/.test(lines[i])) {
            const body = []; i++;
            while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++].replace(/^\s{2,4}/, ''));
            i++;
            blocks += `<div class="code"><pre><code>${esc(body.join('\n'))}</code></pre><button class="copy" type="button" data-copy>copy</button></div>`;
          } else item += ' ' + lines[i++].trim();
        }
        items.push(`<li>${inline(item)}${blocks}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`); continue;
    }
    const para = []; while (i < lines.length && lines[i].trim() && !/^(#|>|\||```|\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

// {{bot name colour extra-classes}} in a page becomes one of the pixel bots (mascot-src/pixel) in its rest frame, so
// without script every bot still shows; mascot.js brings it to life. name is a pixel bot (pip, kit, boxo ...) or one of
// the older shapes (circle hex heart ...), colour an electric colour (blue, violet, tangerine ...) or an older name.
// the bot's 16 or 20 pixel grid fills the middle 80 of a 100 box, feet on 90
const rested = new Map();
export function pixelBot(name) {
  if (!rested.has(name)) {
    const r = DuskPixel.rest(name);
    rested.set(name, `<g class="px" transform="translate(10 10) scale(${80 / r.G})"><path class="px-b" fill="currentColor" d="${r.body}"/><path class="px-e" fill="#fff" d="${r.eyes}"/></g>`);
  }
  return rested.get(name);
}
export function bot(shape, colour, extra = '') {
  const body = bodyName(shape);
  return `<svg class="bot c-${colourName(colour)}${extra ? ' ' + extra : ''}" viewBox="0 0 100 100" shape-rendering="crispEdges" aria-hidden="true" data-px="${body}">${pixelBot(body)}</svg>`;
}
const CHIP_NAMES = { calendar: 'google calendar', drive: 'google drive', docs: 'google docs', sheets: 'google sheets' };
const logo = (name, eager) => `<img class="logo" src="/art/logos/${name}.${fs.existsSync(path.join(site, 'art', 'logos', `${name}.svg`)) ? 'svg' : 'png'}" alt="" width="20" height="20"${eager ? '' : ' loading="lazy"'} decoding="async">`;
// {{logo name}} is one mark, lazy unless written {{logo name eager}} (the sliding tape, where lazy marks arrive blank);
// {{chips a b c}} is a run of connector chips, each a logo and a name
const withChips = (html) => html.replace(/\{\{logo (\w+)( eager)?\}\}/g, (_, name, eager) => logo(name, eager)).replace(/\{\{chips ([\w ]+)\}\}/g, (_, names) => names.split(' ').map((n) => `<span class="chip">${logo(n)}${CHIP_NAMES[n] ?? n}</span>`).join(''));
// {{include name}} drops in pages/partials/name.html, so a big piece of a page can live in its own file
const withParts = (html) => html.replace(/\{\{include ([\w-]+)\}\}/g, (_, name) => { const file = path.join(here, 'pages', 'partials', `${name}.html`); return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; });
const has = (file) => fs.existsSync(path.join(site, file));
// the first-party analytics tracker (apps/dashboard/tracker/dusk.js in the Dusk Bot repo), served as /a.js; its beacons go to
// DUSK_TRACK_API (default /v1/t, the account service on this origin). Visits of signed-in admins are never counted.
export const TRACK_API = process.env.DUSK_TRACK_API || '/v1/t';
const tracker = path.join(repo, 'apps', 'dashboard', 'tracker', 'dusk.js');
if (fs.existsSync(tracker)) fs.copyFileSync(tracker, path.join(site, 'a.js'));
else console.warn('no tracker in the Dusk Bot checkout; pages are built without analytics');
const trackerTag = () => has('a.js') ? `<script src="${stamped('a.js')}" data-api="${TRACK_API}" defer></script>\n` : '';
// {{i name}} is a Gravity UI icon (MIT, icons/gravity, LICENSE beside them) or one of ours drawn in its style
// (icons/drawn); {{i name cls}} adds a class. Site names stay as they were, each pointing at its drawing.
const ICON_FILES = {
  check: 'gravity/check', minus: 'gravity/minus', plus: 'gravity/plus', 'arrow-right': 'gravity/arrow-right', 'arrow-left': 'gravity/arrow-left',
  'chevron-down': 'gravity/chevron-down', 'chevron-right': 'gravity/chevron-right', pencil: 'gravity/pencil', 'hard-drive': 'gravity/hard-drive',
  folder: 'gravity/folder', cloud: 'gravity/cloud', 'book-open': 'gravity/book-open', 'circle-question-mark': 'gravity/circle-question',
  clock: 'gravity/clock', copy: 'gravity/copy', 'corner-down-left': 'drawn/corner-down-left', 'credit-card': 'gravity/credit-card',
  download: 'gravity/arrow-down-to-line', 'external-link': 'gravity/arrow-up-right-from-square', 'file-text': 'gravity/file-text',
  globe: 'gravity/globe', hand: 'gravity/hand', house: 'gravity/house', info: 'gravity/circle-info', 'key-round': 'gravity/key',
  keyboard: 'gravity/keyboard', 'life-buoy': 'gravity/life-ring', lock: 'gravity/lock', mail: 'gravity/envelope', map: 'drawn/map',
  menu: 'gravity/bars', 'message-circle': 'gravity/comment', monitor: 'gravity/display', 'mouse-pointer-2': 'drawn/mouse-pointer',
  palette: 'gravity/palette', plug: 'gravity/plug-connection', rocket: 'gravity/rocket', search: 'gravity/magnifier', server: 'gravity/server',
  shield: 'gravity/shield', smartphone: 'gravity/smartphone', 'triangle-alert': 'gravity/triangle-exclamation', users: 'gravity/persons',
  wrench: 'gravity/wrench', x: 'gravity/xmark',
};
// a few gravity files clip to their own 16 box through id="a"; the clip changes nothing and the id repeats on a page
const ICONS = Object.fromEntries(Object.entries(ICON_FILES).map(([name, file]) => [name, fs.readFileSync(path.join(here, 'icons', `${file}.svg`), 'utf8')
  .replace(/^[^]*?<svg[^>]*>|<\/svg>\s*$/g, '').replace(/<defs>[^]*?<\/defs>/g, '').replace(/<g clip-path="url\(#a\)">([^]*?)<\/g>/g, '$1')]));
const icon = (name, cls = '') => { if (!ICONS[name]) throw new Error(`no icon named ${name}`); return `<svg class="i${cls ? ' ' + cls : ''}" viewBox="-0.5 -0.5 17 17" fill="none" aria-hidden="true">${ICONS[name]}</svg>`; };
// {{sea}} is the bots in the last picture, drawn in the picture's own 1600 by 1067 space so they sit on its water at any
// width, each half under the waterline
function sea() {
  // far ones are small and sit higher on the water, near ones are bigger and lower; none on the sand or on a boat
  // the whole pixel crowd is out swimming, kit nearest the middle
  const swim = [
    ['pip', 'pink', 300, 770, 26], ['drip', 'emerald', 560, 752, 24], ['boxo', 'violet', 820, 782, 28], ['loaf', 'sun', 1290, 762, 26],
    ['puff', 'blue', 1400, 800, 30], ['hearty', 'tangerine', 680, 822, 30], ['starry', 'sun', 210, 830, 32],
    ['bruin', 'blue', 236, 884, 44], ['cheep', 'sun', 480, 900, 46], ['hoot', 'tangerine', 748, 880, 40], ['kit', 'violet', 900, 916, 46],
    ['hearty', 'pink', 1230, 902, 42], ['ribbit', 'lime', 1372, 884, 38], ['sprout', 'emerald', 1060, 930, 40],
    ['mochi', 'pink', 360, 800, 28], ['egg', 'mint', 620, 870, 32],
    ['tofu', 'pink', 100, 930, 40], ['goo', 'cyan', 800, 940, 44], ['wisp', 'coral', 1300, 940, 40], ['hop', 'sky', 1500, 925, 38]];
  const bots = swim.map(([shape, colour, x, y, size]) => `<g class="sb c-${colourName(colour)}" transform="translate(${x} ${y}) scale(${size / 100})" clip-path="url(#sea-line)" data-px="${bodyName(shape)}" data-size="${size}"><g class="dip"><g transform="translate(0 -6)">${pixelBot(bodyName(shape))}</g></g><rect class="foam" x="-14" y="64" width="128" height="8"/></g>`);
  return `<svg class="sea-bots" viewBox="0 0 1600 1067" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><defs><clipPath id="sea-line"><rect x="-30" y="-120" width="160" height="192"/></clipPath></defs>${bots.join('')}</svg>`;
}
// {{os name}} is a platform mark from public/landing/art/os, inlined. apple is simple-icons (cc0) and takes the text colour,
// as its official mark is single colour; windows, linux and android are gilbarbara/logos (cc0) and keep their own fills.
// ids get a per-use suffix so two copies of tux on one page do not share gradients
const monoOs = new Set(['apple']);
let osUses = 0;
const os = (name) => {
  const n = ++osUses;
  const svg = fs.readFileSync(path.join(site, 'art', 'os', `${name}.svg`), 'utf8').replace(/<title>.*?<\/title>/, '')
    .replace(/ role="img"| xmlns(:xlink)?="[^"]*"/g, '').replace(/(id="|url\(#|href="#)([\w-]+)/g, `$1$2-o${n}`).trim();
  return svg.replace(/<svg ?/, `<svg class="os" aria-hidden="true" focusable="false"${monoOs.has(name) ? ' fill="currentColor"' : ''} `);
};
const withOs = (html) => html.replace(/\{\{os (\w+)\}\}/g, (_, name) => os(name));
const withBots = (html) => (withOs(withChips(withParts(html))).replace(/\{\{bot (\w+) (\w+)((?: [\w-]+)*)\}\}/g, (_, shape, colour, extra) => bot(shape, colour, extra.trim()))
  .replace(/\{\{i ([\w-]+)(?: ([\w-]+))?\}\}/g, (_, name, cls) => icon(name, cls)).replace(/\{\{sea\}\}/g, sea));

// stamps a file's content hash on its url, so an edit is seen at once despite the cache header
// a file that is not there yet is left unstamped (and named in the log) rather than failing the whole build
const stamped = (file) => {
  const full = path.join(site, file);
  if (!fs.existsSync(full)) { console.warn(`missing ${file}`); return `/${file}`; }
  return `/${file}?v=${createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 8)}`;
};

// {{app}} and {{app /billing}} are addresses in the account web app; {{site /docs}} is an absolute address of this site
const withLinks = (html) => html.replace(/\{\{app( \/[\w\/?=&-]*)?\}\}/g, (_, rest) => APP_URL + (rest ? rest.trim() : '/')).replace(/\{\{site( \/[\w\/.-]*)?\}\}/g, (_, rest) => SITE_URL + (rest ? rest.trim() : ''));

// what can be downloaded today. releases.json names the files; a release is out once publish-downloads.sh has put
// releases/latest.json on the site (or releases.json says "released": true). DUSK_RELEASED=1 or 0 forces either state,
// to look at the page both ways. {{#released}}…{{/released}} and {{^released}}…{{/released}} keep one of two pieces,
// {{dl key}} is a file's address, {{version}} and {{released-on}} describe the release
const rel = JSON.parse(fs.readFileSync(path.join(here, 'releases.json'), 'utf8'));
const latestFile = path.join(site, 'releases', 'latest.json');
let latest = {};
try { latest = JSON.parse(fs.readFileSync(latestFile, 'utf8')); } catch {}
const forced = process.env.DUSK_RELEASED;
export const release = {
  ...rel,
  released: forced === '1' ? true : forced === '0' ? false : rel.released === true || typeof latest.version === 'string',
  version: latest.version || rel.version || '',
  date: rel.date || '',
};
release.sums = release.version && fs.existsSync(path.join(site, 'releases', release.version, 'SHA256SUMS')) ? `/releases/${release.version}/SHA256SUMS` : `${rel.base}${rel.checksums}`;
const withRelease = (html) => {
  // pieces can sit inside each other, so this runs until nothing is left to decide
  for (let before; before !== html;) { before = html; html = html.replace(/\{\{([#^])([\w]+)\}\}((?:(?!\{\{[#^])[\s\S])*?)\{\{\/\2\}\}/g, (_, mark, key, inner) => (Boolean(release[key]) === (mark === '#') ? inner : '')); }
  return html.replace(/\{\{dl ([\w-]+)\}\}/g, (_, key) => { if (!rel.files[key]) throw new Error(`releases.json has no file ${key}`); return rel.base + rel.files[key]; })
    .replace(/\{\{file ([\w-]+)\}\}/g, (_, key) => rel.files[key]).replace(/\{\{(ios|android)-link\}\}/g, (_, key) => rel[key])
    .replace(/\{\{version\}\}/g, release.version).replace(/\{\{released-on\}\}/g, release.date).replace(/\{\{sums\}\}/g, release.sums);
};
// {{crew}} on the brand page is the twenty pixel bots, kit first, each in its own colour with its name and a link to its svg
const CREW = [...CROWD.filter(([name]) => name === 'kit'), ...CROWD.filter(([name]) => name !== 'kit')].map(([name, colour]) => [name, colour]);
function crewList() { return `<ul class="crew">${CREW.map(([name, colour]) => `<li>{{bot ${name} ${colour}}}<span>${name}</span><a class="get" href="/brand/bots/${name}.svg" download>{{i download}}svg<span class="vh"> of ${name}</span></a></li>`).join('')}</ul>`; }
// partials first, so a partial may use {{app}} and the other link macros too
export const macros = (html) => withBots(withLinks(withRelease(withParts(html).replace(/\{\{crew\}\}/g, () => crewList()))));

// the nav, and every page in the footer
const NAV = [['/download', 'download'], ['/docs', 'docs'], ['/pricing', 'pricing']];
const MENU = [...NAV, ['/changelog', "what's new"], ['/about', 'about'], ['/contact', 'contact']];
const FOOT = [
  ['product', [['/download', 'download'], ['/pricing', 'pricing'], ['/changelog', "what's new"], ['/waitlist', 'join the waitlist'], [`${APP_URL}/`, 'sign in']]],
  ['learn', [['/docs', 'docs'], ['/docs/getting-started', 'get started'], ['/docs/your-own-server', 'your own server'], ['/docs/faq', 'questions']]],
  ['dusk bot', [['/about', 'about'], ['/contact', 'contact'], ['/brand', 'brand'], ['/security', 'security']]],
  ['legal', [['/terms', 'terms'], ['/privacy', 'privacy'], ['/license', 'license']]],
];
const OG = { home: 'og-home.jpg' };
const ogImage = (name) => `${SITE_URL}/art/${OG[name] || (has(`art/og-${name}.jpg`) ? `og-${name}.jpg` : 'og.jpg')}`;
const ld = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

// page: its name (home, download, docs ...); at: its address on the site; section: the nav item it sits under;
// kind: extra classes on <main>; scripts, styles: more files after the shared ones; jsonld: structured data for search engines
export function layout({ title, description, body, page, at, section = page, og = section, kind = '', scripts = [], styles = [], jsonld = [], noindex = false }) {
  const home = page === 'home';
  const address = at ?? (home ? '/' : `/${page}`);
  const here_ = (href) => (href === address ? ' aria-current="page"' : href === `/${section}` ? ' class="is-here"' : '');
  const links = (list) => list.map(([href, label]) => `<a href="${href}"${here_(href)}>${label}</a>`).join('');
  const foot = ([head, list]) => `<div><h2>${head}</h2>${list.map(([href, label]) => `<a href="${href}"${href === address ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</div>`;
  const brand = '<a class="brand" href="/"><img src="/art/logo-96.webp" alt="" width="28" height="28">dusk bot</a>';
  const css = home ? ['site.css', 'motion-kit-v2.css', 'home.css', ...(has('app-demo.css') ? ['app-demo.css'] : [])] : ['site.css', 'pages.css', ...styles.filter(has)];
  const tail = home
    ? `<script src="${stamped('motion.min.js')}"></script>\n${has('mascot.js') ? `<script src="${stamped('mascot.js')}" defer></script>\n` : ''}<script src="${stamped('motion-kit-v2.js')}"></script>\n<script src="${stamped('home.js')}"></script>${has('app-demo.js') ? `\n<script src="${stamped('app-demo.js')}"></script>` : ''}\n<script src="${stamped('site.js')}" defer></script>`
    : ['mascot.js', 'site.js', 'pages.js', ...scripts].filter(has).map((file) => `<script src="${stamped(file)}" defer></script>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#ffffff">${noindex ? '\n<meta name="robots" content="noindex">' : `\n<link rel="canonical" href="${SITE_URL}${address === '/' ? '/' : address}">`}
<meta property="og:site_name" content="Dusk Bot">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE_URL}${address}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${ogImage(og)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogImage(og)}">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="${stamped('art/icon-192.png')}" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="${stamped('art/apple-touch-icon.png')}">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/fonts/general-sans.woff2" as="font" type="font/woff2" crossorigin>
${css.map((file) => `<link rel="stylesheet" href="${stamped(file)}">`).join('\n')}${jsonld.map((data) => `\n${ld(data)}`).join('')}
</head>
<body${home ? ' class="is-home"' : ''}>
<a class="skip" href="#main">skip to the page</a>
<header class="bar">${brand}<nav aria-label="main">${links(NAV)}<a class="cta" href="${APP_URL}/">sign in</a></nav><details class="menu"><summary><span class="vh">menu</span>${icon('menu')}${icon('x')}</summary><nav aria-label="every page">${links(MENU)}<a class="cta" href="${APP_URL}/">sign in</a></nav></details></header>
<main id="main" class="${home ? 'home' : `inner${kind ? ' ' + kind : ''}`}">
${macros(body).replace(/(src=")\/(art\/[\w./-]+)"/g, (_, lead, file) => `${lead}${stamped(file)}"`)}
</main>
<footer class="foot">
<div class="foot-in">
<div class="foot-brand">${brand}<p>a team of ai bots that runs where you want it to.</p><a class="foot-mail" href="mailto:hello@dusk.bot">hello@dusk.bot</a></div>
${FOOT.map(foot).join('\n')}
</div>
<p class="foot-fine"><span data-dusk>made at dusk. the bots did most of it.</span>${home ? ' the bots, chats and numbers shown on this page are samples.' : ''}</p>
</footer>
${trackerTag()}${tail}
</body>
</html>
`;
}

// every page that is written, for the sitemap and the log
const built = [];
function write(address, html, { index = true } = {}) {
  const file = address === '/' ? path.join(site, 'index.html') : address.endsWith('.html') ? path.join(site, address) : path.join(site, address, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
  built.push({ address, index });
}
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
// the questions on a page, as schema.org wants them: from <details><summary>q</summary>…a…</details>
const faqLd = (html) => {
  const qs = [...html.matchAll(/<details[^>]*><summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map((m) => ({ '@type': 'Question', name: text(m[1]), acceptedAnswer: { '@type': 'Answer', text: text(m[2]) } }));
  return qs.length ? [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: qs }] : [];
};
const appLd = {
  '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'Dusk Bot', url: `${SITE_URL}/`, image: `${SITE_URL}/art/og.jpg`,
  applicationCategory: 'ProductivityApplication', operatingSystem: 'macOS, Windows, Linux',
  description: 'A desktop app where you run a team of AI bots and message them like teammates. It runs on your computer, your own server or a Dusk cloud computer, on the AI accounts you already have.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};

// {{strip name | shape colour, shape colour ...}} is a band of one of the pixel pictures (art/strip-name.webp), torn at both
// edges, with a few bots standing in it. where each stands is in pages.css (.ph-name .b1 ...), in the picture's own space
export const strip = (name, crew = '', more = '') => `<div class="strip ph-${name}${more ? ' ' + more : ''}"><div class="ph-art"><img src="/art/strip-${name}.webp" alt="" width="1536" height="640" fetchpriority="high">${crew.split(',').map((b) => b.trim()).filter(Boolean).map((b, i) => `<span class="pb b${i + 1}">{{bot ${b}}}</span>`).join('')}</div><i class="cl c1"></i><i class="cl c2"></i></div>`;
const withStrips = (html) => html.replace(/\{\{strip ([\w-]+)(?: \| ([^}]+))?\}\}/g, (_, name, crew) => strip(name, crew));

const pages = JSON.parse(fs.readFileSync(path.join(here, 'pages.json'), 'utf8'));
for (const page of pages) {
  const body = withStrips(fs.readFileSync(path.join(here, 'pages', `${page.name}.html`), 'utf8'));
  const at = page.name === 'home' ? '/' : page.name === '404' ? '/404.html' : `/${page.name}`;
  const jsonld = page.name === 'home' ? [appLd, ...faqLd(macros(body))] : faqLd(macros(body));
  write(at, layout({ ...page, page: page.name, at, kind: page.kind || `p-${page.name}`, body, jsonld, noindex: page.name === '404' }), { index: page.name !== '404' });
}

// the changelog is one markdown file: a "## version · date" heading per release, newest first, then a list
{
  const md = fs.readFileSync(path.join(here, 'pages', 'changelog.md'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const entries = md.split(/^## /m).slice(1).map((chunk) => {
    const [head, ...rest] = chunk.split('\n');
    const [version, date = ''] = head.split('·').map((s) => s.trim());
    return `<article class="rel" id="v${slug(version)}"><header><h2>${esc(version)}</h2>${date ? `<time datetime="${esc(date)}">${esc(new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).toLowerCase())}</time>` : ''}</header><div class="prose">${markdown(rest.join('\n').replace(/^### /gm, '#### '))}</div></article>`;
  });
  const shell = withStrips(fs.readFileSync(path.join(here, 'pages', 'partials', 'changelog-shell.html'), 'utf8'));
  const body = shell.replace('{{entries}}', entries.join('\n')).replace(/\{\{([#^])entries\}\}([\s\S]*?)\{\{\/entries\}\}/g, (_, mark, inner) => ((entries.length > 0) === (mark === '#') ? inner : ''));
  write('/changelog', layout({ title: "What's new · Dusk Bot", description: 'Every Dusk Bot release, newest first: what changed and what got fixed.', page: 'changelog', kind: 'p-changelog', body }));
}

// the legal drafts, each with a list of its sections beside it
const legal = [['terms', 'Terms of Service', 'terms'], ['privacy', 'Privacy Policy', 'privacy'], ['license', 'License', 'license'], ['security', 'Security', 'security']];
for (const [name, title, short] of legal) {
  // the drafts name a person as copyright holder; the site shows a placeholder until the company name is set
  const html = markdown(fs.readFileSync(path.join(repo, 'docs', 'legal', `${name}.md`), 'utf8').replace(/Copyright (\d{4}) [^.\n]+\./g, 'Copyright $1 [copyright holder].'));
  const toc = [...html.matchAll(/<h2 id="([^"]+)">([\s\S]*?)<\/h2>/g)].map((m) => `<li><a href="#${m[1]}">${m[2]}</a></li>`).join('');
  const others = legal.map(([n, , s]) => `<a href="/${n}"${n === name ? ' aria-current="page"' : ''}>${s}</a>`).join('');
  write(`/${name}`, layout({ title: `${title} · Dusk Bot`, description: `Dusk Bot ${title.toLowerCase()}.`, page: name, section: 'legal', og: 'legal', kind: 'p-legal',
    body: `<header class="phead wrap"><h1>${title.toLowerCase()}</h1></header>
${strip('layers', 'circle blue, hex orange', 'short')}
<div class="legal-wrap wrap">
<aside class="legal-side"><nav class="legal-tabs" aria-label="legal pages">${others}</nav><nav class="toc" aria-label="on this page"><h2>on this page</h2><ol>${toc}</ol></nav></aside>
<article class="legal prose">\n${html}\n</article>
</div>` }));
}

// the brand page's downloads: each bot as a plain svg file in its own colour; the smooth bots' files go
const bots_ = path.join(site, 'brand', 'bots');
fs.rmSync(bots_, { recursive: true, force: true });
fs.mkdirSync(bots_, { recursive: true });
for (const [name, colour] of CREW) fs.writeFileSync(path.join(bots_, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="400" height="400" shape-rendering="crispEdges">${pixelBot(name).replace('currentColor', COLOURS[colour])}</svg>\n`);
// kit as it stands in for the logo: white, with the logo's dark eyes
fs.writeFileSync(path.join(bots_, 'kit-white.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="400" height="400" shape-rendering="crispEdges">${pixelBot('kit').replace('fill="#fff" d', 'fill="#212121" d').replace('currentColor', '#fff')}</svg>\n`);

const docs = buildDocs({ here, site, markdown, layout, macros, strip, slug, text, write, esc, icon });

// the rest of what a site answers: where robots may go, every page, the installable-app manifest, and the short addresses
fs.writeFileSync(path.join(site, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /demo/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
fs.writeFileSync(path.join(site, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${built.filter((p) => p.index).map((p) => `  <url><loc>${SITE_URL}${p.address}</loc></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(site, 'site.webmanifest'), JSON.stringify({
  name: 'Dusk Bot', short_name: 'Dusk Bot', description: 'Your own team of AI bots, in a chat app.', start_url: '/', display: 'browser', background_color: '#ffffff', theme_color: '#ffffff',
  icons: [{ src: '/art/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/art/icon-512.png', sizes: '512x512', type: 'image/png' }, { src: '/art/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }],
}, null, 2) + '\n');
// server.js reads this: short and old addresses, each sent on to the page that answers it
const redirects = JSON.parse(fs.readFileSync(path.join(here, 'redirects.json'), 'utf8'));
for (const [from, to] of Object.entries(redirects)) {
  const target = to.split('#')[0];
  if (target.startsWith('/') && !built.some((p) => p.address === target) && !fs.existsSync(path.join(site, target))) throw new Error(`redirects.json: ${from} goes to ${to}, which is not a page`);
}
fs.writeFileSync(path.join(site, '_redirects.json'), JSON.stringify(redirects));
console.log(`built ${built.length} pages into ${site} (${docs} of them docs; downloads ${release.released ? `open, version ${release.version || 'unknown'}` : 'not open yet'})`);
