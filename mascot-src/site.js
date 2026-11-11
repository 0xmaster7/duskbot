// the home page's bots: engine/ draws and moves them; this file finds them, points them at the pointer, and tells them
// what is going on around them on the page
import { create, pointerGaze } from './engine/index.js';

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const later = (ms, fn) => setTimeout(fn, ms);
const between = (min, max) => min + Math.random() * (max - min);
// pointer look-about lasts this long after the pointer stops moving
const HOLD_MS = 2600;

const bots = new Map();
for (const el of $$('svg.bot[data-body]')) bots.set(el, { el, bot: create(el) });
$$('.sea-bots .sb[data-body]').forEach((el) => bots.set(el, { el, sea: true, bot: create(el, { size: 30 }) }));

const botOf = (el) => bots.get(el) || (el?.closest && bots.get(el.closest('svg.bot, .sb'))) || null;
const botsIn = (el) => (el ? [...bots.values()].filter((rec) => el.contains(rec.el)) : []);
const react = (rec, kind) => rec?.bot.react(kind);
const setState = (rec, state) => rec?.bot.setState(state);

// the pointer: bots within reach turn their eyes and lean toward it, and look about again once it rests
const hero = botOf($('.h-mark'));
let seaWatch = null;
if (!still && fine) {
  let point = null, pending = false, rest = 0;
  const rects = new Map();
  const aim = () => {
    pending = false;
    for (const rec of bots.values()) {
      if (rec.sea) continue;
      if (!point) { rec.bot.lookAt(null); continue; }
      let r = rects.get(rec);
      if (!r) rects.set(rec, (r = rec.el.getBoundingClientRect()));
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const g = pointerGaze(r, point.x, point.y, Math.max(180, r.width * 4.5));
      rec.bot.lookAt(g ? g.x : null, g?.y);
    }
    seaWatch?.(point);
  };
  const ask = () => { if (!pending) { pending = true; requestAnimationFrame(aim); } };
  addEventListener('pointermove', (e) => {
    point = { x: e.clientX, y: e.clientY };
    clearTimeout(rest);
    rest = later(HOLD_MS, () => { point = null; ask(); });
    ask();
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { point = null; ask(); });
  const forget = () => rects.clear();
  addEventListener('scroll', forget, { passive: true });
  addEventListener('resize', forget, { passive: true });
}

// a click on a bot is a tap: a small answer, and quick repeats spin, then escalate to a hop, a squish and dizzy
document.addEventListener('click', (e) => {
  const rec = botOf(e.target) || botOf(e.target.closest?.('[data-own]')?.querySelector('svg.bot'));
  if (rec) react(rec, 'tap');
});

// for the rest of the page: duskBots.react(el, 'hop'), duskBots.state(el, 'working'); el is a bot or anything around bots
window.duskBots = {
  react: (el, kind) => (botOf(el) ? [botOf(el)] : botsIn(el)).forEach((rec) => react(rec, kind)),
  state: (el, state) => (botOf(el) ? [botOf(el)] : botsIn(el)).forEach((rec) => setState(rec, state)),
};

// runs fn each time el comes on screen or leaves it
function watch(el, fn, threshold = 0) {
  if (!el || !('IntersectionObserver' in window)) return;
  new IntersectionObserver((es) => fn(es[es.length - 1].isIntersecting), { threshold }).observe(el);
}
const hover = (el, fn) => fine && el?.addEventListener('pointerenter', fn);

// the bot in the headline: says hi once it is seen, and wiggles when the pointer comes onto the headline
if (hero) {
  let greeted = false, wiggled = 0;
  watch(hero.el, (on) => { if (on && !greeted) { greeted = true; later(900, () => react(hero, 'greet')); } }, 0.6);
  hover(hero.el.closest('h1'), () => {
    if (performance.now() - wiggled < 2600) return;
    wiggled = performance.now();
    react(hero, 'wiggle');
  });
}

// a row of the team, or of the where cards: pointing at it gets a small answer from its bot
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
    if (nova?.bot.state !== 'working') return;
    setState(nova, 'finished');
    done = later(5200, () => setState(nova, 'idle'));
  }).observe(held, { attributes: true, attributeFilter: ['class'] });
}

// routines: switched off, its bot goes to sleep; switched back on, it wakes, is happy for a moment, then idles
for (const toggle of $$('.rows .toggle')) {
  const rec = botOf($('svg.bot', toggle.closest('li')));
  if (!rec) continue;
  let back = 0;
  const sync = (first) => {
    clearTimeout(back);
    if (toggle.getAttribute('aria-checked') === 'false') return setState(rec, 'sleeping');
    if (first) return;
    setState(rec, 'happy');
    react(rec, 'hop');
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
  const all = (colour, kind) => $$(`svg.bot.c-${colour}`, room).map(botOf).forEach((rec) => react(rec, kind));
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

// the terraces: each bot works on its task, finishes it (happy, a hop), rests a little, then takes the next one, on
// its own clock. only while the strip is on screen
const terraces = $$('.terr .tb svg.bot').map(botOf).filter(Boolean);
if (terraces.length && !still) {
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

// the four steps: pointing at one makes its terrace bot hop, and the bots in the create-a-bot card hop in a row
for (const li of $$('.steps > li')) hover(li, () => {
  react(botOf($(`.terr .t${li.dataset.step} svg.bot`)), 'hop');
  botsIn($('.shapes', li)).forEach((rec, i) => later(i * 70, () => react(rec, 'hop')));
});

// the bot beside the questions: it listens with its head on one side when one opens, then nods
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
if (end && water && 'IntersectionObserver' in window && !still) {
  const box = water.viewBox.baseVal;
  const crew = $$('.sb', water).map((el) => {
    const m = el.transform.baseVal.consolidate().matrix;
    return { el, bot: bots.get(el).bot, x: m.e + 50 * m.a, y: m.f + 45 * m.a, size: 100 * m.a, under: false, timer: 0 };
  });
  let live = false, shown = false, bobbing = 0;
  const up = (b) => {
    b.under = false;
    b.el.classList.remove('dive');
    b.bot.blink();
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
      if (Math.random() < 0.5) b.bot.react('perk');
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
  seaWatch = (point) => {
    if (!live) return;
    if (!point) return crew.forEach((b) => b.bot.lookAt(null));
    const r = water.getBoundingClientRect(), k = r.width / box.width;
    for (const b of crew) {
      const dx = point.x - (r.left + b.x * k), dy = point.y - (r.top + b.y * k), d = Math.hypot(dx, dy) || 1;
      // from far away: a gentle look, spread over the whole picture
      const reach = Math.max(320, r.width * 0.3), t = Math.tanh(d / reach) / (d / reach);
      b.bot.lookAt((dx / reach) * t, (dy / reach) * t * 0.8);
      if (d > 22 + b.size * k || b.under) continue;
      dive(b, between(900, 1700));
    }
  };
}
