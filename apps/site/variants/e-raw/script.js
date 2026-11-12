(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const replay = (el, cls = 'is-pop') => { el.classList.remove(cls); void el.getBoundingClientRect(); el.classList.add(cls); };

  // every bot looks at the pointer
  const bots = $$('.bot');
  let seen = new Set(bots), look = 0, px = 0, py = 0;
  if ('IntersectionObserver' in window) {
    seen = new Set();
    const io = new IntersectionObserver((es) => { for (const e of es) e.isIntersecting ? seen.add(e.target) : seen.delete(e.target); });
    bots.forEach((b) => io.observe(b));
  }
  function gaze() {
    look = 0;
    for (const b of seen) {
      const r = b.getBoundingClientRect();
      if (!r.width) continue;
      const dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, d / 240) * 6;
      b.querySelector('.eyes').style.transform = `translate(${(dx / d * reach).toFixed(2)}px, ${(dy / d * reach * 0.8).toFixed(2)}px)`;
    }
  }
  if (!still && fine) addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; look ||= requestAnimationFrame(gaze); }, { passive: true });

  // the word in the headline swaps between jobs, and the bot changes with it
  const JOBS = [
    ['inbox', 'heart', 'pink', -8, '--pink'], ['research', 'circle', 'blue', 0, '--sky'], ['bugs', 'hex', 'orange', 0, '--peach'],
    ['receipts', 'star', 'green', 4, '--mint'], ['trip', 'clover', 'purple', 0, '--lilac'], ['socials', 'drop', 'yellow', 14, '--lemon'],
  ];
  const swap = $('#swap'), heroBot = $('#hero-bot'), swapCursor = $('#swap-cursor');
  if (swap && heroBot) {
    let at = 0, timer = 0, auto = true, vis = true;
    const next = () => {
      at = (at + 1) % JOBS.length;
      const [word, shape, colour, eyeY, tint] = JOBS[at];
      swap.textContent = word;
      swap.style.setProperty('--tint', `var(${tint})`);
      heroBot.classList.remove(...JOBS.map((j) => j[2]));
      heroBot.classList.add(colour);
      heroBot.querySelector('.body').setAttribute('href', `#b-${shape}`);
      heroBot.querySelector('.eyes').setAttribute('y', eyeY);
      if (!still) { replay(swap); replay(heroBot); if (swapCursor) replay(swapCursor); }
    };
    const run = () => { clearInterval(timer); if (!still && auto && vis && !document.hidden) timer = setInterval(next, 2400); };
    // a click takes the wheel: it steps the word and the page stops changing it for you
    swap.addEventListener('click', () => { next(); auto = false; run(); });
    document.addEventListener('visibilitychange', run);
    if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { vis = e.isIntersecting; run(); }).observe(swap);
    run();
  }

  // stickers: drag them with a mouse, poke them on touch. they lean into the move and wobble when dropped
  const live = new Set();
  let raf = 0, last = 0;
  function tick(t) {
    const dt = Math.min(0.032, (t - last) / 1000) || 0.016;
    last = t;
    for (const s of live) step(s, dt);
    raf = live.size ? requestAnimationFrame(tick) : 0;
  }
  function wake(s) { live.add(s); if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function step(s, dt) {
    if (s.held) { s.tr = clamp(s.pvx * 0.02, -18, 18); s.pvx *= 0.86; s.pvy *= 0.86; }
    s.vr += (-170 * (s.r - s.tr) - (s.held ? 16 : 9) * s.vr) * dt;
    s.r += s.vr * dt;
    if (!s.held && s.home) {
      s.vx += (-190 * s.x - 15 * s.vx) * dt; s.vy += (-190 * s.y - 15 * s.vy) * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
    }
    const calm = !s.held && Math.abs(s.r) < 0.05 && Math.abs(s.vr) < 0.6 && (!s.home || (Math.hypot(s.x, s.y) < 0.3 && Math.hypot(s.vx, s.vy) < 4));
    if (calm) { s.r = 0; s.vr = 0; if (s.home) { s.x = 0; s.y = 0; } live.delete(s); }
    s.el.style.translate = `${s.x.toFixed(1)}px ${s.y.toFixed(1)}px`;
    s.el.style.rotate = `${(s.base + s.r).toFixed(2)}deg`;
  }
  const stickers = $$('[data-sticker]');
  for (const el of stickers) {
    const base = parseFloat(getComputedStyle(el).rotate) || 0;
    const s = { el, base, home: el.dataset.sticker === 'home', x: 0, y: 0, r: 0, vx: 0, vy: 0, vr: 0, tr: 0, pvx: 0, pvy: 0, held: false };
    let sx = 0, sy = 0, lx = 0, ly = 0, lt = 0, moved = 0;
    const poke = () => { if (still) return; s.vr += (Math.random() < 0.5 ? -1 : 1) * 420; if (s.home) s.vy -= 620; wake(s); };
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, a')) return;
      if (e.pointerType === 'touch' || still) { poke(); return; }
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      s.held = true; s.vx = s.vy = 0; moved = 0;
      sx = e.clientX - s.x; sy = e.clientY - s.y; lx = e.clientX; ly = e.clientY; lt = e.timeStamp;
      el.classList.add('is-held');
      wake(s);
    });
    el.addEventListener('pointermove', (e) => {
      if (!s.held) return;
      const dt = Math.max(1, e.timeStamp - lt) / 1000;
      s.pvx = s.pvx * 0.6 + ((e.clientX - lx) / dt) * 0.4; s.pvy = s.pvy * 0.6 + ((e.clientY - ly) / dt) * 0.4;
      moved += Math.abs(e.clientX - lx) + Math.abs(e.clientY - ly);
      lx = e.clientX; ly = e.clientY; lt = e.timeStamp;
      s.x = e.clientX - sx; s.y = e.clientY - sy;
    });
    const drop = () => {
      if (!s.held) return;
      s.held = false; s.tr = 0;
      s.vr += clamp(s.pvx * 0.06, -260, 260);
      if (s.home) { s.vx = clamp(s.pvx, -1800, 1800); s.vy = clamp(s.pvy, -1800, 1800); }
      if (moved < 4) poke();
      s.pvx = s.pvy = 0;
      el.classList.remove('is-held');
      wake(s);
    };
    el.addEventListener('pointerup', drop);
    el.addEventListener('pointercancel', drop);
  }
  // stickers get slapped on as they scroll into view; nothing is hidden unless this script is running
  if (!still && 'IntersectionObserver' in window) {
    const slap = new IntersectionObserver((es) => {
      let n = 0;
      for (const e of es) {
        if (!e.isIntersecting && e.boundingClientRect.top > 0) continue;
        slap.unobserve(e.target);
        setTimeout(() => e.target.classList.remove('pre'), 70 * n++);
      }
    }, { rootMargin: '0px 0px -8% 0px' });
    for (const el of $$('.stk')) { el.classList.add('pre'); slap.observe(el); }
  }

  // the big red button asks first, like the bots do
  const dnp = $('#dnp'), ask = $('#ask');
  if (dnp && ask) {
    const q = $('#ask-q'), a = $('#ask-a'), acts = $('#ask-acts');
    const close = () => { ask.hidden = true; dnp.setAttribute('aria-expanded', 'false'); dnp.classList.remove('is-down'); };
    const burst = () => {
      if (still || !ask.animate) return;
      const host = ask.parentElement, r = dnp.getBoundingClientRect(), h = host.getBoundingClientRect();
      const cols = ['#2f7bf2', '#ff7d1f', '#8d5cf0', '#ff5c9d', '#1fb866', '#f8c623'];
      for (let i = 0; i < 18; i++) {
        const b = document.createElement('i');
        b.className = 'bit';
        b.style.background = cols[i % cols.length];
        b.style.left = `${r.left - h.left + r.width / 2 - 6}px`; b.style.top = `${r.top - h.top + r.height / 2 - 6}px`;
        host.append(b);
        const ang = -Math.PI * (0.1 + 0.8 * Math.random()), d = 90 + Math.random() * 150;
        b.animate([{ transform: 'translate(0, 0) rotate(0deg)', opacity: 1 }, { transform: `translate(${(Math.cos(ang) * d).toFixed(0)}px, ${(Math.sin(ang) * d).toFixed(0)}px) rotate(${(Math.random() * 180).toFixed(0)}deg)`, opacity: 1, offset: 0.7 }, { transform: `translate(${(Math.cos(ang) * d).toFixed(0)}px, ${(Math.sin(ang) * d + 60).toFixed(0)}px) rotate(200deg)`, opacity: 0 }], { duration: 900, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }).onfinish = () => b.remove();
      }
    };
    const pills = (list) => { acts.replaceChildren(...list.map(([label, key, soft]) => { const b = document.createElement('button'); b.type = 'button'; b.className = `pill pill-s${soft ? ' pill-soft' : ''}`; b.dataset.ask = key; b.textContent = label; return b; })); };
    dnp.addEventListener('click', () => {
      if (!ask.hidden) { close(); return; }
      q.textContent = 'are you sure?'; a.hidden = true;
      pills([['allow', 'allow'], ['deny', 'deny', true]]);
      ask.hidden = false; dnp.setAttribute('aria-expanded', 'true'); dnp.classList.add('is-down');
      if (!still) replay(ask, 'is-in');
    });
    acts.addEventListener('click', (e) => {
      const key = e.target.closest('[data-ask]')?.dataset.ask;
      if (!key) return;
      if (key === 'ok') { close(); dnp.focus(); return; }
      if (key === 'allow') { q.textContent = 'pressed.'; a.textContent = 'nothing exploded. it is not wired to anything. real bots stop and ask like this before sending, buying or deleting.'; burst(); }
      else { q.textContent = 'good call.'; a.textContent = 'real bots stop and ask like this before sending, buying or deleting. you allow or deny.'; }
      a.hidden = false; dnp.classList.remove('is-down');
      pills([['ok', 'ok']]);
      acts.firstChild.focus();
    });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ask.hidden) { close(); dnp.focus(); } });
  }

  // the tape of models runs sideways; without motion it stays a plain wrapped list
  const tape = $('#tape'), pause = $('#tape-pause');
  if (tape && !still) {
    const run = $('.tape-run', tape);
    for (const li of [...run.children]) { const c = li.cloneNode(true); c.setAttribute('aria-hidden', 'true'); run.append(c); }
    tape.classList.add('is-run');
    if (pause) {
      pause.hidden = false;
      pause.addEventListener('click', () => {
        const off = tape.classList.toggle('is-paused');
        pause.setAttribute('aria-pressed', String(off)); pause.textContent = off ? 'run the tape' : 'pause the tape';
      });
    }
  }

  // copy the install line
  const copy = $('#copy'), curl = $('#curl');
  if (copy && curl) copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(curl.textContent); copy.textContent = 'copied'; }
    catch { const r = document.createRange(); r.selectNodeContents(curl); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); copy.textContent = 'selected'; }
    setTimeout(() => { copy.textContent = 'copy'; }, 1600);
  });

  // monthly or yearly
  const bills = $$('.bill-b');
  for (const b of bills) b.addEventListener('click', () => {
    const period = b.dataset.bill;
    for (const o of bills) o.setAttribute('aria-pressed', String(o === b));
    for (const el of $$(`[data-${period}]`)) el.textContent = el.dataset[period];
  });

  // the live app loads only when someone asks for it
  const tryIt = $('#try'), demo = $('#demo'), fit = $('#demo-fit'), frame = $('#demo-frame');
  if (tryIt && demo && demo.showModal) {
    const wide = matchMedia('(min-width: 900px)');
    const size = () => {
      const k = Math.min(1, (innerWidth * 0.94) / 1180, (innerHeight * 0.94 - 64) / 680);
      frame.style.transform = `scale(${k})`;
      fit.style.width = `${Math.floor(1180 * k)}px`; fit.style.height = `${Math.floor(680 * k)}px`;
    };
    tryIt.hidden = !wide.matches;
    wide.addEventListener('change', () => { tryIt.hidden = !wide.matches; });
    tryIt.addEventListener('click', () => {
      if (!$('iframe', frame)) {
        const f = document.createElement('iframe');
        f.src = '/demo/'; f.width = 1180; f.height = 680; f.title = 'the dusk bot app';
        frame.append(f);
      }
      size(); demo.showModal();
    });
    $('#demo-close')?.addEventListener('click', () => demo.close());
    demo.addEventListener('close', () => $('iframe', frame)?.remove());
    addEventListener('resize', () => { if (demo.open) size(); });
  }
})();
