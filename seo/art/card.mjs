// the share cards (open graph and x), one calm system for every page: a flat field in the family's colour, a pixel
// ground, the title set big on the left (with a short line under it where the page has one) and one big pixel bot on the
// right, in a pose that changes from page to page, saying at most one short thing. an app page shows the app's mark beside
// the bot, a one-on-one page the other side's name; nothing else. the home and waitlist cards are the waitlist page's own
// world instead (the x banner): its banded sky, white words centred, the team on a hill and a short chat.
// 1200 by 630, and 1200 by 1200 for the square crop. cardSpec() picks everything from the page's address, so a page keeps
// its card from build to build; cardHtml() lays a spec out as a page that seo/art/render.py photographs; cardAlt() says
// what is in it.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import DuskPixel from '../../mascot-src/pixel/engine.js';
import { CROWD, COLOURS } from '../../mascot-src/pixel/crowd.js';

export const INK = '#1b1b1f';
const PAPER = '#fdfdfd', LILAC = '#d0cefb', LIME = '#c9f63f';
// the banner's sky, for the home cards
const MOODS = { sky: { bands: ['#06bafd', '#3cd0fd', '#90e4fc', '#c2ecfc'] } };
// each family's calm field and ground, the bot colours that would vanish on it, and its poses
export const FAMILIES = {
  home: { field: '#c2ecfc', ground: 'meadow', avoid: ['sky', 'cyan'] },
  docs: { field: '#eaf6fd', ground: 'meadow', avoid: [], poses: ['focus', 'look', 'happy', 'big', 'wink'] },
  guide: { field: '#c2ecfc', ground: 'meadow', avoid: ['sky', 'cyan'], poses: ['look', 'focus', 'happy', 'wink', 'big'] },
  compare: { field: '#d0cefb', ground: 'lemon', avoid: ['violet', 'indigo'], poses: ['look', 'big', 'wink', 'focus', 'happy'] },
  integration: { field: '#e6f8bd', ground: 'lilac', avoid: ['lime', 'mint', 'emerald'], poses: ['happy', 'heart', 'look', 'big', 'wink'] },
  action: { field: '#e6f8bd', ground: 'sand', avoid: ['lime', 'mint', 'emerald'], poses: ['happy', 'look', 'focus', 'big', 'wink', 'heart'] },
  usecase: { field: '#ffd3e6', ground: 'meadow', avoid: ['pink', 'coral'], poses: ['happy', 'wink', 'heart', 'focus', 'look'] },
  role: { field: '#ffd3e6', ground: 'lilac', avoid: ['pink', 'coral'], poses: ['happy', 'wink', 'heart', 'look'] },
  routine: { field: '#fff6b8', ground: 'meadow', avoid: ['sun'], poses: ['sleepy', 'happy', 'focus', 'wink'] },
  glossary: { field: '#eaf6fd', ground: 'lilac', avoid: [], poses: ['focus', 'big', 'look'] },
  tool: { field: '#fff6b8', ground: 'sand', avoid: ['sun', 'tangerine'], poses: ['focus', 'happy', 'big'] },
  night: { field: '#1b2c6b', ground: 'night', avoid: ['indigo', 'blue'], dark: true },
};
const GROUNDS = {
  meadow: { rows: ['#c9f63f', '#b9ea35', '#a9de33'], dots: ['#ffc4dd', '#ffffff', '#fff3a0'], words: 'a meadow' },
  sand: { rows: ['#fbf0cf', '#f5e4b4', '#efd99e'], dots: ['#c9f63f', '#ffffff'], words: 'a sandy path' },
  lilac: { rows: ['#d0cefb', '#c2bff6', '#b4b0ef'], dots: ['#ffffff', '#fff3a0', '#ffc4dd'], words: 'a lilac hill' },
  lemon: { rows: ['#fff3a0', '#ffec7d', '#fbe36a'], dots: ['#ffc4dd', '#ffffff', '#c9f63f'], words: 'a lemon field' },
  night: { rows: ['#86b02a', '#7ca424', '#6f9620'], dots: ['#fff3a0', '#d0cefb'], words: 'a dark meadow' },
};
// a pose is the eyes, a lean and a squash
export const POSES = {
  open: { eyes: 'open', words: 'calm' },
  look: { eyes: 'open', gaze: 1, lean: 0.06, words: 'looking over' },
  focus: { eyes: 'focus', gaze: 1, words: 'concentrating' },
  happy: { eyes: 'happy', lean: -0.08, sq: 0.06, words: 'happy' },
  heart: { eyes: 'heart', words: 'with heart eyes' },
  big: { eyes: 'big', sq: -0.1, words: 'wide-eyed' },
  wink: { eyes: 'open', eyesR: 'happy', lean: 0.08, words: 'winking' },
  sleepy: { eyes: 'closed', sq: 0.08, words: 'asleep' },
  dizzy: { eyes: 'dizzy', lean: 0.12, words: 'dizzy' },
};
export const BOT_WORDS = { blue: 'blue', sky: 'sky blue', cyan: 'cyan', violet: 'purple', pink: 'pink', coral: 'coral', tangerine: 'orange', sun: 'yellow', lime: 'lime', mint: 'mint', emerald: 'green', indigo: 'indigo', white: 'white' };
const SHAPES = CROWD.map(([name]) => name);

export function rng(seed) {
  let h = createHash('sha256').update(seed).digest(), i = 0;
  return () => { if (i >= h.length - 4) { h = createHash('sha256').update(h).digest(); i = 0; } const v = h.readUInt32BE(i); i += 4; return v / 2 ** 32; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// a bot drawn by the pixel engine in a pose, as svg with its feet at the bottom edge of the body box
export function botSvg(shape, colour, pose = 'open', { grid = 26, flip = false } = {}) {
  const P = POSES[pose] || POSES.open, b = DuskPixel.create(null, { body: shape, size: grid });
  const side = flip ? -1 : 1;
  b.lean.x = (P.lean || 0) * side; b.sq.x = P.sq || 0; b.gx.x = (P.gaze || 0) * side * -1; b.gy.x = 0; b.T = 0.3;
  b.draw(P.eyes, P.eyesR || P.eyes, 0, b.def.float ? -b.def.N * 0.1 : 0);
  const white = colour === 'white', fill = white ? '#ffffff' : COLOURS[colour] || colour;
  const { G, px, pt, W, H } = b;
  return { G, svg: (size, extra = '') => `<svg viewBox="${-px} ${-pt} ${W} ${H}" width="${(size * W) / G}" height="${(size * H) / G}" shape-rendering="crispEdges" style="${extra}"><path fill="${fill}" d="${b.d[0]}"/><path fill="${white ? INK : '#fff'}" d="${b.d[1]}"/></svg>`, px, pt, W, H };
}

// the calm cards' ground: rows of colour under a stepped top edge, a few flowers, none under the words
function groundSvg(ground, w, h, seed, clear) {
  const g = GROUNDS[ground], cell = 12, cols = Math.ceil(w / cell), rows = Math.ceil(h / cell), r = rng(`ground:${seed}`), shift = Math.round(r() * 200);
  let rects = '';
  for (let i = 0; i < cols; i++) {
    const t = Math.round(1.2 + 1.1 * Math.sin((i + shift) / 8) + Math.sin((i + shift) / 2.6) * 0.5);
    rects += `<rect x="${i * cell}" y="${t * cell}" width="${cell}" height="${h}" fill="${g.rows[0]}"/>`;
    rects += `<rect x="${i * cell}" y="${(t + 3) * cell}" width="${cell}" height="${h}" fill="${g.rows[1]}"/>`;
    rects += `<rect x="${i * cell}" y="${(t + 7) * cell}" width="${cell}" height="${h}" fill="${g.rows[2]}"/>`;
  }
  for (let n = 0; n < 12; n++) { const x = Math.floor(r() * cols) * cell, y = (4 + Math.floor(r() * Math.max(1, rows - 5))) * cell; if (!clear(x, y)) rects += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${g.dots[n % g.dots.length]}"/>`; }
  return `<svg class="ground" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges" preserveAspectRatio="none">${rects}</svg>`;
}

// the world, as the waitlist page draws it: the sky's bands with their edges scattered upward (the band behind the words
// stays clean), the lilac line, the meadow rising into hills, grass flecks and pixel flowers. hills: [[centre, half, rise]]
function worldSvg(mood, W, H, G, hills, seed, { clearTop = 0, clearBottom = 0, words = [0, 0, 0, 0] } = {}) {
  const r = rng(`world:${seed}`), b = 12, s = 6, snap = (v) => Math.round(v / b) * b, M = MOODS[mood], [c0, c1, c4, c5] = M.bands;
  const y1 = snap(Math.min(G * 0.14, clearTop - 2 * b)), y4 = snap(Math.max(G - 7 * b, clearBottom + 3 * b)), y5 = snap(Math.max(G - 4 * b, y4 + 2 * b));
  const bands = [[c0, 0], [c1, Math.max(b, y1)], [c4, y4], [c5, y5], [LILAC, G - b]];
  let out = '';
  bands.forEach(([c, y], i) => { out += `<rect x="0" y="${y}" width="${W}" height="${(bands[i + 1]?.[1] ?? G) - y}" fill="${c}"/>`; });
  for (let i = 1; i < bands.length - 1; i++) {
    const [c, y] = bands[i], [cp] = bands[i - 1];
    [0.42, 0.16, 0.05].forEach((p, k) => {
      for (let x = 0; x < W; x += b) {
        if (r() < p) out += `<rect x="${x}" y="${y - (k + 1) * b}" width="${b}" height="${b}" fill="${c}"/>`;
        if (k === 0 && r() < 0.1) out += `<rect x="${x}" y="${y}" width="${b}" height="${b}" fill="${cp}"/>`;
      }
    });
  }
  if (M.night) for (let i = 0; i < 46; i++) { const x = snap(r() * W), y = snap(r() * (G - 8 * b)), big = r() < 0.2; if (x > words[0] - 24 && x < words[2] + 24 && y > words[1] - 24 && y < words[3] + 24) continue; out += `<rect x="${x}" y="${y}" width="${big ? b : s}" height="${big ? b : s}" fill="${i % 4 ? '#fff3a0' : '#ffffff'}" opacity="${0.55 + r() * 0.45}"/>`; }
  // the meadow and its hills
  const ground = M.night ? '#8fb52b' : LIME, fleck = M.night ? '#86ab27' : '#c0ee36';
  for (let x = 0; x < W; x += b) {
    let y = G;
    for (const [hx, half, rise] of hills) { const d = Math.abs(x + b / 2 - hx) / half; if (d < 1) y = Math.min(y, snap(G - rise * (1 - d * d) ** 0.7)); }
    out += `<rect x="${x}" y="${y}" width="${b}" height="${H - y}" fill="${ground}"/>`;
  }
  for (let i = 0, n = Math.round((W * (H - G)) / 900); i < n; i++) out += `<rect x="${Math.round((r() * W) / s) * s}" y="${Math.round((G + b + r() * (H - G - b)) / s) * s}" width="${s * (r() < 0.5 ? 2 : 1)}" height="${s}" fill="${fleck}"/>`;
  const cols = [PAPER, '#ffc4dd', '#fff3a0'];
  for (let i = 0, n = Math.max(8, Math.round(W / 90)); i < n; i++) {
    const x = Math.round((r() * W) / s) * s, y = Math.round((G + 3 * b + r() * (H - G - 5 * b)) / s) * s;
    out += `<g fill="${cols[i % 3]}"><rect x="${x}" y="${y - s}" width="${s}" height="${s}"/><rect x="${x - s}" y="${y}" width="${s}" height="${s}"/><rect x="${x + s}" y="${y}" width="${s}" height="${s}"/><rect x="${x}" y="${y + s}" width="${s}" height="${s}"/></g><rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${i % 3 === 2 ? '#ffb020' : '#ffe25c'}"/>`;
  }
  return `<svg class="world" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges">${out}</svg>`;
}


// one card's choices. page: { at, family, title, line?, bubble?, logo?, label?, vs?, bot?, pose?, flip?, align?, crowd?,
// chat? }. salt makes a different card when two would match
export function cardSpec(page, salt = '') {
  const fam = FAMILIES[page.family] || FAMILIES.guide;
  const r = rng(`card:${page.at}${salt}`);
  let shape, colour;
  if (page.bot) [shape, colour] = page.bot.split(' ');
  else {
    shape = pick(r, SHAPES);
    const home = CROWD.find(([n]) => n === shape)[1];
    colour = r() < 0.6 && !fam.avoid.includes(home) ? home : pick(r, Object.keys(COLOURS).filter((c) => !fam.avoid.includes(c)));
  }
  const pose = page.pose || pick(r, fam.poses || ['happy']);
  return {
    at: page.at, family: page.family, field: fam.field, ground: fam.ground, dark: !!fam.dark, align: page.align || 'left',
    title: page.title, line: page.line || '', bubble: page.bubble || '',
    bot: { shape, colour }, pose, flip: page.flip ?? false,
    tile: page.logo || (page.vs && page.label) ? { logo: page.logo || null, label: page.label || null, vs: !!page.vs } : null,
    crowd: page.crowd || null, chat: page.chat || null, seed: `${page.at}${salt}`,
  };
}
export const cardSignature = (s) => [s.family, s.bot.shape, s.bot.colour, s.pose, s.tile?.logo || s.tile?.label || ''].join('|');

export function cardAlt(s) {
  const who = (c) => `${BOT_WORDS[c[1]] || c[1]} ${c[0] === 'kit' ? 'cat bot' : 'pixel bot'}`;
  if (s.crowd) return `share card: a big ${who(s.crowd[0])} and ${s.crowd.length - 1} small pixel bots on a hill under a blue pixel sky, a chat (${s.chat.map(([w, t]) => `${w}: "${t}"`).join(', ')}), and the words "${s.title}"`;
  const beside = s.tile ? (s.tile.logo ? ` beside the ${s.tile.label || 'app'} mark` : ` beside a tile saying ${s.tile.label}`) : '';
  return `share card: a big ${BOT_WORDS[s.bot.colour] || s.bot.colour} ${s.bot.shape === 'kit' ? 'cat bot' : 'pixel bot'}, ${POSES[s.pose].words}${beside}${s.bubble ? `, saying "${s.bubble}"` : ''}, on ${GROUNDS[s.ground].words}, and the words "${s.title}"`;
}

// shared by both layouts: the title fits its box, bubbles stay inside the safe margin (render.py waits for data-ready)
const FIT = (margin, minLeft) => `<script>
(async () => { await document.fonts.ready; const box = document.querySelector('.text'), h = box.querySelector('h1');
  for (const t of document.querySelectorAll('.fit')) { let z = parseFloat(getComputedStyle(t).fontSize); while ((t.scrollWidth > t.clientWidth || t.scrollHeight > t.parentNode.clientHeight - 16) && z > 12) { z -= 1; t.style.fontSize = z + 'px'; } }
  for (const bb of document.querySelectorAll('.bub[data-clamp]')) { const r = bb.getBoundingClientRect(), over = r.right - (innerWidth - ${margin}), under = ${minLeft} - r.left;
    if (over > 0) bb.style.left = (parseFloat(bb.style.left) - over) + 'px'; else if (under > 0) bb.style.left = (parseFloat(bb.style.left) + under) + 'px'; }
  let f = parseFloat(h.style.fontSize); while ((box.scrollHeight > box.clientHeight + 1 || h.scrollWidth > box.clientWidth + 1) && f > 44) { f -= 2; h.style.fontSize = f + 'px'; }
  document.body.dataset.ready = '1'; })();
</script>`;
const fontFace = (font) => `@font-face { font-family: "General Sans"; src: url("${font}"); font-weight: 200 700; }
@font-face { font-family: "Geist Mono"; src: url("${font.replace('general-sans', 'geist-mono')}"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }`;
const titleHtml = (t) => esc(t).replace(/(\S+-\S+)/g, '<span class="nb">$1</span>');

// kitDir: public/landing/art (file urls), font: the general sans file url, mark: the app icon file url
export function cardHtml(s, opts) {
  return s.crowd ? homeHtml(s, opts) : calmHtml(s, opts);
}

// the calm card: words on the left, one bot (and an app mark or the other side's name) on the right
function calmHtml(s, { kitDir, font, mark, square = false }) {
  const W = 1200, H = square ? 1200 : 630, M = square ? 80 : 64;
  const groundH = square ? 290 : 118, G = H - groundH, floor = G + 22;
  const ink = s.dark ? '#f4f2ff' : INK;
  const bot = botSvg(s.bot.shape, s.bot.colour, s.pose, { grid: 26, flip: s.flip });
  const tileSize = square ? 200 : 150, gap = 18;
  const big = s.tile ? (square ? 360 : 280) : (square ? 390 : 300);
  const total = big + (s.tile ? tileSize + gap : 0);
  // the group stands against the right margin on the wide card, and right of centre on the square one
  const left0 = square ? Math.round(W - M - total - 40) : W - M - total;
  const botBox = s.tile && s.flip ? left0 + tileSize + gap : left0, tileX = s.flip ? left0 : left0 + big + gap;
  const parts = [`<div class="shadow" style="left:${Math.round(botBox + big * 0.07)}px;top:${floor - 12}px;width:${Math.round(big * 0.86)}px"></div>`,
    `<div class="bot" style="left:${Math.round(botBox - big * bot.px / bot.G)}px;top:${Math.round(floor - big * (bot.pt + bot.G) / bot.G)}px">${bot.svg(big, s.flip && !s.tile ? 'transform:scaleX(-1)' : '')}</div>`];
  if (s.tile) {
    const label = s.tile.label || '';
    const inner = s.tile.logo ? `<img src="${s.tile.logo.startsWith('file:') ? s.tile.logo : `${kitDir}/${s.tile.logo}`}" alt="">` : `<span class="fit ${label.length <= 4 ? 'l1' : label.length <= 9 ? 'l2' : 'l3'}">${esc(label)}</span>`;
    parts.push(`<div class="tile" style="left:${tileX}px;top:${floor - tileSize - 8}px;width:${tileSize}px;height:${tileSize}px">${inner}</div>`);
    if (s.tile.vs) parts.push(`<div class="vs" style="left:${Math.round(tileX + tileSize / 2 - 32)}px;top:${floor - tileSize - 58}px">vs</div>`);
  }
  // the one bubble: over the head on the wide card, beside it on the square one
  const head = floor - big;
  let bubble = '';
  if (s.bubble && !s.tile) bubble = square
    ? `<div class="bub r" style="right:${W - botBox + 20}px;bottom:${H - (head + big * 0.32)}px">${esc(s.bubble)}</div>`
    : `<div class="bub" data-clamp style="left:${Math.round(botBox + big * 0.4)}px;bottom:${H - head + 22}px">${esc(s.bubble)}</div>`;
  const textTop = square ? 96 : M, textH = square ? head - 40 - 96 : G - 24 - M, textW = square ? W - 2 * M : 600;
  const n = s.title.length;
  const size = square ? (n < 14 ? 140 : n < 26 ? 116 : n < 44 ? 92 : 80) : (n < 14 ? 112 : n < 26 ? 92 : n < 44 ? 74 : 64);
  const dots = square ? (x, y) => false : (x, y) => x < 680 && y > 40;
  return `<!doctype html><meta charset="utf-8"><style>
${fontFace(font)}
body { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${s.field}; font-family: "General Sans"; color: ${ink}; -webkit-font-smoothing: antialiased; }
.ground { position: absolute; left: 0; bottom: 0; }
.bot, .tile, .shadow, .vs { position: absolute; }
.bot svg { display: block; overflow: visible; }
.shadow { height: 24px; border-radius: 50%; background: rgba(27,27,31,0.12); }
.tile { display: grid; place-items: center; border-radius: 26%; background: #fff; box-shadow: 0 10px 0 rgba(27,27,31,0.09); }
.tile img { width: 56%; height: 56%; object-fit: contain; }
.tile span { display: block; max-width: 100%; font-weight: 600; letter-spacing: -0.03em; text-align: center; padding: 12px; line-height: 1.02; color: ${INK}; }
.tile .l1 { font-size: ${square ? 80 : 60}px; } .tile .l2 { font-size: ${square ? 38 : 30}px; } .tile .l3 { font-size: ${square ? 30 : 23}px; }
.vs { width: 64px; height: 42px; display: grid; place-items: center; background: ${INK}; color: #fff3a0; font-size: 24px; font-weight: 600; border-radius: 10px; }
.bub { position: absolute; width: max-content; max-width: ${square ? 360 : 330}px; padding: ${square ? '14px 22px' : '11px 18px'}; border-radius: 22px 22px 22px 6px; background: #fff; color: ${INK}; font-size: ${square ? 30 : 24}px; font-weight: 550; line-height: 1.2; letter-spacing: -0.02em; box-shadow: 0 6px 0 rgba(27,27,31,0.07); }
.bub.r { border-radius: 22px 22px 6px 22px; }
.text { position: absolute; left: ${M}px; top: ${textTop}px; width: ${textW}px; height: ${textH}px; display: flex; flex-direction: column; justify-content: ${square ? 'flex-start' : 'center'}; }
.nb { white-space: nowrap; }
h1 { font-weight: 600; line-height: 1.04; letter-spacing: -0.045em; text-wrap: balance; }
.text p { margin-top: ${square ? 26 : 20}px; font-size: ${square ? 40 : 32}px; font-weight: 500; line-height: 1.25; letter-spacing: -0.02em; opacity: 0.72; text-wrap: balance; }
</style>${groundSvg(s.ground, W, groundH, s.seed, dots)}${parts.join('')}${bubble}<div class="text"><h1 style="font-size:${size}px">${titleHtml(s.title)}</h1>${s.line ? `<p>${esc(s.line)}</p>` : ''}</div>
${FIT(M, square ? M : 690)}`;
}

// the home and waitlist cards: the waitlist page's world, white words centred, the team evenly spaced on one hill, and a
// two-line chat on a shared baseline between the words and the hill
function homeHtml(s, { font, square = false }) {
  const W = 1200, H = square ? 1200 : 630, M = square ? 80 : 64;
  const G = H - (square ? 180 : 100), rise = square ? 64 : 40, half = square ? 620 : 560;
  const lead = square ? 340 : 200, small = square ? 150 : 104, step = square ? 222 : 180;
  const footAt = (x) => { const d = Math.abs(x - W / 2) / half; return (d < 1 ? G - rise * (1 - d * d) ** 0.7 : G) + 6; };
  const parts = [];
  const place = ([shape, colour, pose], size, cx) => {
    const b = botSvg(shape, colour, pose || 'open', { grid: size > 200 ? 26 : 22 }), f = footAt(cx);
    parts.push(`<div class="bot" style="left:${Math.round(cx - size / 2 - size * b.px / b.G)}px;top:${Math.round(f - size * (b.pt + b.G) / b.G)}px">${b.svg(size)}</div>`);
  };
  const [first, ...cast] = s.crowd;
  [-2, -1, 1, 2].forEach((k, i) => cast[i] && place(cast[i], small, W / 2 + k * step));
  place(first, lead, W / 2);
  const leadTop = footAt(W / 2) - lead;
  // the chat: you on the left, the bot answering on the right, both bottoms on one line above the team
  const base = square ? leadTop - 56 : 368;
  const [[w1, t1], [w2, t2]] = s.chat;
  const bub = (who, text, side, tint) => `<div class="bub ${side}" style="${side}:${M}px;bottom:${H - base}px;--u:${tint}"><div class="in"><span>${esc(who)}</span>${esc(text)}</div><i></i></div>`;
  const words = { top: square ? 120 : 72, size: square ? 150 : 120, line: square ? 44 : 34 };
  return `<!doctype html><meta charset="utf-8"><style>
${fontFace(font)}
body { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #3cd0fd; font-family: "General Sans"; color: #fff; -webkit-font-smoothing: antialiased; }
.world { position: absolute; left: 0; top: 0; }
.bot { position: absolute; } .bot svg { display: block; overflow: visible; filter: drop-shadow(0 6px 0 rgba(12,24,60,0.12)); }
.bub { position: absolute; width: max-content; filter: drop-shadow(0 6px 0 rgba(12,24,60,0.12)); }
.bub .in { padding: ${square ? '14px 22px 20px' : '10px 18px 16px'}; background: ${PAPER}; color: #212121; font-size: ${square ? 30 : 22}px; font-weight: 500; line-height: 1.18; letter-spacing: -0.015em; box-shadow: inset 0 -5px 0 var(--u);
  clip-path: polygon(6px 0, calc(100% - 6px) 0, calc(100% - 6px) 6px, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 6px calc(100% - 6px), 0 calc(100% - 6px), 0 6px, 6px 6px); }
.bub span { display: block; margin-bottom: 3px; font-family: "Geist Mono"; font-size: ${square ? 18 : 14}px; color: #8a8a96; }
.bub i { position: absolute; bottom: -18px; left: 24px; width: 18px; height: 18px; background: linear-gradient(var(--u) 0 6px, ${PAPER} 6px); clip-path: polygon(0 0, 100% 0, 100% 33.3%, 66.6% 33.3%, 66.6% 66.6%, 33.3% 66.6%, 33.3% 100%, 0 100%); }
.text { position: absolute; left: ${M}px; top: ${words.top}px; width: ${W - 2 * M}px; height: ${square ? 400 : 230}px; text-align: center; text-shadow: 0 2px 0 rgba(12,24,60,0.16), 0 4px 22px rgba(12,24,60,0.22); }
h1 { font-weight: 600; line-height: 1; letter-spacing: -0.045em; }
.text p { margin-top: ${square ? 30 : 22}px; font-size: ${words.line}px; font-weight: 550; line-height: 1.2; letter-spacing: -0.015em; }
</style>${worldSvg('sky', W, H, G, [[W / 2, half, rise]], s.seed, { clearTop: words.top - 40, clearBottom: words.top + 200, words: [0, 0, 0, 0] })}${parts.join('')}${bub(w1, t1, 'left', '#fff3a0')}${bub(w2, t2, 'right', '#ffc4dd')}<div class="text"><h1 style="font-size:${words.size}px">${titleHtml(s.title)}</h1><p>${esc(s.line)}</p></div>
${FIT(M, M)}`;
}

// each kit object's size in pixels (the seo heroes use it)
export function kitSizes(kitDir, names) {
  const size = (file) => { const b = fs.readFileSync(file), k = b.toString('ascii', 12, 16); if (k === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]; if (k === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]; const n = b.readUInt32LE(21); return [1 + (n & 0x3fff), 1 + ((n >> 14) & 0x3fff)]; };
  return Object.fromEntries(names.map((p) => { const f = path.join(kitDir, p.startsWith('p-') ? `kit/${p}.webp` : `${p}.webp`); return [p, fs.existsSync(f) ? size(f) : [420, 420]]; }));
}
