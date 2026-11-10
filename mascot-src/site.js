// the home page's bots, run by the app's own mascot code in app/: the engine draws and moves them, the app's mark
// controller decides when they play, rest, blink and doze, and its persona and click reactor pick their idle acts and
// answers. this file finds the bots, makes each one when it comes near the screen, points them at the pointer the way
// the app does, and tells them what is going on around them on the page.
import { createMark, hoverGaze } from './app/mascot-motion-mark';
import { mascotClock } from './app/mascot-clock';
import { ATTENTION, attentionGaze, watchPointer } from './app/mascot-attention';
import { MARK_FILL, markFillScale } from './app/mascot-motion-engine';

const query = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = query.matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const FIT = markFillScale(MARK_FILL);
const SVG = 'http://www.w3.org/2000/svg';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const later = (ms, fn) => setTimeout(fn, ms);
const between = (min, max) => min + Math.random() * (max - min);
// the app only lets marks of 48 px and up notice a pointer nearby; the site's small bots get the same reach as one
const REACH_PX = 64;
// the bots in the where cards are the app's sidebar rows, drawn by hand; each name is its app body
const WHERE = { echo: 'heart', quill: 'leaf', nova: 'crystal', juno: 'cloud', basil: 'clover', moss: 'pebble', rivet: 'cylinder', tally: 'square' };

const bots = new Map();
let made = 0;

function enlist(host, body, seed, extra = {}) {
  const rec = { host, body, seed, eye: undefined, canvas: $('.mk', host), state: 'idle', mark: null, near: false, rect: null, rectAt: -Infinity, look: null, timer: 0, ...extra };
  bots.set(host, rec);
  return rec;
}
// the page's bots wear the app's white face, so a picture behind them never shows through their eyes
for (const el of $$('svg.bot[data-body]')) enlist(el, el.dataset.body, `${el.dataset.body}-${(/\bc-(\w+)/.exec(el.getAttribute('class')) || [])[1]}`, { eye: '#fff' });
$$('.sea-bots .sb[data-body]').forEach((el, i) => enlist(el, el.dataset.body, `sea-${i}`, { eye: '#fff', sea: true }));
for (const el of $$('svg.wa-av')) {
  const name = (/\bwa-c-(\w+)/.exec(el.getAttribute('class')) || [])[1];
  if (WHERE[name]) enlist(el, WHERE[name], name, { where: true });
}
const hero = $('.h-mark');
if (hero && bots.has(hero)) bots.get(hero).seed = 'dusk';

function sizeOf(rec) {
  if (!rec.sea) return rec.host.getBoundingClientRect().width;
  const box = rec.host.ownerSVGElement.getBoundingClientRect();
  return (box.width / 1600) * Number(rec.host.dataset.size);
}

// the where cards were drawn without a canvas: swap their picture for one, laid out like the app's (0.92 / 0.6 wide)
function canvasFor(rec) {
  if (rec.canvas) return rec.canvas;
  const box = rec.host.viewBox.baseVal, span = box.width * FIT;
  const c = document.createElementNS(SVG, 'svg');
  c.setAttribute('class', 'mk');
  for (const [k, v] of [['x', box.x + (box.width - span) / 2], ['y', box.y + (box.height - span) / 2], ['width', span], ['height', span]]) c.setAttribute(k, v.toFixed(2));
  rec.host.style.color = 'var(--wa-ink)';
  rec.host.replaceChildren(c);
  return (rec.canvas = c);
}

function make(rec) {
  if (rec.mark) return rec.mark;
  const size = sizeOf(rec);
  if (!(size > 0)) return null;
  rec.mark = createMark({
    id: `bm${++made}`, seed: rec.seed, body: rec.body, ink: 'currentColor', eye: rec.eye, state: rec.state, sizePx: size,
    isLive: true, isPlaying: true, isEmphasized: false, isReducedMotion: reduced, hasPersonality: true,
    maxFrameRate: size <= 24 ? 30 : undefined,
  }, { clock: mascotClock(), now: () => performance.now() });
  rec.mark.attach(canvasFor(rec), rec.host);
  return rec.mark;
}

// marks are made in idle time as they come within 480 px of the screen (the app's draw-ahead); until then each shows
// the rest pose the build drew, which is what a fresh mark draws first anyway
const queue = new Set();
let queued = false;
const idle = window.requestIdleCallback ? (fn) => requestIdleCallback(fn, { timeout: 500 }) : (fn) => setTimeout(() => fn({ timeRemaining: () => 8 }), 40);
function drain(deadline) {
  queued = false;
  for (const rec of queue) {
    queue.delete(rec);
    if (rec.near) make(rec);
    if (deadline.timeRemaining() < 5) break;
  }
  if (queue.size && !queued) { queued = true; idle(drain); }
}
function want(rec) {
  if (rec.mark || reduced) return;
  queue.add(rec);
  if (!queued) { queued = true; idle(drain); }
}
const nearby = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const e of entries) {
    const rec = bots.get(e.target);
    if (!rec) continue;
    rec.near = e.isIntersecting;
    if (rec.near) want(rec);
    else if (rec.look) release(rec);
  }
}, { rootMargin: '480px' }) : null;
for (const rec of bots.values()) nearby ? nearby.observe(rec.host) : ((rec.near = true), want(rec));

const botOf = (el) => bots.get(el) || (el?.closest && bots.get(el.closest('svg.bot, .sb, svg.wa-av'))) || null;
const botsIn = (el) => (el ? [...bots.values()].filter((rec) => el.contains(rec.host)) : []);
function react(rec, kind) {
  if (rec && !reduced) make(rec)?.react(kind);
}
function setState(rec, state) {
  if (!rec || rec.state === state) return;
  rec.state = state;
  // a still page keeps the still pose, but the face can still change: make the mark only when it has one to show
  (rec.mark || make(rec))?.update({ state });
}
function playClip(rec, name) {
  if (rec && !reduced) make(rec)?.playClip(name);
}

// the pointer: a bot under it turns to it the way the app's hover gaze does; one near it looks over, as the app's
// bigger marks do, and loses interest once the pointer rests (the app's attention, one shared listener)
function release(rec) {
  clearTimeout(rec.timer);
  if (!rec.look) return;
  rec.look = null;
  rec.mark?.gaze(null);
}
function aim(rec, point, now) {
  if (now - rec.rectAt > ATTENTION.rectMs) { rec.rect = rec.host.getBoundingClientRect(); rec.rectAt = now; }
  const r = rec.rect;
  let gaze;
  if (point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom) gaze = hoverGaze(r, point.x, point.y);
  else {
    const s = Math.max(r.width, r.height, REACH_PX);
    gaze = attentionGaze({ left: r.left + r.width / 2 - s / 2, top: r.top + r.height / 2 - s / 2, width: s, height: s }, point);
  }
  if (!gaze) return release(rec);
  clearTimeout(rec.timer);
  rec.timer = setTimeout(() => release(rec), ATTENTION.holdMs);
  if (rec.look && rec.look.x === gaze.x && rec.look.y === gaze.y) return;
  rec.look = gaze;
  rec.mark.gaze(gaze);
}
let seaWatch = null;
if (!reduced) {
  watchPointer((point) => {
    const now = performance.now();
    for (const rec of bots.values()) {
      if (!rec.mark || !rec.near || rec.sea) continue;
      if (point) aim(rec, point, now);
      else release(rec);
    }
    seaWatch?.(point);
  });
  addEventListener('scroll', () => { for (const rec of bots.values()) rec.rectAt = -Infinity; }, { passive: true });
}

// a click on a bot is the app's tap: a small answer most times, and quick repeats escalate to a twirl, then dizzy
document.addEventListener('click', (e) => {
  const rec = botOf(e.target) || botOf(e.target.closest?.('[data-own]')?.querySelector('svg.bot'));
  if (rec) react(rec, 'tap');
});

// for the rest of the page: duskBots.react(el, 'hop'), duskBots.state(el, 'working'); el is a bot or anything around bots
window.duskBots = {
  react: (el, kind) => (botOf(el) ? [botOf(el)] : botsIn(el)).forEach((rec) => react(rec, kind)),
  state: (el, state) => (botOf(el) ? [botOf(el)] : botsIn(el)).forEach((rec) => setState(rec, state)),
};

query.addEventListener?.('change', (e) => {
  reduced = e.matches;
  for (const rec of bots.values()) rec.mark?.update({ isReducedMotion: reduced });
});

// runs fn each time el comes on screen or leaves it
function watch(el, fn, threshold = 0) {
  if (!el || !nearby) return;
  new IntersectionObserver((es) => fn(es[es.length - 1].isIntersecting), { threshold }).observe(el);
}
const hover = (el, fn) => fine && el?.addEventListener('pointerenter', fn);

// the pink bot in the headline: says hi once it is seen, and wiggles when the pointer comes onto the headline
if (hero) {
  const rec = bots.get(hero);
  let greeted = false, wiggled = 0;
  watch(hero, (on) => { if (on && !greeted) { greeted = true; later(900, () => react(rec, 'greet')); } }, 0.6);
  hover(hero.closest('h1'), () => {
    if (performance.now() - wiggled < 2600) return;
    wiggled = performance.now();
    react(rec, 'wiggle');
  });
}

// a row of the team, or of the where cards: pointing at it is the app's row select, a small answer from its bot
for (const li of $$('.team-rows li, .wa-row')) hover(li, () => { for (const rec of botsIn(li)) react(rec, 'open'); });

// nova's computer: it works while its pointer reads the fares, and is pleased once it holds the cheapest
const browse = $('[data-play="browse"]');
const held = browse && $('.fares u', browse);
if (held) {
  const nova = botOf($('.fig-head svg.bot', browse.closest('figure') || browse.parentElement));
  let done = 0;
  new MutationObserver(() => {
    clearTimeout(done);
    if (!held.classList.contains('held')) return setState(nova, 'working');
    if (nova?.state !== 'working') return;
    setState(nova, 'finished');
    done = later(5200, () => setState(nova, 'idle'));
  }).observe(held, { attributes: true, attributeFilter: ['class'] });
}

// routines: switched off, its bot goes to sleep; switched back on, it is happy for a moment, then idles
for (const toggle of $$('.rows .toggle')) {
  const rec = botOf($('svg.bot', toggle.closest('li')));
  if (!rec) continue;
  let back = 0;
  const sync = (first) => {
    clearTimeout(back);
    if (toggle.getAttribute('aria-checked') === 'false') return setState(rec, 'sleeping');
    if (first) return;
    setState(rec, 'happy');
    back = later(3700, () => setState(rec, 'idle'));
  };
  sync(true);
  new MutationObserver(() => sync(false)).observe(toggle, { attributes: true, attributeFilter: ['aria-checked'] });
}

// nova's notes: it nods along while you edit the note it keeps
const note = $('[data-note]');
if (note) {
  const rec = botOf($('.fig-head svg.bot', note.closest('figure') || document));
  let nodded = 0;
  note.addEventListener('input', () => {
    if (performance.now() - nodded < 1500) return;
    nodded = performance.now();
    react(rec, 'nod');
  });
}

// the room: once it is read, each bot answers being tagged, in the order of the messages; pointing at a tag again
// gets the same answer from that bot
const room = $('.chan');
if (room) {
  const tagged = (colour) => $$(`svg.bot.c-${colour}`, room).map(botOf).filter(Boolean);
  const all = (colour, kind) => tagged(colour).forEach((rec) => react(rec, kind));
  let read = false;
  watch(room, (on) => {
    if (!on || read) return;
    read = true;
    later(300, () => all('orange', 'nod'));
    later(1100, () => all('yellow', 'hop'));
    later(2100, () => all('pink', 'greet'));
  }, 0.6);
  for (const at of $$('.at.yellow, .at.pink', room)) hover(at, () => all(at.classList.contains('yellow') ? 'yellow' : 'pink', 'hop'));
}

// the terraces: each bot works on its task, finishes it (the app's done, happy), rests a little, then takes the next
// one, on its own clock. only while the strip is on screen
const terraces = $$('.terr .tb svg.bot').map(botOf).filter(Boolean);
if (terraces.length && !reduced) {
  let on = false;
  const shift = (rec, wait) => {
    clearTimeout(rec.shift);
    rec.shift = later(wait, () => {
      if (!on) return;
      setState(rec, 'working');
      rec.shift = later(between(6500, 11000), () => {
        if (!on) return;
        setState(rec, 'finished');
        rec.shift = later(between(4200, 6500), () => {
          if (!on) return;
          setState(rec, 'idle');
          shift(rec, between(2500, 6000));
        });
      });
    });
  };
  watch($('.terr'), (now) => {
    if (now === on) return;
    on = now;
    terraces.forEach((rec, i) => {
      if (on) shift(rec, 400 + i * 650);
      else { clearTimeout(rec.shift); setState(rec, 'idle'); }
    });
  });
}

// the four steps: pointing at one makes its terrace bot hop, and the bots in the create-a-bot card say hi in a row
for (const li of $$('.steps > li')) hover(li, () => {
  react(botOf($(`.terr .t${li.dataset.step} svg.bot`)), 'hop');
  botsIn($('.shapes', li)).forEach((rec, i) => later(i * 70, () => react(rec, 'hop')));
});

// the bot beside the questions: it reads along when one opens, then nods
const listener = botOf($('.listener svg.bot'));
if (listener) {
  let nod = 0;
  for (const d of $$('.qs details')) d.addEventListener('toggle', () => {
    if (!d.open) return;
    clearTimeout(nod);
    setState(listener, 'curious');
    nod = later(2400, () => { setState(listener, 'idle'); react(listener, 'nod'); });
  });
}

// the sea in the last picture: the bots come up one by one the first time it is seen, watch the pointer from across the
// water, and when it gets close they duck under, coming back up a moment later
const end = $('.end'), water = $('.sea-bots');
if (end && water && nearby && !reduced) {
  const box = water.viewBox.baseVal;
  const crew = $$('.sb', water).map((el) => {
    const m = el.transform.baseVal.consolidate().matrix;
    return { el, rec: bots.get(el), x: m.e + 50 * m.a, y: m.f + 45 * m.a, size: 100 * m.a, under: false, timer: 0, look: null };
  });
  let live = false, shown = false, bobbing = 0, letGo = 0;
  const up = (b) => {
    b.under = false;
    b.el.classList.remove('dive');
    b.rec.mark?.blink();
  };
  const dive = (b, ms) => {
    b.under = true;
    b.el.classList.add('dive');
    clearTimeout(b.timer);
    b.timer = later(ms, () => up(b));
  };
  const surface = () => {
    shown = true;
    [...crew].sort(() => Math.random() - 0.5).forEach((b, i) => later(250 + i * 140, () => {
      b.el.classList.add('up');
      if (Math.random() < 0.5) playClip(b.rec, 'Perk');
    }));
  };
  end.classList.add('arm');
  watch(end, (on) => {
    live = on;
    end.classList.toggle('off', !on);
    clearInterval(bobbing);
    if (!on) return;
    if (!shown) surface();
    bobbing = setInterval(() => {
      const free = crew.filter((b) => !b.under);
      if (free.length) dive(free[Math.floor(Math.random() * free.length)], 520);
    }, 2600);
  });
  const rest = () => crew.forEach((b) => { if (b.look) { b.look = null; b.rec.mark?.gaze(null); } });
  seaWatch = (point) => {
    if (!live) return;
    if (!point) return rest();
    const r = water.getBoundingClientRect(), k = r.width / box.width;
    for (const b of crew) {
      const dx = point.x - (r.left + b.x * k), dy = point.y - (r.top + b.y * k), d = Math.hypot(dx, dy) || 1;
      // from far away: the app's attention curve, spread over the whole picture
      const reach = Math.max(320, r.width * 0.3), t = Math.tanh(d / reach) / (d / reach) * ATTENTION.strength;
      const gaze = { x: Math.round((dx / reach) * t * 100) / 100, y: Math.round((dy / reach) * t * 100) / 100 };
      if (b.rec.mark && (!b.look || b.look.x !== gaze.x || b.look.y !== gaze.y)) { b.look = gaze; b.rec.mark.gaze(gaze); }
      if (d > 22 + b.size * k || b.under) continue;
      // a plain, quick duck reads smoother than a startle followed by a drop
      dive(b, between(900, 1700));
    }
    clearTimeout(letGo);
    letGo = later(ATTENTION.holdMs, rest);
  };
}
