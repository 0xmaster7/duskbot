const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
const M = window.Motion;
const hasIO = 'IntersectionObserver' in window;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
// runs fn the first time enough of el is on screen
function once(el, fn, threshold = 0.4) {
  if (!el || !hasIO) return;
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { threshold });
  io.observe(el);
}

// the bots themselves (looks, blinks, moods, answers to a poke) are the app's mascot code, in mascot.js; this file
// only gives them something to say

const quips = ['hi', 'busy', 'on it', 'five more minutes', 'ok ok', 'that tickles', 'did you need something', 'working, promise', 'not the face', 'hire me', 'i was told there would be snacks'];
const sparkColours = ['#2f7bf2', '#ff7d1f', '#8d5cf0', '#ff5c9d', '#1fb866', '#f8c623'];
let said = 0;
function sayAt(x, y, text) {
  const q = document.createElement('span');
  q.className = 'quip'; q.textContent = text;
  q.style.left = `${Math.min(Math.max(x, 70), innerWidth - 70) + scrollX}px`; q.style.top = `${Math.max(y, 0) + scrollY}px`;
  document.body.append(q); setTimeout(() => q.remove(), 1500);
}
function say(el, text) { const r = el.getBoundingClientRect(); sayAt(r.left + r.width / 2, r.top, text); }
// a burst of little squares where something was poked
function sparkle(x, y) {
  if (still) return;
  for (let i = 0; i < 9; i++) {
    const s = document.createElement('i'), a = (Math.PI * 2 * i) / 9 + Math.random() * 0.5, d = 34 + Math.random() * 34;
    s.className = 'spark'; s.style.background = sparkColours[i % sparkColours.length];
    s.style.left = `${x + scrollX - 4}px`; s.style.top = `${y + scrollY - 4}px`;
    s.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(0)}px`); s.style.setProperty('--dy', `${(Math.sin(a) * d).toFixed(0)}px`);
    document.body.append(s); setTimeout(() => s.remove(), 720);
  }
}
const purrs = ['mrrp', 'zzz', 'five more minutes', 'not a bot'];
document.addEventListener('click', (e) => {
  const cat = e.target.closest?.('.cat img');
  if (cat) { say(cat, purrs[said++ % purrs.length]); sparkle(e.clientX, e.clientY); return; }
  const b = e.target.closest?.('.bot');
  if (!b || b.closest('[data-own]')) return;
  const asleep = b.closest('li')?.querySelector('[aria-checked="false"]');
  say(b, asleep ? 'zzz' : quips[said++ % quips.length]); sparkle(e.clientX, e.clientY);
});

// the bot beside the questions nods along
const listener = $('.listener'), hellos = ['hi', 'ask away', 'good question', 'i know this one', 'still free, by the way'];
if (listener) {
  listener.addEventListener('click', (e) => { say(listener, hellos[said++ % hellos.length]); sparkle(e.clientX || 0, e.clientY || 0); });
}

// the stickers in the big sentence can be picked up; they spring back when dropped
if (fine && !still) for (const el of $$('[data-sticker]')) {
  let id = null, sx = 0, sy = 0;
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; el.setPointerCapture(id); sx = e.clientX; sy = e.clientY; el.style.transition = 'none'; el.classList.add('held'); });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    el.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.max(-18, Math.min(18, dx / 12)).toFixed(1)}deg) scale(1.1)`;
  });
  const drop = () => { if (id === null) return; id = null; el.classList.remove('held'); el.style.transition = 'transform 0.6s cubic-bezier(0.3, 1.6, 0.5, 1)'; el.style.transform = ''; };
  el.addEventListener('pointerup', drop); el.addEventListener('pointercancel', drop);
}

// nova's computer: its pointer reads down the fares and holds the cheapest one, once. you can take the mouse
const view = $('[data-play="browse"]');
if (view) {
  const ptr = $('.ptr', view), rows = $$('.fares li', view), hold = $('u', rows[0]), take = $('[data-take]');
  const glide = 'transform 0.55s cubic-bezier(0.77, 0, 0.175, 1)';
  let held = false;
  const at = (el, dx, dy) => { const b = view.getBoundingClientRect(), r = el.getBoundingClientRect(); ptr.style.transform = `translate(${r.left - b.left + r.width / 2 - 4 + dx}px, ${r.top - b.top + r.height / 2 - 3 + dy}px)`; };
  const hot = (row) => rows.forEach((r) => r.classList.toggle('hot', r === row));
  const mark = (on) => { hold.classList.toggle('held', on); hold.textContent = on ? 'held' : 'hold'; };
  // once the fare is held the pointer parks in the open middle of the page, clear of the text
  const rest = () => { if (!held) at($('span', rows[1]), 30, 16); };
  ptr.classList.add('on'); rest();
  addEventListener('load', rest); addEventListener('resize', rest);
  if (!still) once(view, async () => {
    hot(null); mark(false);
    ptr.style.transition = 'none'; at($('em', rows[2]), 50, 40); await wait(350);
    ptr.style.transition = glide;
    for (const row of [rows[2], rows[1], rows[0]]) { if (held) return; at($('em', row), 0, 4); await wait(400); if (held) return; hot(row); await wait(260); }
    at(hold, 6, 4); await wait(620);
    if (held) return;
    hold.style.scale = '0.9'; await wait(140); hold.style.scale = ''; mark(true);
    await wait(450); if (!held) rest();
  }, 0.7);
  take.addEventListener('click', () => {
    held = !held;
    take.setAttribute('aria-pressed', held); take.textContent = held ? 'give it back' : 'take the mouse';
    view.style.cursor = held ? 'none' : '';
    ptr.style.transition = held ? 'none' : glide;
    if (!held) { hot(rows[0]); mark(true); rest(); }
  });
  view.addEventListener('pointermove', (e) => {
    if (!held) return;
    const b = view.getBoundingClientRect();
    ptr.style.transform = `translate(${e.clientX - b.left - 4}px, ${e.clientY - b.top - 3}px)`;
    hot(e.target.closest('.fares li'));
  });
}

// a routine switched off puts its bot to sleep (mascot.js); this is what it mumbles
for (const t of $$('.rows .toggle')) t.addEventListener('click', () => {
  if (!document.documentElement.classList.contains('mk-ready')) t.setAttribute('aria-checked', t.getAttribute('aria-checked') !== 'true');
  setTimeout(() => { const b = $('.bot', t.closest('li')); say(b, t.getAttribute('aria-checked') === 'true' ? 'back on it' : 'zzz'); });
});

// the newest note in the notebook types itself in once, and is really yours to edit. emptied, it goes back to what it said
const note = $('[data-note]');
if (note) {
  const said = note.textContent;
  try { note.contentEditable = 'plaintext-only'; } catch { note.contentEditable = 'true'; }
  note.setAttribute('role', 'textbox'); note.setAttribute('aria-label', 'a note you can edit'); note.spellcheck = false;
  note.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); note.blur(); } });
  note.addEventListener('input', () => { $('[data-note-foot]').textContent = 'edited by you. nova will remember'; });
  note.addEventListener('blur', () => { if (!note.textContent.trim()) note.textContent = said; });
  $('[data-edit]').addEventListener('click', () => { note.focus(); getSelection().selectAllChildren(note); getSelection().collapseToEnd(); });
  if (!still) once(note, async () => {
    for (let i = 1; i <= said.length; i++) { if (document.activeElement === note) return; note.textContent = said.slice(0, i); await wait(42); }
  }, 0.9);
}

const phone = $('[data-ring]'), calls = ['ring ring', "it's nova. found your flight", 'juno here. 3 emails need you', 'new phone who dis'];
phone?.addEventListener('click', () => { phone.classList.remove('ringing'); void phone.offsetWidth; phone.classList.add('ringing'); say(phone, calls[said++ % calls.length]); });

for (const b of $$('[data-copy]')) b.addEventListener('click', async () => {
  const label = b.dataset.label ||= b.textContent;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'copied'; }
  catch { const fig = b.closest('figure') || b.parentElement; getSelection().selectAllChildren($('code', fig) || fig); b.textContent = 'selected'; }
  setTimeout(() => { b.textContent = label; }, 1600);
});

// monthly or yearly: the white pill is a full-size layer cut down with clip-path, and the prices settle on a spring
const bill = $('[data-bill]');
if (bill) {
  const btns = $$('button', bill), ind = $('.seg-ind', bill), root = bill.closest('section');
  const place = () => {
    const b = btns.find((x) => x.getAttribute('aria-pressed') === 'true');
    ind.style.clipPath = `inset(${b.offsetTop}px ${bill.clientWidth - b.offsetLeft - b.offsetWidth}px ${bill.clientHeight - b.offsetTop - b.offsetHeight}px ${b.offsetLeft}px round 999px)`;
  };
  place(); bill.classList.add('is-on');
  if ('ResizeObserver' in window) new ResizeObserver(place).observe(bill);
  bill.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.getAttribute('aria-pressed') === 'true') return;
    btns.forEach((x) => x.setAttribute('aria-pressed', x === b)); place();
    const k = b.dataset.period;
    for (const n of $$('.amt [data-m]', root)) {
      const to = Number(n.dataset[k]);
      n.run?.stop();
      if (M && !still) n.run = M.animate(Number(n.textContent), to, { type: 'spring', duration: 0.5, bounce: 0.15, onUpdate: (v) => { n.textContent = Math.round(v); } });
      else n.textContent = to;
    }
    for (const n of $$('.per[data-m]', root)) n.textContent = n.dataset[k];
  });
}

// the hero download follows your system; the arrow lists every other platform
const dl = $('[data-dl]');
if (dl) {
  const more = $('.split-more', dl), menu = $('.dl-menu', dl), ua = navigator.userAgent;
  const mine = /android/i.test(ua) ? 'android' : /iphone|ipad/i.test(ua) ? 'ios' : /windows/i.test(ua) ? 'windows' : /linux|cros/i.test(ua) ? 'linux' : 'mac';
  if (mine !== 'mac') {
    const item = $(`[data-os="${mine}"]`, menu);
    $('.dl-os', dl).replaceChildren($('.os', item).cloneNode(true));
    $('.dl-label', dl).textContent = mine === 'ios' || mine === 'android' ? `get it for ${$('b', item).textContent}` : `download for ${mine}`;
  }
  const open = (on) => { menu.hidden = !on; more.setAttribute('aria-expanded', on); };
  more.addEventListener('click', () => open(menu.hidden));
  document.addEventListener('click', (e) => { if (!dl.contains(e.target)) open(false); });
  dl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { open(false); more.focus(); } });
}

const title = document.title;
document.addEventListener('visibilitychange', () => { document.title = document.hidden ? 'the bots miss you' : title; });

// the footer knows what time it is
const dusk = $('[data-dusk]'), hour = new Date().getHours();
if (dusk && hour >= 17 && hour < 20) dusk.textContent = "it's dusk where you are. the bots are just getting started.";
else if (dusk && hour < 5) dusk.textContent = "it's late. the bots are still up, you don't have to be.";

// every screen: the screens come on one after another the first time the scene is seen; poke juno on any of them and
// she reacts on all three, because it is the same bot
const ev = document.querySelector('[data-ev]');
if (ev && !still) {
  ev.addEventListener('click', (e) => {
    if (!e.target.closest('.ev-scr') || !window.duskBots) return;
    ev.querySelectorAll('.ev-j').forEach((b, i) => setTimeout(() => window.duskBots.react(b, 'hop'), i * 60));
  });
}
