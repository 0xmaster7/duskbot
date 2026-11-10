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

// every bot on the page looks at the pointer; the sea adds its own crowd below
const bots = $$('.bot').map((el) => ({ el, eyes: $('.eyes', el) }));
let seen = new Set(bots), frame = 0, px = innerWidth / 2, py = 0, seaLook = null;
if (hasIO) {
  seen = new Set();
  const by = new Map(bots.map((b) => [b.el, b]));
  const io = new IntersectionObserver((es) => { for (const e of es) e.isIntersecting ? seen.add(by.get(e.target)) : seen.delete(by.get(e.target)); });
  bots.forEach((b) => io.observe(b.el));
}
function look() {
  frame = 0;
  for (const b of seen) {
    const r = b.el.getBoundingClientRect();
    if (!r.width) continue;
    const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1, reach = Math.min(1, d / 260) * 5.5;
    b.eyes.style.transform = `translate(${(dx / d * reach).toFixed(2)}px, ${(dy / d * reach * 0.8).toFixed(2)}px)`;
  }
  seaLook?.();
}
const point = (e) => { px = e.clientX; py = e.clientY; frame ||= requestAnimationFrame(look); };
if (!still) { addEventListener('pointermove', point, { passive: true }); addEventListener('pointerdown', point, { passive: true }); }

const quips = ['hi', 'busy', 'on it', 'five more minutes', 'ok ok', 'that tickles', 'did you need something', 'working, promise', 'not the face', 'hire me', 'i was told there would be snacks'];
const sparkColours = ['#2f7bf2', '#ff7d1f', '#8d5cf0', '#ff5c9d', '#1fb866', '#f8c623'];
let said = 0;
function hop(b) { if (!still && b) { b.classList.remove('hop'); void b.getBoundingClientRect(); b.classList.add('hop'); } }
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
  hop(b); say(b, asleep ? 'zzz' : quips[said++ % quips.length]); sparkle(e.clientX, e.clientY);
});

// the bot beside the questions nods along
const listener = $('.listener'), hellos = ['hi', 'ask away', 'good question', 'i know this one', 'still free, by the way'];
if (listener) {
  for (const q of $$('.qs details')) q.addEventListener('toggle', () => { if (q.open) hop($('.bot', listener)); });
  listener.addEventListener('click', (e) => { hop($('.bot', listener)); say(listener, hellos[said++ % hellos.length]); sparkle(e.clientX || 0, e.clientY || 0); });
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
  const ptr = $('.ptr', view), rows = $$('.fares li', view), hold = $('u', rows[0]), act = $('[data-act]'), take = $('[data-take]');
  const done = act.textContent, glide = 'transform 0.55s cubic-bezier(0.77, 0, 0.175, 1)';
  let held = false;
  const at = (el, dx, dy) => { const b = view.getBoundingClientRect(), r = el.getBoundingClientRect(); ptr.style.transform = `translate(${r.left - b.left + r.width / 2 - 4 + dx}px, ${r.top - b.top + r.height / 2 - 3 + dy}px)`; };
  const hot = (row) => rows.forEach((r) => r.classList.toggle('hot', r === row));
  const mark = (on) => { hold.classList.toggle('held', on); hold.textContent = on ? 'held' : 'hold'; };
  const rest = () => { if (!held) at(hold, 6, 4); };
  ptr.classList.add('on'); rest();
  addEventListener('load', rest); addEventListener('resize', rest);
  if (!still) once(view, async () => {
    hot(null); mark(false); act.textContent = 'nova is comparing 3 flights';
    ptr.style.transition = 'none'; at($('em', rows[2]), 60, 70); await wait(350);
    ptr.style.transition = glide;
    for (const row of [rows[2], rows[1], rows[0]]) { if (held) return; at($('em', row), 0, 4); await wait(400); if (held) return; hot(row); await wait(260); }
    act.textContent = 'cheapest is €84. nova is holding it'; at(hold, 6, 4); await wait(620);
    if (held) return;
    hold.style.scale = '0.9'; await wait(140); hold.style.scale = ''; mark(true); act.textContent = done;
  }, 0.7);
  take.addEventListener('click', () => {
    held = !held;
    take.setAttribute('aria-pressed', held); take.textContent = held ? 'give it back' : 'take the mouse';
    view.style.cursor = held ? 'none' : '';
    ptr.style.transition = held ? 'none' : glide;
    act.textContent = held ? 'you have the mouse. nova is watching' : done;
    if (!held) { hot(rows[0]); mark(true); rest(); }
  });
  view.addEventListener('pointermove', (e) => {
    if (!held) return;
    const b = view.getBoundingClientRect();
    ptr.style.transform = `translate(${e.clientX - b.left - 4}px, ${e.clientY - b.top - 3}px)`;
    hot(e.target.closest('.fares li'));
  });
}

// a routine switched off puts its bot to sleep (the look is css; this is the yawn)
for (const t of $$('.rows .toggle')) t.addEventListener('click', () => {
  if (!document.documentElement.classList.contains('mk-ready')) t.setAttribute('aria-checked', t.getAttribute('aria-checked') !== 'true');
  setTimeout(() => { const b = $('.bot', t.closest('li')); if (t.getAttribute('aria-checked') === 'true') { hop(b); say(b, 'back on it'); } else say(b, 'zzz'); });
});

// the newest note in the notebook types itself in once, and is really yours to edit
const note = $('[data-note]');
if (note) {
  try { note.contentEditable = 'plaintext-only'; } catch { note.contentEditable = 'true'; }
  note.setAttribute('role', 'textbox'); note.setAttribute('aria-label', 'a note you can edit'); note.spellcheck = false;
  note.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); note.blur(); } });
  note.addEventListener('input', () => { $('[data-note-foot]').textContent = 'edited by you. nova will remember'; });
  $('[data-edit]').addEventListener('click', () => { note.focus(); getSelection().selectAllChildren(note); getSelection().collapseToEnd(); });
  if (!still) once(note, async () => {
    const text = note.textContent;
    for (let i = 0; i <= text.length; i++) { if (document.activeElement === note) return; note.textContent = text.slice(0, i); await wait(42); }
  }, 0.9);
}

// juno waits for a yes
const ask = $('[data-ask]');
if (ask) {
  const line = $('[data-ask-line]', ask), btns = $('.ask-btns', ask), first = [line.innerHTML, btns.innerHTML];
  btns.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.answer) {
      line.textContent = b.dataset.answer; hop($('.bot', ask));
      if (b.classList.contains('yes')) sparkle(e.clientX, e.clientY);
      btns.innerHTML = '<button class="pill" type="button">ask me again</button>';
    } else { line.innerHTML = first[0]; btns.innerHTML = first[1]; }
    btns.firstElementChild.focus({ preventScroll: true });
  });
}

const phone = $('[data-ring]'), calls = ['ring ring', "it's nova. found your flight", 'juno here. 3 emails need you', 'new phone who dis'];
phone?.addEventListener('click', () => { phone.classList.remove('ringing'); void phone.offsetWidth; phone.classList.add('ringing'); say(phone, calls[said++ % calls.length]); });

for (const b of $$('[data-copy]')) b.addEventListener('click', async () => {
  const label = b.dataset.label ||= b.textContent;
  try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'copied'; }
  catch { const fig = b.closest('figure') || b.parentElement; getSelection().selectAllChildren($('code', fig) || $('.wc-cmd', fig) || fig); b.textContent = 'selected'; }
  setTimeout(() => { b.textContent = label; }, 1600);
});

// small states that rest finished and replay once when seen (the server in the app connecting)
if (hasIO && !still) for (const el of $$('[data-wake]')) { el.classList.add('pre'); once(el, () => setTimeout(() => el.classList.remove('pre'), 1100), 0.7); }

// the picture inside the big $0 slides a little with the pointer
const zero = $('.zero');
if (zero && !still) zero.parentElement.addEventListener('pointermove', (e) => {
  const r = zero.getBoundingClientRect();
  zero.style.backgroundPosition = `${(50 + ((e.clientX - r.left) / r.width - 0.5) * 60).toFixed(1)}% ${(50 + ((e.clientY - r.top) / r.height - 0.5) * 60).toFixed(1)}%`;
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

// the bot on the terraces climbs a step when poked, and goes to whichever of the four steps you point at
const terr = $('.terr'), climber = $('.climber');
if (terr && climber) {
  const lines = ['back to the start', 'signed in', "it's alive", 'made it. now make it a routine'];
  const go = (n) => { if (terr.dataset.step === String(n)) return; terr.dataset.step = n; hop($('.bot', climber)); };
  climber.addEventListener('click', () => { const n = Number(terr.dataset.step) % 4 + 1; go(n); setTimeout(() => say(climber, lines[n - 1]), 420); });
  for (const li of $$('.steps > li')) li.addEventListener('pointerenter', () => go(li.dataset.step));
  if (!still) once(terr, async () => { for (const n of [2, 3, 4]) { await wait(420); go(n); } }, 0.6);
}

// the sea. bots are drawn in one svg; this maps each to the screen, turns its eyes to the pointer wherever it is,
// and ducks it under when the pointer gets close (the six on the beach hop instead). a click anywhere sends a ripple through the crowd
const sea = $('.sea');
if (sea && !still) {
  const crowd = $$('.sb', sea).map((el) => { const m = el.transform.baseVal.consolidate().matrix; return { el, eyes: $('.eyes', el), x: m.e + 50 * m.a, y: m.f + 45 * m.a, size: 100 * m.a, shore: el.classList.contains('shore'), cool: 0, t: 0 }; });
  const shouts = ['marco', 'polo', 'marco', 'polo', 'cannonball', "water's fine", 'no lifeguard on duty'];
  let s = 1, ox = 0, oy = 0, live = false, idle = 0, shout = 0;
  const measure = () => { const b = sea.getBoundingClientRect(); s = Math.max(b.width / 2400, b.height / 400); ox = b.left + (b.width - 2400 * s) / 2; oy = b.top + (b.height - 400 * s) / 2; };
  const dive = (b, ms) => { b.el.classList.add('dive'); clearTimeout(b.t); b.t = setTimeout(() => b.el.classList.remove('dive'), ms); };
  const onScreen = (b) => { const x = ox + b.x * s; return x > -30 && x < innerWidth + 30; };
  const watch = () => {
    if (!live) return;
    measure();
    for (const b of crowd) {
      if (!onScreen(b)) continue;
      const dx = px - (ox + b.x * s), dy = py - (oy + b.y * s), d = Math.hypot(dx, dy) || 1;
      b.eyes.style.transform = `translate(${(dx / d * 6).toFixed(1)}px, ${(dy / d * 5).toFixed(1)}px)`;
      if (d > 22 + b.size * s) continue;
      if (!b.shore) dive(b, 700 + Math.random() * 900);
      else if (performance.now() > b.cool) { b.cool = performance.now() + 900; dive(b, 170); }
    }
  };
  seaLook = watch;
  sea.addEventListener('click', (e) => {
    measure();
    for (const b of crowd) if (onScreen(b)) setTimeout(() => dive(b, b.shore ? 170 : 240), Math.hypot(e.clientX - (ox + b.x * s), e.clientY - (oy + b.y * s)) * 0.9);
    sayAt(e.clientX, e.clientY - 14, shouts[shout++ % shouts.length]);
  });
  if (hasIO) {
    // they start under water and come up in a wave the first time the sea is seen
    const swimmers = crowd.filter((b) => !b.shore);
    swimmers.forEach((b) => b.el.classList.add('dive'));
    once(sea, () => { measure(); swimmers.forEach((b) => { b.t = setTimeout(() => b.el.classList.remove('dive'), 120 + Math.abs(ox + b.x * s - innerWidth / 2) * 0.7 + Math.random() * 220); }); }, 0.3);
    new IntersectionObserver(([e]) => {
      live = e.isIntersecting; sea.classList.toggle('off', !live); clearInterval(idle);
      if (live) idle = setInterval(() => { measure(); const up = swimmers.filter((b) => onScreen(b) && !b.el.classList.contains('dive')); if (up.length) dive(up[Math.floor(Math.random() * up.length)], 520); }, 1700);
    }).observe(sea);
  } else live = true;
}

const title = document.title;
document.addEventListener('visibilitychange', () => { document.title = document.hidden ? 'the bots miss you' : title; });

// the footer knows what time it is
const dusk = $('[data-dusk]'), hour = new Date().getHours();
if (dusk && hour >= 17 && hour < 20) dusk.textContent = "it's dusk where you are. the bots are just getting started.";
else if (dusk && hour < 5) dusk.textContent = "it's late. the bots are still up, you don't have to be.";
