// builds the dusk.bot pages: wraps each page body in the shared layout, and turns the legal drafts
// (Markdown in the Dusk Bot repo's docs/legal) into terms/, privacy/, license/ and security/. zero deps.
//   node sites/dusk/build-pages.mjs [path to the Dusk Bot checkout]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function layout({ title, description, body, page }) {
  const nav = [['download', 'Download'], ['docs', 'Docs'], ['pricing', 'Pricing']]
    .map(([href, label]) => `<a href="/${href}"${page === href ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0e0d12">
<link rel="stylesheet" href="/site.css">
</head>
<body>
<header class="bar"><a class="brand" href="/">Dusk Bot</a><nav>${nav}<a class="cta" href="https://app.dusk.bot">Sign in</a></nav></header>
<main class="${page === 'home' ? 'home' : 'page'}">
${body}
</main>
<footer class="foot"><nav><a href="/download">Download</a><a href="/docs">Docs</a><a href="/pricing">Pricing</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/license">License</a><a href="/security">Security</a><a href="mailto:hello@dusk.bot">hello@dusk.bot</a></nav></footer>
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
