// the share cards (open graph and x), one system for every page: a flat field in the family's colour, a pixel ground,
// one big pixel bot in a pose that changes from page to page, saying a short line in a chat bubble, beside the page's app
// tile, name tile or kit object, and the title set big on the left. 1200 by 630, and 1200 by 1200 for the square crop.
// cardSpec() picks everything from the page's address, so a page keeps its card from build to build; cardHtml() lays a
// spec out as a page that seo/art/render.py photographs; cardAlt() says what is in it.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import DuskPixel from '../../mascot-src/pixel/engine.js';
import { CROWD, COLOURS } from '../../mascot-src/pixel/crowd.js';

export const INK = '#1b1b1f';
// each family's mood: the field, the ground, the bot colours that would vanish on that field, the label and the poses
export const FAMILIES = {
  home: { field: '#c2ecfc', ground: 'meadow', label: 'dusk bot', avoid: ['sky', 'cyan'] },
  docs: { field: '#eaf6fd', ground: 'meadow', label: 'docs', avoid: [], poses: ['focus', 'look', 'happy', 'big', 'wink'] },
  guide: { field: '#c2ecfc', ground: 'meadow', label: 'guide', avoid: ['sky', 'cyan'], poses: ['look', 'focus', 'happy', 'wink', 'big'] },
  compare: { field: '#d0cefb', ground: 'lemon', label: 'compare', avoid: ['violet', 'indigo'], poses: ['look', 'big', 'wink', 'focus', 'happy'] },
  integration: { field: '#c9f63f', ground: 'lilac', label: 'integration', avoid: ['lime', 'mint', 'emerald'], poses: ['happy', 'heart', 'look', 'big', 'wink'] },
  action: { field: '#c9f63f', ground: 'sand', label: 'action', avoid: ['lime', 'mint', 'emerald'], poses: ['happy', 'look', 'focus', 'big', 'wink', 'heart'] },
  usecase: { field: '#ffc4dd', ground: 'meadow', label: 'use case', avoid: ['pink', 'coral'], poses: ['happy', 'wink', 'heart', 'focus', 'look'] },
  role: { field: '#ffc4dd', ground: 'lilac', label: 'for', avoid: ['pink', 'coral'], poses: ['happy', 'wink', 'heart', 'look'] },
  routine: { field: '#fff3a0', ground: 'meadow', label: 'routine', avoid: ['sun'], poses: ['sleepy', 'happy', 'focus', 'wink'] },
  glossary: { field: '#eaf6fd', ground: 'lilac', label: 'glossary', avoid: [], poses: ['focus', 'big', 'look'] },
  tool: { field: '#fff3a0', ground: 'sand', label: 'free tool', avoid: ['sun', 'tangerine'], poses: ['focus', 'happy', 'big'] },
  night: { field: '#1b2c6b', ground: 'night', label: '', avoid: ['indigo', 'blue'], dark: true },
};
const GROUNDS = {
  meadow: { rows: ['#c9f63f', '#b9ea35', '#a9de33'], dots: ['#ffc4dd', '#ffffff', '#fff3a0'], words: 'a meadow' },
  sand: { rows: ['#fbf0cf', '#f5e4b4', '#efd99e'], dots: ['#c9f63f', '#ffffff', '#ffc4dd'], words: 'a sandy path' },
  lilac: { rows: ['#d0cefb', '#c2bff6', '#b4b0ef'], dots: ['#ffffff', '#fff3a0', '#ffc4dd'], words: 'a lilac hill' },
  lemon: { rows: ['#fff3a0', '#ffec7d', '#fbe36a'], dots: ['#ffc4dd', '#ffffff', '#c9f63f'], words: 'a lemon field' },
  night: { rows: ['#86b02a', '#7ca424', '#6f9620'], dots: ['#fff3a0', '#d0cefb'], words: 'a dark meadow' },
};
// a pose is the eyes, a lean and a squash, and a small pixel mark beside the head
export const POSES = {
  open: { eyes: 'open', words: 'calm' },
  look: { eyes: 'open', gaze: 1, lean: 0.06, words: 'looking over' },
  focus: { eyes: 'focus', gaze: 1, words: 'concentrating', mark: 'dots' },
  happy: { eyes: 'happy', lean: -0.08, sq: 0.06, words: 'happy', mark: 'sparkle' },
  heart: { eyes: 'heart', words: 'with heart eyes', mark: 'heart' },
  big: { eyes: 'big', sq: -0.1, words: 'wide-eyed', mark: 'bang' },
  wink: { eyes: 'open', eyesR: 'happy', lean: 0.08, words: 'winking', mark: 'sparkle' },
  sleepy: { eyes: 'closed', sq: 0.08, words: 'asleep', mark: 'zzz' },
  dizzy: { eyes: 'dizzy', lean: 0.12, words: 'dizzy', mark: 'swirl' },
  sad: { eyes: 'sad', words: 'a little lost', mark: 'drop' },
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
  // the body box is 0..G; the drawing reaches a little past it for lean and ears
  const { G, px, pt, W, H } = b;
  return { G, svg: (size, extra = '') => `<svg viewBox="${-px} ${-pt} ${W} ${H}" width="${(size * W) / G}" height="${(size * H) / G}" shape-rendering="crispEdges" style="${extra}"><path fill="${fill}" d="${b.d[0]}"/><path fill="${white ? INK : '#fff'}" d="${b.d[1]}"/></svg>`, px, pt, W, H };
}

// small pixel marks, drawn as rows of cells
const MARKS = {
  sparkle: ['..#..', '..#..', '##.##', '..#..', '..#..'],
  heart: ['.#.#.', '#####', '#####', '.###.', '..#..'],
  bang: ['##', '##', '##', '##', '..', '##'],
  dots: ['#.#.#'],
  zzz: ['####', '..#.', '.#..', '####'],
  swirl: ['.###.', '#...#', '#.#.#', '#..#.', '.##..'],
  drop: ['.#.', '###', '###', '.#.'],
  moon: ['..###.', '.##...', '##....', '##....', '##....', '.##...', '..###.'],
};
function markSvg(name, cell, colour) {
  const rows = MARKS[name]; let r = '';
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') r += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`; }));
  return `<svg width="${rows[0].length * cell}" height="${rows.length * cell}" shape-rendering="crispEdges" fill="${colour}">${r}</svg>`;
}

// the pixel ground: rows of colour under a stepped top edge, with a few flowers
function groundSvg(ground, w, h, shift, dots, clear = () => false) {
  const g = GROUNDS[ground], cell = 12, cols = Math.ceil(w / cell), rows = Math.ceil(h / cell);
  let rects = '';
  for (let i = 0; i < cols; i++) {
    const t = Math.round(1.2 + 1.1 * Math.sin((i + shift) / 8) + Math.sin((i + shift) / 2.6) * 0.5);
    rects += `<rect x="${i * cell}" y="${t * cell}" width="${cell}" height="${h}" fill="${g.rows[0]}"/>`;
    rects += `<rect x="${i * cell}" y="${(t + 3) * cell}" width="${cell}" height="${h}" fill="${g.rows[1]}"/>`;
    rects += `<rect x="${i * cell}" y="${(t + 7) * cell}" width="${cell}" height="${h}" fill="${g.rows[2]}"/>`;
  }
  dots.forEach(([a, b], n) => { const x = Math.floor(a * cols) * cell, y = (4 + Math.floor(b * Math.max(1, rows - 5))) * cell; if (clear(x, y)) return; rects += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${g.dots[n % g.dots.length]}"/>`; });
  return `<svg class="ground" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="crispEdges" preserveAspectRatio="none">${rects}</svg>`;
}

// one card's choices. page: { at, family, title, line?, bubble?, logo?, label?, props?, bot?, pose?, flip? }.
// salt makes a different card when two would match
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
  const prop = page.props?.length ? page.props[Math.floor(r() * page.props.length)] : null;
  return {
    at: page.at, family: page.family, field: page.field || fam.field, ground: page.ground || fam.ground, label: page.label_chip ?? fam.label,
    title: page.title, line: page.line || '', bubble: page.bubble || '', url: page.url || '',
    bot: { shape, colour }, pose, flip: page.flip ?? false,
    tile: page.logo || page.label ? { logo: page.logo || null, label: page.label || null, vs: !!page.vs } : null,
    prop, extra: page.extra || null, crowd: page.crowd || null,
    shift: Math.round(r() * 200), dots: Array.from({ length: 22 }, () => [r(), r()]), clouds: [r(), r()], sparks: Array.from({ length: 7 }, () => [r(), r()]),
    dark: !!fam.dark,
  };
}
export const cardSignature = (s) => [s.family, s.bot.shape, s.bot.colour, s.pose, s.tile?.logo || s.tile?.label || '', s.prop || ''].join('|');

export function cardAlt(s, PROPS = {}) {
  const who = (c) => `${BOT_WORDS[c[1]] || c[1]} ${c[0] === 'kit' ? 'cat bot' : 'pixel bot'}`;
  const bot = s.crowd ? `a big ${who(s.crowd[0])} with ${s.crowd.length - 1} small pixel bots at its feet` : `a big ${BOT_WORDS[s.bot.colour] || s.bot.colour} ${s.bot.shape === 'kit' ? 'cat bot' : 'pixel bot'}, ${POSES[s.pose].words}`;
  const beside = s.tile ? (s.tile.logo ? ` beside the ${s.tile.label || s.tile.logo} mark` : ` beside a tile saying ${s.tile.label}`) : s.prop && PROPS[s.prop] ? ` beside ${PROPS[s.prop]}` : '';
  return `share card: ${bot}${beside}${s.bubble ? `, saying "${s.bubble}"` : ''}, on ${GROUNDS[s.ground].words}, and the words "${s.title}"`;
}

// kitDir: public/landing/art (file urls), font: the general sans file url, mark: the app icon file url
export function cardHtml(s, { kitDir, font, mark, square = false, sizes = {} }) {
  const W = 1200, H = square ? 1200 : 630;
  const groundH = square ? 470 : 118;
  const floor = H - groundH + 22;
  const ink = s.dark ? '#f4f2ff' : INK;
  const big = square ? 470 : 330;
  // the stage: right of the title on the wide card, the top two thirds on the square one
  const stageL = square ? 140 : 700, stageR = square ? 1080 : 1168;
  const bot = s.crowd ? null : botSvg(s.bot.shape, s.bot.colour, s.pose, { grid: 26, flip: s.flip });
  const parts = [];
  const shadow = (cx, w) => `<div class="shadow" style="left:${Math.round(cx - w / 2)}px;top:${floor - 12}px;width:${Math.round(w)}px"></div>`;
  let headBox = null;
  if (bot) {
    // the companion (app tile, name tile or object) and the bot share the stage; which side is the flip
    const hasMate = s.tile || s.prop;
    const tileSize = square ? 210 : 158;
    let mateW = 0, mateH = 0, mateHtml = null;
    if (s.tile) {
      mateW = tileSize; mateH = tileSize;
      const label = s.tile.label || '';
      const inner = s.tile.logo ? `<img src="${s.tile.logo.startsWith('file:') ? s.tile.logo : `${kitDir}/${s.tile.logo}`}" alt="">` : `<span class="fit ${label.length <= 4 ? 'l1' : label.length <= 9 ? 'l2' : 'l3'}">${esc(label)}</span>`;
      mateHtml = (x) => `<div class="tile" style="left:${x}px;top:${floor - tileSize - 8}px;width:${tileSize}px;height:${tileSize}px">${inner}</div>${s.tile.vs ? `<div class="vs" style="left:${x + tileSize / 2 - 34}px;top:${floor - tileSize - 58}px">vs</div>` : ''}`;
    } else if (s.prop) {
      const [pw, ph] = sizes[s.prop] || [420, 420];
      mateH = Math.round(Math.min(ph, 420) * (square ? 0.66 : 0.5)); mateW = Math.round(pw * mateH / ph);
      const file = s.prop.startsWith('p-') ? `kit/${s.prop}.webp` : `${s.prop}.webp`;
      mateHtml = (x) => `<img class="prop" src="${kitDir}/${file}" style="left:${x}px;top:${floor - mateH + 6}px;width:${mateW}px;height:${mateH}px" alt="">`;
    }
    // a tile stands clear of the bot, an object tucks in behind it
    const gap = s.tile ? 14 : s.prop ? -18 : 0;
    const total = big + (hasMate ? mateW + gap : 0);
    const left0 = Math.round(stageL + (stageR - stageL - total) / 2);
    // mate on the left when flipped, on the right otherwise; the bot looks at it
    const botBox = s.flip && hasMate ? left0 + mateW + gap : left0;
    const mateX = s.flip ? left0 : left0 + big + gap;
    const botLeft = Math.round(botBox - big * bot.px / bot.G), botTop = Math.round(floor - big * (bot.pt + bot.G) / bot.G);
    parts.push(shadow(botBox + big / 2, big * 0.86));
    if (mateHtml && !s.tile) parts.push(mateHtml(Math.round(mateX)));
    parts.push(`<div class="bot" style="left:${botLeft}px;top:${botTop}px">${bot.svg(big, s.flip && !hasMate ? 'transform:scaleX(-1)' : '')}</div>`);
    if (mateHtml && s.tile) parts.push(mateHtml(Math.round(mateX)));
    headBox = { x: botBox, y: floor - big, w: big };
    const P = POSES[s.pose];
    if (P.mark) {
      // over the head, on the side away from the bubble
      const cell = square ? 10 : 8, w = MARKS[P.mark][0].length * cell, h = MARKS[P.mark].length * cell;
      const mx = Math.min(W - w - 24, s.flip ? botBox + big * 0.82 - w : botBox + big * 0.18), my = floor - big - h - (square ? 30 : 22);
      parts.push(`<div class="mark" style="left:${Math.round(mx)}px;top:${Math.round(my)}px">${markSvg(P.mark, cell, s.dark ? '#fff3a0' : P.mark === 'heart' ? '#f12b93' : INK)}</div>`);
    }
  } else {
    // a crowd: the first bot big in the middle of the stage, the rest small at its feet, in front of it
    const [lead, ...cast] = s.crowd, size = square ? 400 : 270, small = square ? 170 : 116;
    const cx = square ? 600 : 935, place = (shape, colour, pose, sz, x) => {
      const b = botSvg(shape, colour, pose || 'open', { grid: sz > 200 ? 26 : 22 });
      parts.push(shadow(x + sz / 2, sz * 0.82));
      parts.push(`<div class="bot" style="left:${Math.round(x - sz * b.px / b.G)}px;top:${Math.round(floor - sz * (b.pt + b.G) / b.G)}px">${b.svg(sz)}</div>`);
    };
    place(...lead, size, cx - size / 2);
    // left, right, then further out on each side
    const slots = [cx - size / 2 - small * 0.62, cx + size / 2 - small * 0.38, cx - size / 2 - small * 1.62, cx + size / 2 + small * 0.66];
    cast.slice(0, 4).forEach((c, i) => place(...c, small, Math.min(slots[i], (square ? 1150 : 1188) - small)));
    headBox = { x: cx - size / 2, y: floor - size, w: size };
  }
  if (s.extra) parts.push(s.extra({ W, H, floor, square, kitDir, stageL, stageR }));
  // the bubble: what the bot is saying, above its head
  let bubble = '';
  if (s.bubble && headBox) {
    const maxW = square ? 520 : 400;
    const flip = s.flip && !s.crowd;
    const at = flip ? `right:${Math.round(W - (headBox.x + headBox.w * 0.62))}px` : `left:${Math.round(headBox.x + headBox.w * 0.4)}px`;
    bubble = `<div class="bubble${flip ? ' r' : ''}" style="${at};bottom:${Math.round(H - headBox.y + (square ? 34 : 26))}px;max-width:${maxW}px">${esc(s.bubble)}</div>`;
  }
  const clouds = s.dark ? `<div class="mark" style="left:${square ? 980 : 1080}px;top:${square ? 70 : 44}px">${markSvg('moon', square ? 14 : 10, '#fff3a0')}</div>` : s.clouds.map((c, i) => `<img class="cloud" src="${kitDir}/cloud-${i ? 'pink' : 'lemon'}.png" style="left:${Math.round((square ? 60 : 640) + c * (square ? 860 : 380))}px;top:${Math.round((square ? 40 : 30) + i * (square ? 90 : 46) + c * 20)}px;opacity:${s.field === '#c9f63f' || s.field === '#fff3a0' ? 0.9 : 1}" alt="">`).join('');
  const sparks = s.sparks.map(([a, b], i) => `<i class="spark" style="left:${Math.round((square ? 40 : 620) + a * (square ? 1100 : 560))}px;top:${Math.round(20 + b * (square ? 260 : 200))}px;${i % 3 ? '' : 'width:16px;height:16px;'}"></i>`).join('');
  const textTop = square ? H - groundH + 110 : 132;
  const textW = square ? 1040 : 600;
  const textH = square ? 236 : floor - 132 - 70;
  const fit = s.title.length;
  const title = `<div class="text" style="top:${textTop}px;width:${textW}px;height:${textH}px"><h1 style="font-size:${square ? (fit < 14 ? 150 : fit < 30 ? 104 : 82) : fit < 12 ? 124 : fit < 24 ? 96 : fit < 40 ? 74 : 64}px">${esc(s.title).replace(/(\S+-\S+)/g, '<span class="nb">$1</span>')}</h1>${s.line ? `<p>${esc(s.line)}</p>` : ''}</div>`;
  const chip = s.label ? `<div class="chip" style="top:${square ? H - groundH + 40 : 58}px"><img src="${mark}" alt="">${esc(s.label)}</div>` : '';
  const url = s.url ? `<div class="url" style="${square ? 'bottom:56px' : 'bottom:30px'}">${esc(s.url)}</div>` : '';
  return `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: "General Sans"; src: url("${font}"); font-weight: 200 700; }
* { box-sizing: border-box; margin: 0; }
body { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${s.field}; font-family: "General Sans"; color: ${ink}; -webkit-font-smoothing: antialiased; }
.ground { position: absolute; left: 0; bottom: 0; }
.bot, .prop, .tile, .mark, .cloud, .shadow, .vs, .spark { position: absolute; }
.bot svg { display: block; overflow: visible; }
.prop, .cloud { image-rendering: pixelated; }
.cloud { width: ${square ? 240 : 180}px; height: ${square ? 80 : 60}px; }
.spark { width: 8px; height: 8px; background: ${s.dark ? '#fff3a0' : '#ffffff'}; opacity: ${s.dark ? 0.9 : 0.75}; }
.shadow { height: 24px; border-radius: 50%; background: rgba(27,27,31,0.13); }
.tile { display: grid; place-items: center; border-radius: 26%; background: #fff; box-shadow: 0 12px 0 rgba(27,27,31,0.1); }
.tile img { width: 58%; height: 58%; object-fit: contain; }
.tile span { display: block; max-width: 100%; font-weight: 600; letter-spacing: -0.03em; text-align: center; padding: 12px; line-height: 1.02; color: ${INK}; }
.tile .l1 { font-size: ${square ? 84 : 64}px; } .tile .l2 { font-size: ${square ? 40 : 31}px; } .tile .l3 { font-size: ${square ? 30 : 23}px; }
.vs { width: 68px; height: 44px; display: grid; place-items: center; background: ${INK}; color: #fff3a0; font-size: 26px; font-weight: 600; letter-spacing: -0.02em; border-radius: 12px; }
.bubble { position: absolute; padding: ${square ? '18px 26px' : '14px 22px'}; border-radius: 26px 26px 26px 6px; background: #fff; color: ${INK}; font-size: ${square ? 36 : 28}px; font-weight: 550; line-height: 1.15; letter-spacing: -0.025em; box-shadow: 0 8px 0 rgba(27,27,31,0.08); width: max-content; }
.bubble.r { border-radius: 26px 26px 6px 26px; }
.text { position: absolute; left: ${square ? 80 : 64}px; display: flex; flex-direction: column; justify-content: ${square ? 'flex-start' : 'center'}; }
.nb { white-space: nowrap; }
h1 { font-weight: 600; line-height: 1.02; letter-spacing: -0.05em; text-wrap: balance; }
.text p { margin-top: ${square ? 22 : 18}px; font-size: ${square ? 38 : 30}px; font-weight: 500; line-height: 1.2; letter-spacing: -0.02em; opacity: 0.72; text-wrap: balance; }
.chip { position: absolute; left: ${square ? 80 : 64}px; display: flex; align-items: center; gap: 12px; height: ${square ? 56 : 48}px; padding: 0 ${square ? 24 : 20}px 0 ${square ? 8 : 6}px; border-radius: 99px; background: ${s.dark ? '#f4f2ff' : INK}; color: ${s.dark ? INK : s.field === '#eaf6fd' ? '#c9f63f' : s.field}; font-size: ${square ? 28 : 24}px; font-weight: 600; letter-spacing: -0.02em; }
.chip img { width: ${square ? 42 : 36}px; height: ${square ? 42 : 36}px; border-radius: 26%; }
.url { position: absolute; left: ${square ? 80 : 64}px; font-size: ${square ? 30 : 23}px; font-weight: 600; letter-spacing: -0.02em; color: ${INK}; opacity: 0.78; }
</style>${sparks}${clouds}${groundSvg(s.ground, W, groundH, s.shift, s.dots, square ? (x, y) => y > 70 : (x, y) => x < 640 && y > 50)}${parts.join('')}${bubble}${chip}${title}${url}
<script>
// the title fits its box: shrink until it does, never below 46px (render.py waits for this)
(async () => { await document.fonts.ready; const box = document.querySelector('.text'), h = box.querySelector('h1');
  const bb = document.querySelector('.bubble'); if (bb) { const r = bb.getBoundingClientRect(); if (r.right > innerWidth - 24) bb.style.left = (parseFloat(bb.style.left) - (r.right - innerWidth + 24)) + 'px'; if (r.left < 24 && bb.style.right) bb.style.right = (parseFloat(bb.style.right) - (24 - r.left)) + 'px'; }
  for (const t of document.querySelectorAll('.fit')) { let z = parseFloat(getComputedStyle(t).fontSize); while ((t.scrollWidth > t.clientWidth || t.scrollHeight > t.parentNode.clientHeight - 12) && z > 12) { z -= 1; t.style.fontSize = z + 'px'; } }
  let f = parseFloat(h.style.fontSize); while ((box.scrollHeight > box.clientHeight + 1 || h.scrollWidth > box.clientWidth + 1) && f > 46) { f -= 2; h.style.fontSize = f + 'px'; }
  document.body.dataset.ready = '1'; })();
</script>`;
}

// each kit object's size in pixels, for laying it out
export function kitSizes(kitDir, names) {
  const size = (file) => { const b = fs.readFileSync(file), k = b.toString('ascii', 12, 16); if (k === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]; if (k === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]; const n = b.readUInt32LE(21); return [1 + (n & 0x3fff), 1 + ((n >> 14) & 0x3fff)]; };
  return Object.fromEntries(names.map((p) => { const f = path.join(kitDir, p.startsWith('p-') ? `kit/${p}.webp` : `${p}.webp`); return [p, fs.existsSync(f) ? size(f) : [420, 420]]; }));
}
