// builds the dusk.bot pages: wraps each page body in the shared layout, and turns the legal drafts
// (Markdown in the Dusk Bot repo's docs/legal) into terms/, privacy/, license/ and security/. zero deps.
//   node sites/dusk/build-pages.mjs [path to the Dusk Bot checkout]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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

const star = Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 21 : 41, a = (Math.PI / 5) * i - Math.PI / 2; return `${(50 + r * Math.cos(a)).toFixed(1)} ${(53 + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
const BOTS = {
  circle: ['<circle cx="50" cy="50" r="46"/>', 38],
  hex: ['<path d="M10 50 30 15.4h40L90 50 70 84.6H30z" stroke-width="10" stroke-linejoin="round"/>', 38],
  clover: ['<circle cx="31" cy="31" r="24"/><circle cx="69" cy="31" r="24"/><circle cx="31" cy="69" r="24"/><circle cx="69" cy="69" r="24"/><rect x="28" y="28" width="44" height="44"/>', 38],
  heart: ['<path d="M50 90C20 68 5 51 5 32 5 18 16 7 30 7c9 0 16 5 20 12 4-7 11-12 20-12 14 0 25 11 25 25 0 19-15 36-45 58z"/>', 30],
  star: [`<path d="M${star}z" stroke-width="12" stroke-linejoin="round"/>`, 42],
  drop: ['<path d="M50 5c18 24 36 42 36 59a36 36 0 0 1-72 0C14 47 32 29 50 5z"/>', 52],
  squircle: ['<rect x="6" y="6" width="88" height="88" rx="30"/>', 38],
  capsule: ['<rect x="18" y="4" width="64" height="92" rx="32"/>', 32],
  gem: ['<rect x="17" y="17" width="66" height="66" rx="13" transform="rotate(45 50 50)"/>', 38],
};
// {{bot shape colour extra-classes}} in a page becomes an inline mascot; inline so its eyes can follow the pointer
export function bot(shape, colour, extra = '') {
  const [body, y] = BOTS[shape];
  return `<svg class="bot c-${colour}${extra ? ' ' + extra : ''}" viewBox="0 0 100 100" aria-hidden="true"><g class="body">${body}</g><g class="eyes"><rect x="36" y="${y}" width="9.5" height="23" rx="4.75"/><rect x="54.5" y="${y}" width="9.5" height="23" rx="4.75"/></g></svg>`;
}
const CHIP_NAMES = { calendar: 'google calendar', drive: 'google drive', docs: 'google docs', sheets: 'google sheets' };
// {{chips a b c}} becomes a run of connector chips, each a coloured pixel tile and a name
const withChips = (html) => html.replace(/\{\{chips ([\w ]+)\}\}/g, (_, names) => names.split(' ').map((n) => `<span class="chip"><i class="px px-${n}"></i>${CHIP_NAMES[n] ?? n}</span>`).join(''));
const withBots = (html) => withChips(html).replace(/\{\{bot (\w+) (\w+)((?: [\w-]+)*)\}\}/g, (_, shape, colour, extra) => bot(shape, colour, extra.trim()));

// stamps a file's content hash on its url, so an edit is seen at once despite the cache header
const stamped = (file) => `/${file}?v=${createHash('sha256').update(fs.readFileSync(path.join(site, file))).digest('hex').slice(0, 8)}`;

export function layout({ title, description, body, page }) {
  const home = page === 'home';
  const nav = [['download', 'download'], ['docs', 'docs'], ['pricing', 'pricing']]
    .map(([href, label]) => `<a href="/${href}"${page === href ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const foot = (head, links) => `<div><h2>${head}</h2>${links.map(([href, label]) => `<a href="${href}">${label}</a>`).join('')}</div>`;
  return `<!doctype html>
<html lang="en"${home ? ' data-mk-smooth' : ''}>
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
<link rel="stylesheet" href="${stamped('site.css')}">${home ? `\n<link rel="stylesheet" href="${stamped('motion-kit-v2.css')}">\n<link rel="stylesheet" href="${stamped('home.css')}">` : ''}
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
<p class="foot-fine">made at dusk. the bots did most of it.</p>
</footer>${home ? `\n<script src="${stamped('motion.min.js')}"></script>\n<script src="${stamped('motion-kit-v2.js')}"></script>\n<script src="${stamped('home.js')}"></script>` : ''}
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
