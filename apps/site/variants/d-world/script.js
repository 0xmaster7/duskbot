(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const root = document.documentElement;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // sections rise in as they arrive; without this script nothing is ever hidden
  if (!still && 'IntersectionObserver' in window) {
    root.classList.add('js');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting || e.boundingClientRect.bottom < 0) { e.target.classList.add('in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    $$('[data-reveal]').forEach((el) => io.observe(el));
  }

  // the world: far layers lag behind the scroll and lean away from the pointer
  const hero = $('.hero');
  const layers = $$('.layer[data-depth]').map((el) => ({ el, d: +el.dataset.depth }));
  const clouds = $$('.cloud').map((el, i) => ({ el, d: 0.26 + i * 0.045, x: 0, y: 0, vx: 0, vy: 0, held: false, ph: i * 1.7, amp: 14 + (i % 3) * 9 }));
  let heroSeen = true, running = false, scrollT = 0, scrollC = 0, leanT = 0, leanC = 0, unit = 1, t0 = performance.now();
  const readUnit = () => { unit = parseFloat(getComputedStyle(root).getPropertyValue('--u')) || 1; };
  function tick(now) {
    running = false;
    scrollC += (scrollT - scrollC) * 0.16;
    leanC += (leanT - leanC) * 0.07;
    for (const { el, d } of layers) el.style.transform = `translate3d(${(-leanC * d * 150 * unit).toFixed(2)}px, ${(scrollC * d).toFixed(2)}px, 0)`;
    const t = (now - t0) / 1000;
    let lively = false;
    for (const c of clouds) {
      if (!c.held) {
        c.vx += -c.x * 0.012; c.vy += -c.y * 0.012;
        c.vx *= 0.93; c.vy *= 0.93;
        c.x += c.vx; c.y += c.vy;
      }
      if (Math.abs(c.vx) + Math.abs(c.vy) > 0.02 || Math.abs(c.x) + Math.abs(c.y) > 0.3) lively = true;
      const fx = Math.sin(t * 0.16 + c.ph) * c.amp * unit, fy = Math.cos(t * 0.11 + c.ph) * 5;
      c.el.style.transform = `translate3d(${(c.x + fx - leanC * c.d * 60).toFixed(2)}px, ${(c.y + fy + scrollC * c.d).toFixed(2)}px, 0)`;
    }
    if (heroSeen || lively || Math.abs(scrollT - scrollC) > 0.2) go();
  }
  function go() { if (!running) { running = true; requestAnimationFrame(tick); } }
  if (hero && !still) {
    readUnit();
    addEventListener('resize', readUnit, { passive: true });
    new IntersectionObserver(([e]) => { heroSeen = e.isIntersecting; if (heroSeen) go(); }).observe(hero);
    addEventListener('scroll', () => { scrollT = Math.min(scrollY, hero.offsetHeight); go(); }, { passive: true });
    scrollT = scrollC = Math.min(scrollY, hero.offsetHeight);
    if (fine) hero.addEventListener('pointermove', (e) => {
      leanT = clamp(e.clientX / innerWidth - 0.5, -0.5, 0.5);
      // a passing pointer pushes the clouds along
      for (const c of clouds) {
        if (c.held) continue;
        const r = c.el.getBoundingClientRect(), dx = r.left + r.width / 2 - e.clientX, dy = r.top + r.height / 2 - e.clientY, reach = r.width * 0.62;
        const dist = Math.hypot(dx, dy);
        if (dist < reach) { const push = (1 - dist / reach) * 0.9; c.vx += (dx / (dist || 1)) * push + e.movementX * 0.03 * push; c.vy += (dy / (dist || 1)) * push * 0.5; }
      }
    }, { passive: true });
    // and they can be picked up and let go
    for (const c of clouds) {
      let lx = 0, ly = 0;
      c.el.addEventListener('pointerdown', (e) => { c.held = true; lx = e.clientX; ly = e.clientY; c.vx = c.vy = 0; c.el.classList.add('held'); c.el.setPointerCapture(e.pointerId); });
      c.el.addEventListener('pointermove', (e) => { if (!c.held) return; c.vx = e.clientX - lx; c.vy = e.clientY - ly; c.x += c.vx; c.y += c.vy; lx = e.clientX; ly = e.clientY; });
      const drop = () => { c.held = false; c.el.classList.remove('held'); c.vx = clamp(c.vx, -30, 30); c.vy = clamp(c.vy, -30, 30); go(); };
      c.el.addEventListener('pointerup', drop); c.el.addEventListener('pointercancel', drop);
      c.el.addEventListener('dragstart', (e) => e.preventDefault());
    }
    go();
  }

  // rivet waves from behind the trees, and ducks when you get close
  const peek = $('.peek');
  if (peek) {
    let timer = 0;
    const up = (ms) => { clearTimeout(timer); timer = setTimeout(() => peek.classList.add('up'), ms); };
    if (still) peek.classList.add('up'); else up(1500);
    peek.addEventListener('pointerenter', () => { if (still) return; peek.classList.remove('up'); up(1500); });
  }

  // every bot looks at the pointer
  const bots = $$('.bot');
  let seen = new Set(bots), looking = 0, mx = 0, my = 0;
  if ('IntersectionObserver' in window) {
    seen = new Set();
    const io = new IntersectionObserver((entries) => { for (const e of entries) e.isIntersecting ? seen.add(e.target) : seen.delete(e.target); });
    bots.forEach((b) => io.observe(b));
  }
  function look() {
    looking = 0;
    for (const b of seen) {
      const r = b.getBoundingClientRect();
      if (!r.width) continue;
      const dx = mx - (r.left + r.width / 2), dy = my - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1, reach = Math.min(1, d / 260) * 5.5;
      b.querySelector('.eyes').style.transform = `translate(${(dx / d * reach).toFixed(2)}px, ${(dy / d * reach * 0.8).toFixed(2)}px)`;
    }
  }
  if (!still && fine) addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; looking ||= requestAnimationFrame(look); }, { passive: true });

  // poke a bot and it hops and says something; the cat does not hop
  const quips = ['hi', 'on it', 'busy, but hi', 'five more minutes', 'that tickles', 'did you need something', 'working, promise', 'hire me', 'not the face'];
  const purrs = ['mrrp', 'zzz', 'not a bot', 'five more minutes'];
  let said = 0;
  function hop(b) { if (still) return; b.classList.remove('hop'); void b.getBoundingClientRect(); b.classList.add('hop'); }
  function say(el, text) {
    const r = el.getBoundingClientRect(), q = document.createElement('span');
    q.className = 'quip'; q.textContent = text; q.setAttribute('aria-hidden', 'true');
    q.style.left = `${r.left + r.width / 2 + scrollX}px`; q.style.top = `${Math.max(r.top, 70) + scrollY}px`;
    document.body.append(q); setTimeout(() => q.remove(), 1500);
  }
  document.addEventListener('click', (e) => {
    const cat = e.target.closest?.('.gary');
    if (cat) { say(cat, purrs[said++ % purrs.length]); return; }
    const b = e.target.closest?.('.bot');
    if (!b || b.closest('button, a')) return;
    hop(b); say(b, quips[said++ % quips.length]);
  });
  // the row at the end hops in, one after another, the first time it is seen
  const row = $('.row');
  if (row && !still && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((en) => en.isIntersecting)) return;
      io.disconnect(); [...row.children].forEach((b, i) => setTimeout(() => hop(b), 200 + i * 110));
    }, { threshold: 0.8 });
    io.observe(row);
  }

  // the real app loads only when asked for
  const tryBtn = $('[data-live]'), frame = $('.app-frame');
  if (tryBtn && frame) tryBtn.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = '/demo/'; f.title = 'the dusk bot app, running on sample data'; f.width = 1180; f.height = 680;
    const fit = () => { f.style.transform = `scale(${frame.clientWidth / 1180})`; };
    fit(); frame.append(f);
    'ResizeObserver' in window ? new ResizeObserver(fit).observe(frame) : addEventListener('resize', fit);
    tryBtn.remove(); f.focus();
  });

  // which ai nova runs on
  const lines = {
    claude: 'nova runs on claude. swap any time: she keeps her chats, files and memory.',
    chatgpt: 'nova is on chatgpt now. she still knows you like the aisle seat.',
    gemini: 'nova is on gemini now. same chats, same files, nothing to move.',
    grok: 'nova is on grok now. that took one click.',
  };
  const aiLine = $('[data-ai-line]');
  for (const b of $$('[data-ai]')) b.addEventListener('click', () => {
    $$('[data-ai]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    if (aiLine) aiLine.textContent = lines[b.dataset.ai];
    const nova = $('.ai-line .bot'); if (nova) hop(nova);
  });

  // copy the install line
  for (const b of $$('[data-copy]')) b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'copied'; }
    catch { const r = document.createRange(); r.selectNodeContents(b.previousElementSibling); const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = 'selected'; }
    setTimeout(() => { b.textContent = 'copy'; }, 1600);
  });

  // monthly or yearly
  for (const b of $$('[data-bill]')) b.addEventListener('click', () => {
    $$('[data-bill]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    $$('[data-month]').forEach((el) => { el.textContent = el.dataset[b.dataset.bill]; });
  });

  // the light changes once: the last scene arrives in daylight and settles into dusk, and stays there
  const end = $('.end'), day = $('[data-day]');
  if (end && day && !still) {
    let p = 0, queued = 0;
    const paint = () => {
      queued = 0;
      const r = end.getBoundingClientRect();
      const now = clamp((innerHeight - r.top) / (innerHeight * 0.8), 0, 1);
      if (now > p) { p = now; day.style.opacity = (1 - p * p * (3 - 2 * p)).toFixed(3); }
      if (p >= 1) { removeEventListener('scroll', ask); day.remove(); }
    };
    const ask = () => { queued ||= requestAnimationFrame(paint); };
    day.style.opacity = '1';
    addEventListener('scroll', ask, { passive: true });
    paint();
  }
})();
