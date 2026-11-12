const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// the hero keeps the visitor's own time: the sun sits where their clock says, and nova mentions it.
// ?t=18.5 previews an hour.
(() => {
  const sun = $('.sun'), glow = $('.glow'), says = $('#nova-says');
  if (!sun || !says) return;
  const forced = parseFloat(new URLSearchParams(location.search).get('t'));
  function tick() {
    const now = new Date();
    const h = Number.isFinite(forced) ? forced : now.getHours() + now.getMinutes() / 60;
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    const time = `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
    const day = h >= 6 && h < 19, t = (h - 6) / 13;
    const narrow = innerWidth <= 860;
    if (day) {
      const x = narrow ? 14 + t * 72 : 47 + t * 46, y = narrow ? 70 - Math.sin(Math.PI * t) * 34 : 37 - Math.sin(Math.PI * t) * 28;
      sun.style.left = `${x.toFixed(1)}%`;
      sun.style.top = narrow ? `${y.toFixed(0)}px` : `${y.toFixed(1)}%`;
    } else {
      sun.style.left = narrow ? '76%' : '86%';
      sun.style.top = narrow ? '58px' : '13%';
    }
    sun.classList.toggle('is-moon', !day);
    sun.classList.toggle('is-low', day && (h < 7.5 || h > 16.5));
    // a little lemon light near the horizon early and late, none at midday
    const edge = day ? Math.max(0, 1 - Math.min(h - 6, 19 - h) / 2.5) : 0;
    glow.style.opacity = (edge * 0.7).toFixed(2);
    says.textContent =
      h < 5 ? `it’s ${time}. go to bed, i’ve got the night shift.` :
      h < 11 ? `morning. it’s ${time} and i started without you.` :
      h < 17 ? `it’s ${time} where you are. want something off your plate?` :
      h < 20 ? `it’s ${time}. nice light. i’ll keep going after you log off.` :
      `it’s ${time}. go to bed, i’ve got the night shift.`;
  }
  tick();
  setInterval(tick, 30000);
  addEventListener('resize', tick, { passive: true });
})();

// the download for this computer goes on top
(() => {
  const box = $('#downloads');
  if (!box) return;
  const p = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  const os = p.includes('win') ? 'win' : p.includes('linux') && !/android/i.test(navigator.userAgent) ? 'linux' : 'mac';
  const mine = $(`[data-os="${os}"]`, box);
  if (!mine || mine === box.firstElementChild) return;
  $$('.sbtn', box).forEach((b) => b.classList.toggle('is-main', b === mine));
  box.prepend(mine);
})();

// copy buttons
for (const b of $$('[data-copy]')) b.addEventListener('click', async () => {
  const note = $('.copied', b);
  try { await navigator.clipboard.writeText(b.dataset.copy); note.textContent = 'copied'; }
  catch { note.textContent = 'select it and copy'; }
  clearTimeout(b._t); b._t = setTimeout(() => { note.textContent = ''; }, 1600);
});

// every bot looks at the pointer
const bots = $$('.bot');
let seen = new Set(bots), frame = 0, px = 0, py = 0;
if ('IntersectionObserver' in window) {
  seen = new Set();
  const io = new IntersectionObserver((entries) => { for (const e of entries) e.isIntersecting ? seen.add(e.target) : seen.delete(e.target); });
  bots.forEach((b) => io.observe(b));
}
function look() {
  frame = 0;
  for (const b of seen) {
    const r = b.getBoundingClientRect();
    if (!r.width) continue;
    const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, d / 260) * 5.5;
    $('.eyes', b).style.transform = `translate(${(dx / d * reach).toFixed(2)}px, ${(dy / d * reach * 0.8).toFixed(2)}px)`;
  }
}
if (!still) addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; frame ||= requestAnimationFrame(look); }, { passive: true });

// poke a bot and it answers
const quips = ['hi', 'busy', 'on it', 'five more minutes', 'ok ok', 'that tickles', 'did you need something', 'working, promise', 'not the face', 'hire me', 'i was told there would be snacks'];
const purrs = ['mrrp', 'zzz', 'five more minutes', 'not a bot'];
let said = 0;
function hop(b) { if (!still) { b.classList.remove('hop'); void b.getBoundingClientRect(); b.classList.add('hop'); } }
function say(el, text) {
  const r = el.getBoundingClientRect(), q = document.createElement('span');
  q.className = 'quip'; q.textContent = text;
  q.style.left = `${r.left + r.width / 2 + scrollX}px`; q.style.top = `${Math.max(r.top, 0) + scrollY}px`;
  document.body.append(q); setTimeout(() => q.remove(), 1500);
}
document.addEventListener('click', (e) => {
  const cat = e.target.closest?.('.cat img');
  if (cat) { say(cat, purrs[said++ % purrs.length]); return; }
  const b = e.target.closest?.('.field .bot, .hill .bot, .faq-bots .bot, .brain-bot');
  if (b) { hop(b); say(b, quips[said++ % quips.length]); }
});
document.addEventListener('pointerover', (e) => { const b = e.target.closest?.('.hill .bot, .faq-bots .bot'); if (b && !b.contains(e.relatedTarget)) hop(b); });
if ('IntersectionObserver' in window) for (const row of $$('.hill, .faq-bots')) {
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((en) => en.isIntersecting)) return;
    io.disconnect(); [...row.children].forEach((b, i) => setTimeout(() => hop(b), 250 + i * 110));
  }, { threshold: 0.6 });
  io.observe(row);
}

// nova changes the ai it runs on and keeps everything else
(() => {
  const group = $('#providers'), logo = $('#brain-logo'), name = $('#brain-name'), line = $('#brain-line'), bot = $('.brain-bot');
  if (!group) return;
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.getAttribute('aria-pressed') === 'true') return;
    $$('button', group).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    logo.src = $('.logo', b).getAttribute('src'); name.textContent = b.dataset.model; line.textContent = b.dataset.line;
    hop(bot);
    if (window.Motion && !still) window.Motion.animate($('.brain-chip'), { scale: [0.9, 1] }, { type: 'spring', duration: 0.45, bounce: 0.35 });
  });
})();

// the scene behind "where it runs" follows the place you pick
(() => {
  const poster = $('.place-poster');
  if (!poster || !('MutationObserver' in window)) return;
  const tabs = $$('.where [role="tab"]');
  const sync = () => { const on = tabs.find((t) => t.getAttribute('aria-selected') === 'true'); if (on) poster.dataset.place = on.id.slice(2); };
  const mo = new MutationObserver(sync);
  tabs.forEach((t) => mo.observe(t, { attributes: true, attributeFilter: ['aria-selected'] }));
})();

// monthly or yearly
(() => {
  const group = $('.bill');
  if (!group) return;
  group.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.getAttribute('aria-pressed') === 'true') return;
    $$('button', group).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    for (const el of $$('.price [data-month]')) {
      const text = el.dataset[b.dataset.bill];
      if (el.tagName === 'B' && window.MK?.count && !still) window.MK.count(el, text); else el.textContent = text;
    }
  });
})();

// the picture of the app is swapped for the real one only when asked
(() => {
  const win = $('[data-frame]'), btn = $('[data-try]'), note = $('.try-note');
  if (!win || !btn) return;
  const fit = () => { const f = win.querySelector('iframe'); if (f) f.style.transform = `scale(${(win.clientWidth / 1180).toFixed(4)})`; };
  function open() {
    const f = document.createElement('iframe');
    f.src = '/demo/'; f.width = 1180; f.height = 680; f.title = 'the dusk bot app, running on sample data';
    win.append(f); win.classList.add('is-live'); fit();
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(win);
  }
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    let ok = true;
    try { ok = (await fetch('/demo/', { method: 'HEAD' })).ok; } catch { ok = true; }
    if (ok) return open();
    btn.hidden = true; note.textContent = 'the live one only runs on dusk.bot. this is a picture of it.';
  });
})();

const title = document.title;
document.addEventListener('visibilitychange', () => { document.title = document.hidden ? 'the bots miss you' : title; });
