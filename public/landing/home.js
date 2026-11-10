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

const quips = ['hi', 'busy', 'on it', 'five more minutes', 'ok ok', 'that tickles', 'did you need something', 'working, promise', 'not the face'];
let said = 0;
document.addEventListener('click', (e) => {
  const b = e.target.closest?.('.relay .bot, .shapes .bot, .log .bot');
  if (!b) return;
  if (!still) { b.classList.remove('hop'); void b.getBoundingClientRect(); b.classList.add('hop'); }
  const r = b.getBoundingClientRect(), q = document.createElement('span');
  q.className = 'quip'; q.textContent = quips[said++ % quips.length];
  q.style.left = `${r.left + r.width / 2 + scrollX}px`; q.style.top = `${Math.max(r.top, 0) + scrollY}px`;
  document.body.append(q); setTimeout(() => q.remove(), 1500);
});

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

if (!still) for (const el of document.querySelectorAll('[data-cycle]')) {
  const lines = el.dataset.cycle.split('|'); let i = 0;
  setInterval(() => { el.textContent = lines[++i % lines.length]; }, 3200);
}
