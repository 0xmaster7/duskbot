// authoring helper only: expands the {{...}} macros in page.html into ../index.html. the shipped page has no build step.
//   node _src/build.mjs [path to an icon-libs/node_modules folder]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const libs = process.argv[2] || path.join(process.env.HOME, 'Desktop/code/make/cooking-v2/salvage-v18-packs/assets/icon-libs/node_modules');

const star = Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 21 : 41, a = (Math.PI / 5) * i - Math.PI / 2; return `${(50 + r * Math.cos(a)).toFixed(1)} ${(53 + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
const SHAPES = {
  circle: ['<circle cx="50" cy="50" r="46"/>', 38],
  hex: ['<path d="M10 50 30 15.4h40L90 50 70 84.6H30z" stroke-width="10" stroke-linejoin="round"/>', 38],
  clover: ['<circle cx="31" cy="31" r="24"/><circle cx="69" cy="31" r="24"/><circle cx="31" cy="69" r="24"/><circle cx="69" cy="69" r="24"/><rect x="28" y="28" width="44" height="44"/>', 38],
  heart: ['<path d="M50 90C20 68 5 51 5 32 5 18 16 7 30 7c9 0 16 5 20 12 4-7 11-12 20-12 14 0 25 11 25 25 0 19-15 36-45 58z"/>', 30],
  star: [`<path d="M${star}z" stroke-width="12" stroke-linejoin="round"/>`, 42],
  drop: ['<path d="M50 5c18 24 36 42 36 59a36 36 0 0 1-72 0C14 47 32 29 50 5z"/>', 52],
};
const BOTS = { nova: ['circle', 'blue'], juno: ['heart', 'pink'], rivet: ['hex', 'orange'], tally: ['star', 'green'], quill: ['clover', 'purple'], echo: ['drop', 'yellow'] };
function bot(name, extra = '') {
  const [shape, colour] = BOTS[name], [body, y] = SHAPES[shape];
  return `<svg class="bot c-${colour}${extra ? ' ' + extra : ''}" viewBox="0 0 100 100" aria-hidden="true"><g class="body">${body}</g><g class="eyes"><rect x="36" y="${y}" width="9.5" height="23" rx="4.75"/><rect x="54.5" y="${y}" width="9.5" height="23" rx="4.75"/></g></svg>`;
}
function icon(name) {
  const svg = fs.readFileSync(path.join(libs, 'lucide-static/icons', `${name}.svg`), 'utf8');
  const inner = svg.replace(/<!--[\s\S]*?-->/, '').replace(/<svg[\s\S]*?>/, '').replace('</svg>', '').replace(/\s*\n\s*/g, '').replace(/ \/>/g, '/>');
  return `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}
function os(name) {
  if (name === 'windows') return '<svg class="os" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="9.4" height="9.4"/><rect x="12.6" y="2" width="9.4" height="9.4"/><rect x="2" y="12.6" width="9.4" height="9.4"/><rect x="12.6" y="12.6" width="9.4" height="9.4"/></svg>';
  const d = /<path d="([^"]+)"/.exec(fs.readFileSync(path.join(libs, 'simple-icons/icons', `${name}.svg`), 'utf8'))[1];
  return `<svg class="os" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
}
const logo = (name) => `<img class="logo" src="logos/${name}.${fs.existsSync(path.join(here, '..', 'logos', `${name}.svg`)) ? 'svg' : 'png'}" alt="" width="18" height="18">`;

let html = fs.readFileSync(path.join(here, 'page.html'), 'utf8');
html = html.replace(/\{\{b (\w+)((?: [\w-]+)*)\}\}/g, (_, n, extra) => bot(n, extra.trim()))
  .replace(/\{\{i ([\w-]+)\}\}/g, (_, n) => icon(n))
  .replace(/\{\{os (\w+)\}\}/g, (_, n) => os(n))
  .replace(/\{\{logo (\w+)\}\}/g, (_, n) => logo(n));
const left = html.match(/\{\{[^}]*\}\}/g);
if (left) throw new Error('unexpanded: ' + left.join(' '));
if (/—|style="|<style|<script(?![^>]*\ssrc=)/.test(html)) throw new Error('em dash or inline style/script in the page');
fs.writeFileSync(path.join(here, '..', 'index.html'), html);
console.log('wrote index.html', html.length);
