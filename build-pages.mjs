// builds the dusk.bot pages: wraps each page body in the shared layout, and turns the legal drafts
// (Markdown in the Dusk Bot repo's docs/legal) into terms/, privacy/, license/ and security/. zero deps.
//   node sites/dusk/build-pages.mjs [path to the Dusk Bot checkout]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { MARK_FILL, createAnimator, createStateDriver, markAppearance, markFillScale, markShapeFor, markTree } from './mascot-src/app/mascot-motion-engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(here, 'public', 'landing');
const repo = process.argv[2] || path.join(process.env.HOME, 'Desktop/code/OpenMausBot');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function inline(text) {
  let s = esc(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/(^|[\s(])((?:hello|privacy|security)@dusk\.bot)/g, '$1<a href="mailto:$2">$2</a>');
  return s;
}

export function markdown(md) {
  const out = [], lines = md.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
      const level = Math.min(m[1].length + (m[1].length === 1 ? 0 : 0), 4);
      const id = m[2].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      out.push(`<h${level} id="${id}">${inline(m[2])}</h${level}>`); i++; continue;
    }
    if (line.startsWith('>')) {
      const body = []; while (i < lines.length && lines[i].startsWith('>')) body.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(body.join(' '))}</blockquote>`); continue;
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
        let item = lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`); continue;
    }
    const para = []; while (i < lines.length && lines[i].trim() && !/^(#|>|\||\s*([-*]|\d+\.)\s)/.test(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

// the site's bot shapes, as the app's body ids (shared/grok-bodies.ts in the Dusk Bot repo)
const BOTS = { circle: 'blob', hex: 'hex', clover: 'clover', heart: 'heart', star: 'star', drop: 'teardrop', squircle: 'squircle', capsule: 'capsule', gem: 'gem' };
// the app's canvas is wider than the mark (0.92 / 0.6 of it) so a turning, squashing body never clips
const FIT = markFillScale(MARK_FILL), MK = (box, at = 0) => `x="${(at + box * (1 - FIT) / 2).toFixed(2)}" y="${(at + box * (1 - FIT) / 2).toFixed(2)}" width="${(box * FIT).toFixed(2)}" height="${(box * FIT).toFixed(2)}"`;
const markup = (n) => `<${n.tag}${Object.entries(n.attrs).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`).join('')}>${n.children.map(markup).join('')}</${n.tag}>`;
// each body's rest pose, drawn by the app's own engine the way a still mark settles (60 steps of 0.1 s), once per page
// in <defs>; every bot <use>s it until mascot.js takes over, so without script the bots still show
const rested = new Set();
function rest(body, eye) {
  const id = `rest-${body}${eye ? '-w' : ''}`;
  let defs = '';
  if (!rested.has(id)) {
    rested.add(id);
    const a = createAnimator({ body: body === 'fruit' ? 'pumpkin' : markShapeFor(body) });
    createStateDriver(a, 'idle', { seed: 0, isCompact: false, isResting: true });
    a.pause(); a.seek(0);
    for (let i = 0; i < 60; i++) a.advance(0.1);
    defs = markup(markTree(a.frame(), markAppearance('currentColor', eye), 61.33, id, { displaySize: 40, extent: '100%' }));
  }
  return [defs, `<svg class="mk" ${MK(100)}><use href="#${id}"/></svg>`];
}
// {{bot shape colour extra-classes}} in a page becomes one of the app's mascots, in its white face (cut-out eyes would
// show a picture behind through them); mascot.js brings it to life
export function bot(shape, colour, extra = '') {
  const [defs, canvas] = rest(BOTS[shape], '#fff');
  return `<svg class="bot c-${colour}${extra ? ' ' + extra : ''}" viewBox="0 0 100 100" aria-hidden="true" data-body="${BOTS[shape]}">${defs ? `<defs>${defs}</defs>` : ''}${canvas}</svg>`;
}
const CHIP_NAMES = { calendar: 'google calendar', drive: 'google drive', docs: 'google docs', sheets: 'google sheets' };
const logo = (name, eager) => `<img class="logo" src="/art/logos/${name}.${fs.existsSync(path.join(site, 'art', 'logos', `${name}.svg`)) ? 'svg' : 'png'}" alt="" width="20" height="20"${eager ? '' : ' loading="lazy"'} decoding="async">`;
// {{logo name}} is one mark, lazy unless written {{logo name eager}} (the sliding tape, where lazy marks arrive blank);
// {{chips a b c}} is a run of connector chips, each a logo and a name
const withChips = (html) => html.replace(/\{\{logo (\w+)( eager)?\}\}/g, (_, name, eager) => logo(name, eager)).replace(/\{\{chips ([\w ]+)\}\}/g, (_, names) => names.split(' ').map((n) => `<span class="chip">${logo(n)}${CHIP_NAMES[n] ?? n}</span>`).join(''));
// {{include name}} drops in pages/partials/name.html, so a big piece of a page can live in its own file
const withParts = (html) => html.replace(/\{\{include ([\w-]+)\}\}/g, (_, name) => { const file = path.join(here, 'pages', 'partials', `${name}.html`); return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; });
const has = (file) => fs.existsSync(path.join(site, file));
// {{i name}} is a lucide icon (paths copied from lucide-static, one stroke width for all)
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  'hard-drive': '<path d="M10 16h.01"/><path d="M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M21.946 12.013H2.054"/><path d="M6 16h.01"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
};
const icon = (name) => `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
// {{sea}} is the bots in the last picture, drawn in the picture's own 1600 by 1067 space so they sit on its water at any
// width, each half under the waterline
function sea() {
  // far ones are small and sit higher on the water, near ones are bigger and lower; none on the sand or on a boat
  const swim = [
    ['circle', 'pink', 300, 770, 26], ['drop', 'green', 560, 752, 24], ['hex', 'purple', 820, 782, 28], ['squircle', 'yellow', 1290, 762, 26],
    ['clover', 'blue', 1400, 800, 30], ['heart', 'orange', 680, 822, 30], ['star', 'yellow', 210, 830, 32],
    ['circle', 'blue', 236, 884, 44], ['drop', 'yellow', 480, 900, 46], ['hex', 'orange', 748, 880, 40], ['clover', 'purple', 900, 916, 46],
    ['heart', 'pink', 1230, 902, 42], ['squircle', 'green', 1372, 884, 38], ['star', 'green', 1060, 930, 40]];
  const defs = [], bots = swim.map(([shape, colour, x, y, size]) => {
    const [def, canvas] = rest(BOTS[shape], '#fff');
    if (def) defs.push(def);
    return `<g class="sb c-${colour}" transform="translate(${x} ${y}) scale(${size / 100})" clip-path="url(#sea-line)" data-body="${BOTS[shape]}" data-size="${size}"><g class="dip">${canvas}</g><rect class="foam" x="-14" y="64" width="128" height="8"/></g>`;
  });
  return `<svg class="sea-bots" viewBox="0 0 1600 1067" aria-hidden="true" focusable="false"><defs><clipPath id="sea-line"><rect x="-30" y="-120" width="160" height="192"/></clipPath>${defs.join('')}</defs>${bots.join('')}</svg>`;
}
// {{os name}} is a platform mark from public/landing/art/os (simple-icons, cc0), inlined so it takes the text colour
const os = (name) => fs.readFileSync(path.join(site, 'art', 'os', `${name}.svg`), 'utf8').replace(/<title>.*?<\/title>/, '').replace('<svg ', '<svg class="os" aria-hidden="true" fill="currentColor" ').replace(/ role="img"| xmlns="[^"]*"/g, '').trim();
const withOs = (html) => html.replace(/\{\{os (\w+)\}\}/g, (_, name) => os(name));
const withBots = (html) => (rested.clear(), withOs(withChips(withParts(html))).replace(/\{\{bot (\w+) (\w+)((?: [\w-]+)*)\}\}/g, (_, shape, colour, extra) => bot(shape, colour, extra.trim()))
  .replace(/\{\{i ([\w-]+)\}\}/g, (_, name) => icon(name)).replace(/\{\{sea\}\}/g, sea));

// stamps a file's content hash on its url, so an edit is seen at once despite the cache header
const stamped = (file) => `/${file}?v=${createHash('sha256').update(fs.readFileSync(path.join(site, file))).digest('hex').slice(0, 8)}`;

export function layout({ title, description, body, page }) {
  const home = page === 'home';
  const nav = [['download', 'download'], ['docs', 'docs'], ['pricing', 'pricing']]
    .map(([href, label]) => `<a href="/${href}"${page === href ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const foot = (head, links) => `<div><h2>${head}</h2>${links.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#ffffff">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="https://dusk.bot/art/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/art/cursor-88.webp" type="image/webp">
<link rel="preload" href="/fonts/general-sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="${stamped('site.css')}">${home ? `\n<link rel="stylesheet" href="${stamped('motion-kit-v2.css')}">\n<link rel="stylesheet" href="${stamped('home.css')}">${has('app-demo.css') ? `\n<link rel="stylesheet" href="${stamped('app-demo.css')}">` : ''}` : ''}
</head>
<body${home ? ' class="is-home"' : ''}>
<header class="bar"><a class="brand" href="/"><img src="/art/cursor-88.webp" alt="" width="28" height="28">dusk bot</a><nav>${nav}<a class="cta" href="https://app.dusk.bot">sign in</a></nav></header>
<main class="${home ? 'home' : 'page'}">
${withBots(body).replace(/(src=")\/(art\/[\w.-]+)"/g, (_, lead, file) => `${lead}${stamped(file)}"`)}
</main>
<footer class="foot">
<div class="foot-in">
<div class="foot-brand"><a class="brand" href="/"><img src="/art/cursor-88.webp" alt="" width="28" height="28">dusk bot</a><p>a team of ai bots that runs where you want it to.</p></div>
${foot('product', [['/download', 'download'], ['/pricing', 'pricing'], ['/docs', 'docs'], ['https://app.dusk.bot', 'sign in']])}
${foot('legal', [['/terms', 'terms'], ['/privacy', 'privacy'], ['/license', 'license'], ['/security', 'security']])}
${foot('say hi', [['mailto:hello@dusk.bot', 'hello@dusk.bot']])}
</div>
<p class="foot-fine"><span data-dusk>made at dusk. the bots did most of it.</span>${home ? ' the bots, chats and numbers shown on this page are samples.' : ''}</p>
</footer>${home ? `\n<script src="${stamped('motion.min.js')}"></script>\n${has('mascot.js') ? `<script src="${stamped('mascot.js')}" defer></script>\n` : ''}<script src="${stamped('motion-kit-v2.js')}"></script>\n<script src="${stamped('home.js')}"></script>${has('app-demo.js') ? `\n<script src="${stamped('app-demo.js')}"></script>` : ''}` : ''}
</body>
</html>
`;
}

const pages = JSON.parse(fs.readFileSync(path.join(here, 'pages.json'), 'utf8'));
for (const page of pages) {
  const body = fs.readFileSync(path.join(here, 'pages', `${page.name}.html`), 'utf8');
  const file = page.name === 'home' ? path.join(site, 'index.html') : path.join(site, page.name, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, layout({ ...page, page: page.name, body }));
}
const legal = [['terms', 'Terms of Service'], ['privacy', 'Privacy Policy'], ['license', 'License'], ['security', 'Security']];
for (const [name, title] of legal) {
  const md = fs.readFileSync(path.join(repo, 'docs', 'legal', `${name}.md`), 'utf8');
  fs.mkdirSync(path.join(site, name), { recursive: true });
  fs.writeFileSync(path.join(site, name, 'index.html'), layout({ title: `${title} · Dusk Bot`, description: `Dusk Bot ${title.toLowerCase()}.`, page: name,
    body: `<article class="legal"><h1>${title}</h1>\n${markdown(md)}\n</article>` }));
}
console.log(`built ${pages.length + legal.length} pages into ${site}`);
