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

// the bots themselves (looks, blinks, moods, answers to a poke) are the app's mascot code, in mascot.js
const bots = (fn) => { if (window.duskBots) fn(window.duskBots); else addEventListener('load', () => window.duskBots && fn(window.duskBots), { once: true }); };

// hero: the two bubbles pop in, and pip hops when nova's answer lands
const pops = $$('[data-pop]');
if (pops.length && !still && hasIO) {
  document.documentElement.classList.add('pop-armed');
  once($('.hero'), async () => {
    await wait(500); pops[0].classList.add('on');
    await wait(900); pops[1].classList.add('on');
    await wait(220); bots((d) => d.react($('.pipx'), 'hop'));
  }, 0.2);
}

// the bots that doze: kit at the end and in the footer, and the laptop's bots while its lid is shut
bots((d) => $$('svg.dozer').forEach((b) => d.state(b, 'asleep')));
const lid = $('[data-lid]');
if (lid) {
  const btn = $('[data-lid-btn]', lid), crew = $('.bs', lid), cap = $('.cap', lid);
  const set = (open) => {
    lid.dataset.lid = open ? 'open' : 'closed';
    btn.setAttribute('aria-pressed', open); btn.textContent = open ? 'close the lid' : 'open the lid';
    $('h3', cap).textContent = open ? 'your computer, lid open' : 'your computer, lid shut';
    $('p', cap).textContent = open ? 'bots on your own computer work while it is awake. close the lid and they rest until it wakes.' : 'bots on your own computer rest while it sleeps, and pick up where they left off when it wakes.';
    bots((d) => { d.state(crew, open ? 'idle' : 'asleep'); if (open && !still) d.react(crew, 'hop'); });
  };
  set(false);
  btn.addEventListener('click', () => set(lid.dataset.lid !== 'open'));
}

// a bot card lifts on hover and its bot hops
if (fine && !still) for (const card of $$('.tc')) card.addEventListener('pointerenter', () => bots((d) => d.react(card, 'hop')));

// juno waits for a yes; a yes makes it cheer. a sample: nothing is sent
const ask = $('[data-ask]');
if (ask) {
  const line = $('[data-ask-line]', ask), juno = $('.ask-head', ask);
  const SAY = { yes: 'sent. juno is cheering. (a sample, nothing was sent)', no: 'okay. juno will hold it until you say so.', list: '1,204 people on the launch list. juno is still waiting.' };
  ask.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ans]');
    if (!b) return;
    const k = b.dataset.ans;
    $$('[data-ans]', ask).forEach((x) => x.setAttribute('aria-pressed', x === b));
    line.textContent = SAY[k];
    ask.classList.toggle('answered', k !== 'list');
    bots((d) => { if (k === 'yes') { d.state(juno, 'celebrate'); if (!still) d.react(juno, 'celebrate'); } else d.state(juno, 'idle'); });
  });
}

// monthly or yearly: the dark block is a full-size layer cut down with clip-path, and the prices settle on a spring
const bill = $('[data-bill]');
if (bill) {
  const btns = $$('button', bill), ind = $('.seg-ind', bill), root = bill.closest('section');
  const place = () => {
    const b = btns.find((x) => x.getAttribute('aria-pressed') === 'true');
    ind.style.clipPath = `inset(${b.offsetTop}px ${bill.clientWidth - b.offsetLeft - b.offsetWidth}px ${bill.clientHeight - b.offsetTop - b.offsetHeight}px ${b.offsetLeft}px)`;
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
    for (const a of $$('a[href*="/signup?plan="]', root)) { const u = new URL(a.href); u.searchParams.set('period', k === 'y' ? 'year' : 'month'); a.href = u.href; }
  });
}

// the hero download is the file for this computer, a plain link that starts at once; the arrow lists every other build.
// on a phone it opens the download page, since the app runs on a computer
const dl = $('[data-dl]');
if (dl) {
  const more = $('.split-more', dl), menu = $('.dl-menu', dl), main = $('.split-main', dl);
  // site.js (loaded after this file) finds the build
  addEventListener('DOMContentLoaded', async () => {
    const key = await window.duskBuild?.();
    if (key === 'phone') { main.href = '/download'; main.removeAttribute('download'); return; }
    const item = key && $(`[data-key="${key}"]`, menu);
    if (!item) return;
    main.href = item.href;
    $('.dl-os', dl).replaceChildren($('.os', item).cloneNode(true));
  });
  const open = (on) => { menu.hidden = !on; more.setAttribute('aria-expanded', on); };
  more.addEventListener('click', () => open(menu.hidden));
  document.addEventListener('click', (e) => { if (!dl.contains(e.target)) open(false); });
  dl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { open(false); more.focus(); } });
}

// a dashed arrow swoops from the pointer into the closing download button whenever you are near it. every point is on a
// spring, so the curve follows the pointer with a little lag and settles instead of snapping
const cta = $('[data-aim]');
if (cta && fine && !still) {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), line = document.createElementNS(NS, 'path'), head = document.createElementNS(NS, 'path');
  svg.setAttribute('class', 'aim'); svg.setAttribute('aria-hidden', 'true'); line.setAttribute('class', 'aim-line'); head.setAttribute('class', 'aim-head');
  svg.append(line, head); document.body.append(svg);
  const REACH = 760, K = 0.14, DAMP = 0.7;
  const spring = () => ({ x: 0, y: 0, vx: 0, vy: 0 });
  const pts = { s: spring(), a: spring(), b: spring(), e: spring() };
  let mx = -1, my = -1, show = 0, frame = 0, fresh = true;
  const pull = (p, x, y) => {
    if (fresh) { p.x = x; p.y = y; p.vx = p.vy = 0; return; }
    p.vx = (p.vx + (x - p.x) * K) * DAMP; p.vy = (p.vy + (y - p.y) * K) * DAMP; p.x += p.vx; p.y += p.vy;
  };
  const f = (n) => n.toFixed(1);
  const tick = () => {
    frame = 0;
    const r = cta.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const inside = mx >= r.left - 8 && mx <= r.right + 8 && my >= r.top - 8 && my <= r.bottom + 8;
    const d = Math.hypot(mx - cx, my - cy);
    // it fades in as you come within reach, and out again over the last stretch, so the button itself takes over
    const edge = Math.hypot(Math.max(r.left - mx, 0, mx - r.right), Math.max(r.top - my, 0, my - r.bottom));
    const want = mx < 0 || inside || r.bottom < 0 || r.top > innerHeight ? 0 : Math.max(0, Math.min(1, (REACH - d) / 220, (edge - 40) / 160));
    // land on the side of the button that faces you, heading straight into it
    // the other button sits to its right, so from that side the arrow comes in over the top or from below instead
    const side = mx < cx && cx - mx - r.width / 2 > Math.abs(my - cy) * 0.8;
    const dir = side ? [mx < cx ? 1 : -1, 0] : [0, my < cy ? 1 : -1];
    const ex = side ? (mx < cx ? r.left - 12 : r.right + 12) : Math.min(Math.max(mx, r.left + 24), r.right - 24);
    const ey = side ? cy : (my < cy ? r.top - 10 : r.bottom + 10);
    const span = Math.hypot(ex - mx, ey - my), reachIn = Math.min(Math.max(span * 0.42, 36), 240);
    // the first handle leaves the pointer sideways toward the button and dips a little, like a thrown line
    const ax = mx + (ex - mx) * 0.42, ay = my + Math.min(span * 0.28, 140) * (ey >= my ? 0.4 : 1);
    const bx = ex - dir[0] * reachIn, by = ey - dir[1] * reachIn;
    const lx = ax - mx, ly = ay - my, ll = Math.hypot(lx, ly) || 1;
    pull(pts.s, mx + (lx / ll) * 16, my + (ly / ll) * 16); pull(pts.a, ax, ay); pull(pts.b, bx, by); pull(pts.e, ex, ey);
    fresh = false;
    show += (want - show) * 0.16;
    const { s: S, a: A, b: B, e: E } = pts;
    line.setAttribute('d', `M${f(S.x)} ${f(S.y)}C${f(A.x)} ${f(A.y)} ${f(B.x)} ${f(B.y)} ${f(E.x)} ${f(E.y)}`);
    const tx = E.x - B.x, ty = E.y - B.y, tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl, w = 0.52, h = 12;
    const wing = (sg) => [E.x - h * (ux * Math.cos(w) + sg * uy * Math.sin(w)), E.y - h * (uy * Math.cos(w) - sg * ux * Math.sin(w))];
    const [p1, p2] = [wing(1), wing(-1)];
    head.setAttribute('d', `M${f(p1[0])} ${f(p1[1])}L${f(E.x)} ${f(E.y)}L${f(p2[0])} ${f(p2[1])}`);
    svg.style.opacity = show.toFixed(3);
    const moving = Math.abs(S.vx) + Math.abs(S.vy) + Math.abs(E.vx) + Math.abs(E.vy) > 0.05;
    if (show > 0.01 || want > 0 || moving) frame = requestAnimationFrame(tick);
    else fresh = true;
  };
  const go = () => { frame ||= requestAnimationFrame(tick); };
  addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; go(); }, { passive: true });
  addEventListener('scroll', go, { passive: true });
  document.addEventListener('pointerleave', () => { mx = -1; go(); });
}

// only when someone switches to another tab or app while the page stays open: never on a link, a download, a redirect
// or leaving, so a click-out in the last 1.5 s or a pagehide keeps the real title
const title = document.title;
const MISS = [
  'the bots miss you', 'kitten is crying rn', 'ur bots are gossiping', 'come back bestie', 'pls 🥺 come back',
  'kitten is not ok', 'u left them on read', 'who said u could leave', 'kitten put on a sad song',
  'kitten is writing a breakup text', 'they rearranged the furniture', 'the bots ate ur snacks',
  'not u ghosting the bots', 'u had one job. stay.', 'kitten is pretending to be fine',
  'kitten is at the window 🪟', 'u forgot us already? 💔', 'the bots threw a party without u 🎉',
  'kitten knocked ur cup over ☕', 'kitten is sitting on ur keyboard ⌨️', 'brb crying 😿',
  'come back, it is snack time 🍿', 'kitten is loafing in protest 🍞', 'the bots are doing ur work rn 💼',
  'one more tab? really? 👀', 'kitten left u a voice note 🎙️', 'the bots lit a candle for u 🕯️',
];
let away = 0, gone = false, last = -1;
const leaving = () => { away = Date.now(); };
document.addEventListener('click', (e) => { if (e.target.closest?.('a[href], [download]')) leaving(); }, true);
addEventListener('beforeunload', leaving);
addEventListener('pagehide', () => { gone = true; document.title = title; });
addEventListener('pageshow', () => { gone = false; document.title = title; });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { document.title = title; return; }
  if (gone || Date.now() - away < 1500) return;
  let n = Math.floor(Math.random() * MISS.length);
  if (n === last) n = (n + 1) % MISS.length;
  document.title = MISS[last = n];
});

// the footer knows what time it is
const dusk = $('[data-dusk]'), hour = new Date().getHours();
if (dusk && hour >= 17 && hour < 20) dusk.textContent = "it's dusk where you are. the bots are just getting started.";
else if (dusk && hour < 5) dusk.textContent = "it's late. the bots are still up, you don't have to be.";
