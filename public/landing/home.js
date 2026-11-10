const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const M = window.Motion;

// every bot on the page looks at the pointer
const bots = [...document.querySelectorAll('.bot')];
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
    b.querySelector('.eyes').style.transform = `translate(${(dx / d * reach).toFixed(2)}px, ${(dy / d * reach * 0.8).toFixed(2)}px)`;
  }
}
if (!still) addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; frame ||= requestAnimationFrame(look); }, { passive: true });

const quips = ['hi', 'busy', 'on it', 'five more minutes', 'ok ok', 'that tickles', 'did you need something', 'working, promise', 'not the face', 'hire me', 'i was told there would be snacks'];
const purrs = ['mrrp', 'zzz', 'five more minutes', 'not a bot'];
const sparkColours = ['#2f7bf2', '#ff7d1f', '#8d5cf0', '#ff5c9d', '#1fb866', '#f8c623'];
const pokeable = '.shapes .bot, .work .bot, .peek-bot, .hill .bot, .faq-bots .bot, .brain-bot, .desk-bot';
let said = 0;
function hop(b) { if (!still) { b.classList.remove('hop'); void b.getBoundingClientRect(); b.classList.add('hop'); } }
function say(el, text) {
  const r = el.getBoundingClientRect(), q = document.createElement('span');
  q.className = 'quip'; q.textContent = text;
  q.style.left = `${r.left + r.width / 2 + scrollX}px`; q.style.top = `${Math.max(r.top, 0) + scrollY}px`;
  document.body.append(q); setTimeout(() => q.remove(), 1500);
}
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
document.addEventListener('click', (e) => {
  const cat = e.target.closest?.('.cat img');
  if (cat) { say(cat, purrs[said++ % purrs.length]); sparkle(e.clientX, e.clientY); return; }
  const b = e.target.closest?.(pokeable);
  if (!b) return;
  hop(b); say(b, quips[said++ % quips.length]); sparkle(e.clientX, e.clientY);
});
// the standing bots hop when the pointer reaches them, and do a wave the first time they are seen
document.addEventListener('pointerover', (e) => { const b = e.target.closest?.('.hill .bot, .faq-bots .bot'); if (b && !b.contains(e.relatedTarget)) hop(b); });
if ('IntersectionObserver' in window) for (const row of document.querySelectorAll('.hill, .faq-bots')) {
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((en) => en.isIntersecting)) return;
    io.disconnect(); [...row.children].forEach((b, i) => setTimeout(() => hop(b), 250 + i * 110));
  }, { threshold: 0.6 });
  io.observe(row);
}
for (const q of document.querySelectorAll('.qs details')) q.addEventListener('toggle', () => {
  const row = document.querySelectorAll('.faq-bots .bot');
  if (q.open && row.length) hop(row[Math.floor(Math.random() * row.length)]);
});

// cards lean a little toward the pointer
if (!still && matchMedia('(hover: hover) and (pointer: fine)').matches) for (const card of document.querySelectorAll('[data-tilt]')) {
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty('--ry', `${(x * 3.2).toFixed(2)}deg`); card.style.setProperty('--rx', `${(-y * 3.2).toFixed(2)}deg`);
  });
  card.addEventListener('pointerleave', () => { card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); });
}

// the picture inside the big $0 slides a little with the pointer
const zero = document.querySelector('.zero');
if (zero && !still) zero.parentElement.addEventListener('pointermove', (e) => {
  const r = zero.getBoundingClientRect();
  zero.style.backgroundPosition = `${(50 + ((e.clientX - r.left) / r.width - 0.5) * 60).toFixed(1)}% ${(50 + ((e.clientY - r.top) / r.height - 0.5) * 60).toFixed(1)}%`;
});

// the framed app is laid out at 1180 by 680 and scaled to whatever width its window has
const win = document.querySelector('[data-frame]');
if (win && 'ResizeObserver' in window) new ResizeObserver(() => {
  const fit = Math.min(1, win.clientWidth / 1180);
  win.style.setProperty('--fit', fit.toFixed(4)); win.parentElement.style.setProperty('--fit', fit.toFixed(4));
}).observe(win);

const title = document.title;
document.addEventListener('visibilitychange', () => { document.title = document.hidden ? 'the bots miss you' : title; });

// the chat in the app plays out once, just before it scrolls into view; nothing is hidden until then
const chat = document.querySelector('.chat');
if (M && chat && !still && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    M.animate([...chat.children], { opacity: [0, 1], y: [14, 0] }, { type: 'spring', duration: 0.6, bounce: 0.2, delay: M.stagger(0.45, { startDelay: 0.35 }) });
  }, { rootMargin: '0px 0px 160px 0px' });
  io.observe(chat);
}

// nova hops each time its brain is swapped
const brainBot = document.querySelector('.brain-bot');
if (brainBot && !still) document.querySelector('.brain-pick').addEventListener('click', (e) => {
  if (!e.target.closest('button')) return;
  brainBot.classList.remove('hop'); void brainBot.getBoundingClientRect(); brainBot.classList.add('hop');
});

// each job starts as "working" and flips to how it ended, one after another, the first time the day is seen
const work = document.querySelector('.work');
if (M && work && !still && 'IntersectionObserver' in window) {
  const tags = [...work.querySelectorAll('.tag')].map((el) => ({ el, text: el.textContent, cls: el.className }));
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    for (const t of tags) { t.el.textContent = 'working'; t.el.className = 'tag is-work'; }
    tags.forEach((t, i) => setTimeout(() => {
      t.el.textContent = t.text; t.el.className = t.cls;
      M.animate(t.el, { scale: [0.7, 1] }, { type: 'spring', duration: 0.5, bounce: 0.45 });
    }, 1100 + i * 420));
  }, { threshold: 0.25 });
  io.observe(work);
}

if (!still) for (const el of document.querySelectorAll('[data-cycle]')) {
  const lines = el.dataset.cycle.split('|'); let i = 0;
  setInterval(() => { el.textContent = lines[++i % lines.length]; }, 3200);
}
