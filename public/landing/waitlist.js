// the waitlist page: the x banner's sky and meadow on a canvas sized to the section, slow pixel clouds in three layers,
// a few twinkles, bots out walking in the meadow; then the form, sent to /api/waitlist. motion stops while the tab is
// hidden or the section is off screen, and never starts under reduced motion
{
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hero = $('[data-wl]');

const P = { sky0: '#06bafd', sky1: '#3cd0fd', sky4: '#90e4fc', sky5: '#c2ecfc', lilac: '#d0cefb', lime: '#c9f63f', lime2: '#c6f43a', white: '#fdfdfd', pink: '#ffc4dd', lemon: '#fff3a0', lemonDeep: '#ffe25c' };
let seed = 7;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// a calm pixel cloud as its own little canvas: white body over a tinted underside, blocks of s
function cloudSprite(cw, ch, under, s) {
  const c = document.createElement('canvas'); c.width = cw; c.height = ch + s;
  const x = c.getContext('2d');
  const lumps = [[0.5, 0.62, 0.5, 0.38], [0.33, 0.5, 0.2, 0.42], [0.62, 0.36, 0.22, 0.5]];
  const test = (px, py) => { const u = px / cw, v = py / ch; return v <= 0.95 && (lumps.some(([cx, cy, rx, ry]) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 < 1) || (v > 0.6 && u > 0.04 && u < 0.96)); };
  for (const [col, dy, t] of [[under, s, test], [P.white, 0, (px, py) => test(px, py + s) && test(px, py + 2 * s)]]) {
    x.fillStyle = col;
    for (let py = 0; py < ch; py += s) for (let px = 0; px < cw; px += s) if (t(px + s / 2, py + s / 2)) x.fillRect(px, py + dy, s, s);
  }
  return c;
}

if (hero) {
  const cv = $('.wl-sky', hero), ctx = cv.getContext('2d'), col = $('[data-wl-col]', hero), ground = $('[data-wl-ground]', hero), hill = $('[data-wl-hill]', hero);
  const base = document.createElement('canvas'), bctx = base.getContext('2d');
  let W = 0, H = 0, b = 10, clouds = [], stars = [];

  // the still picture, as the x banner draws it (omb-ref/brand/x-banners/lib/world.js): the logo sky with its middle
  // scatter strip left out, so the words sit on one clean blue; a lilac line; the meadow rising into pip's hill;
  // grass flecks and flowers; and each chat bubble's stepped tail
  function layout() {
    const box = hero.getBoundingClientRect();
    W = Math.ceil(box.width); H = Math.ceil(box.height);
    if (!W || !H) return false;
    b = 10;
    const snap = (v) => Math.round(v / b) * b, s = b / 2;
    cv.width = base.width = W; cv.height = base.height = H;
    const G = snap(ground.getBoundingClientRect().top - box.top);
    const shown = [...col.children].filter((el) => el.offsetParent), first = shown[0].getBoundingClientRect(), lastEl = shown[shown.length - 1].getBoundingClientRect();
    const top = first.top - box.top, bottom = lastEl.bottom - box.top;
    const f = (t) => snap(t * G);
    const bands = [[P.sky0, 0], [P.sky1, Math.min(f(0.2), snap(top - 4 * b))], [P.sky4, Math.max(f(0.8), snap(bottom + 4 * b))], [P.sky5, Math.max(f(0.9), snap(bottom + 7 * b))], [P.lilac, G - b]].filter((band, i, all) => i === 0 || band[1] > all[i - 1][1]);
    bctx.imageSmoothingEnabled = false;
    bands.forEach(([c, y], i) => { bctx.fillStyle = c; bctx.fillRect(0, y, W, (bands[i + 1]?.[1] ?? G) - y); });
    seed = 11;
    for (let i = 1; i < bands.length - 1; i++) {
      const [c, y] = bands[i], [cp] = bands[i - 1];
      [0.42, 0.16, 0.05].forEach((p, k) => {
        for (let x = 0; x < W; x += b) {
          if (rnd() < p) { bctx.fillStyle = c; bctx.fillRect(x, y - (k + 1) * b, b, b); }
          if (k === 0 && rnd() < 0.1) { bctx.fillStyle = cp; bctx.fillRect(x, y, b, b); }
        }
      });
    }
    const hb = hill.getBoundingClientRect(), hx = hb.left - box.left + hb.width / 2, half = hb.width / 2, rise = hb.height;
    bctx.fillStyle = P.lime;
    for (let x = 0; x < W; x += b) {
      const d = Math.abs(x + b / 2 - hx) / half, y = d < 1 ? snap(G - rise * (1 - d * d) ** 0.7) : G;
      bctx.fillRect(x, y, b, H - y);
    }
    seed = 4; bctx.fillStyle = P.lime2;
    for (let i = 0, n = Math.round((W * (H - G)) / 1100); i < n; i++) bctx.fillRect(Math.round((rnd() * W) / s) * s, Math.round((G + b + rnd() * (H - G - b)) / s) * s, s * (rnd() < 0.5 ? 2 : 1), s);
    seed = 2;
    const cols = [P.white, P.pink, P.lemon];
    for (let i = 0, n = Math.max(6, Math.round(W / 110)); i < n; i++) {
      const x = Math.round((rnd() * W) / s) * s, y = Math.round((G + 3 * b + rnd() * (H - G - 5 * b)) / s) * s;
      bctx.fillStyle = cols[i % 3];
      bctx.fillRect(x, y - s, s, s); bctx.fillRect(x - s, y, s, s); bctx.fillRect(x + s, y, s, s); bctx.fillRect(x, y + s, s, s);
      bctx.fillStyle = i % 3 === 2 ? '#ffb020' : P.lemonDeep; bctx.fillRect(x, y, s, s);
    }
    for (const bub of $$('.wl-bub', hero)) {
      if (!bub.offsetParent) continue;
      const r = bub.getBoundingClientRect(), x = Math.round((r.left - box.left) / s) * s, w = Math.round(r.width / s) * s, y = Math.round((r.bottom - box.top) / s) * s;
      const right = bub.classList.contains('b-pip'), under = getComputedStyle(bub).getPropertyValue('--u').trim() || P.pink;
      const tx = right ? x + w - 9 * s : x + 5 * s;
      for (let i = 0; i < 4; i++) {
        const xx = right ? tx + i * s : tx - i * s + 3 * s;
        bctx.fillStyle = under; bctx.fillRect(xx, y + i * s, (4 - i) * s, s);
        bctx.fillStyle = P.white; bctx.fillRect(xx, y - 2 * s + i * s, (4 - i) * s, s);
      }
    }

    // clouds keep out of the words: one per layer, far to near, in the sky above the column or in the pale bands
    // below it; the twinkles live only above the column
    seed = 21;
    const zones = [[2 * b, top - 3 * b], [bottom + 3 * b, G - 4 * b]].filter(([a, z]) => z - a > 30);
    clouds = [];
    [[0.6, 4, P.lemon], [0.9, 8, P.pink], [1.2, 12, P.pink]].forEach(([size, speed, under], layer) => {
      const zone = zones[layer === 1 ? zones.length - 1 : 0];
      if (!zone) return;
      const [a, z] = zone, cw = snap(110 * size * (W < 700 ? 0.7 : 1)), ch = snap(cw / 3);
      if (z - a < ch) return;
      clouds.push({ img: cloudSprite(cw, ch, under, s), x: ((layer * 0.37 + 0.08 + rnd() * 0.1) * (W + cw)) - cw, y: snap(a + rnd() * (z - a - ch)), speed, cw });
    });
    stars = [];
    if (top > 6 * b) for (let i = 0, n = Math.round(W / 120); i < n; i++) stars.push({ x: snap(rnd() * W), y: snap(b + rnd() * (top - 4 * b)), ph: rnd() * 6.3, sp: 0.6 + rnd() * 0.8 });
    return true;
  }

  function frame(t) {
    ctx.drawImage(base, 0, 0);
    const s = b / 2;
    for (const st of stars) {
      // twinkles step through three brightnesses, never a smooth fade, so they stay pixels
      const v = Math.sin(t / 1000 * st.sp + st.ph);
      if (v < 0.55) continue;
      ctx.globalAlpha = v > 0.9 ? 0.95 : 0.5; ctx.fillStyle = P.white; ctx.fillRect(st.x, st.y, s, s);
      if (v > 0.9) { ctx.globalAlpha = 0.5; ctx.fillRect(st.x - s, st.y, s, s); ctx.fillRect(st.x + s, st.y, s, s); ctx.fillRect(st.x, st.y - s, s, s); ctx.fillRect(st.x, st.y + s, s, s); }
    }
    ctx.globalAlpha = 1;
    for (const c of clouds) {
      const x = ((c.x + (t / 1000) * c.speed) % (W + c.cw) + W + c.cw) % (W + c.cw) - c.cw;
      ctx.drawImage(c.img, Math.round(x / s) * s, c.y);
    }
  }

  // the bots out walking: each strolls along its row of the meadow, stops now and then, sometimes hops, turns at the edges
  const walkers = $$('[data-walk]', hero).map((el, i) => ({ el, x: 0, dir: i % 2 ? -1 : 1, speed: 14 + i * 4, rest: 0, i }));
  const placeWalkers = () => walkers.forEach((w, i) => {
    w.x = (W * (0.12 + i * 0.24)) % W;
    w.el.classList.add('on');
    w.el.style.transform = `translateX(${Math.round(w.x)}px)`;
  });
  function walk(dt, t) {
    for (const w of walkers) {
      const size = w.el.offsetWidth || 32;
      if (t < w.rest) continue;
      w.x += w.dir * w.speed * dt;
      if (w.x < 8) { w.x = 8; w.dir = 1; } else if (w.x > W - size - 8) { w.x = W - size - 8; w.dir = -1; }
      w.el.classList.toggle('left', w.dir < 0);
      // whole pixels of the bot's own grid, so it steps like a sprite rather than gliding
      const grid = size / 20;
      w.el.style.transform = `translateX(${Math.round(w.x / grid) * grid}px)`;
      if (Math.random() < dt / 7) {
        w.rest = t + 1400 + Math.random() * 2600;
        if (Math.random() < 0.5) setTimeout(() => window.duskBots?.react(w.el, 'hop'), 400);
        if (Math.random() < 0.35) w.dir *= -1;
      }
    }
  }

  let raf = 0, last = 0, visible = true;
  const loop = (t) => {
    const dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    frame(t); walk(dt, t);
    raf = requestAnimationFrame(loop);
  };
  const run = () => {
    const go = !still && visible && document.visibilityState === 'visible';
    if (go && !raf) { last = 0; raf = requestAnimationFrame(loop); }
    if (!go && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  let queued = 0;
  const redo = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; if (layout()) { frame(performance.now()); if (!raf) placeWalkers(); } }); };
  if ('ResizeObserver' in window) { const ro = new ResizeObserver(redo); ro.observe(hero); ro.observe(col); } else addEventListener('resize', redo);
  document.fonts?.ready.then(redo);
  // the column's box stays put when its words change, so joining asks for a new picture itself
  hero.addEventListener('wl:layout', redo);
  document.addEventListener('visibilitychange', run);
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; run(); }).observe(hero);
  if (layout()) { frame(performance.now()); placeWalkers(); }
  run();
}

// the form
const form = $('[data-wl-form]');
if (form) {
  const input = $('#wl-email', form), go = $('[data-wl-go]', form), msg = $('#wl-msg', form), label = go.textContent;
  const title = $('[data-wl-title]'), lede = $('[data-wl-lede]'), done = $('[data-wl-done]');
  const params = new URLSearchParams(location.search);
  const source = params.get('source') || params.get('utm_source') || 'site', ref = params.get('ref') || '';
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const COPY = {
    bad_email: "that doesn't look like an email address. check it for a typo and try again.",
    empty: 'type your email first, then join.',
    offline: "that didn't reach us. check your connection and try again.",
  };

  const showError = (text) => {
    msg.hidden = true;
    $('[data-wl-err]', msg).textContent = text;
    // unhidden on the next frame, so a second error in a row is read out again
    requestAnimationFrame(() => { msg.hidden = false; hero.dispatchEvent(new Event('wl:layout')); });
    form.dataset.bad = '';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };
  const clearError = () => { msg.hidden = true; delete form.dataset.bad; input.removeAttribute('aria-invalid'); hero.dispatchEvent(new Event('wl:layout')); };
  input.addEventListener('input', () => { if (!msg.hidden) clearError(); });

  // "n people waiting" only once there are enough of them to say so
  fetch('/api/waitlist/count').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d || !(d.count >= 50)) return;
    const c = $('[data-wl-count]', form);
    c.textContent = `${d.count.toLocaleString('en')} people waiting`; c.hidden = false;
  }).catch(() => {});

  function cheer() {
    const bots = window.duskBots, all = $$('.wl-art svg.bot, [data-walk] svg.bot');
    if (bots) all.forEach((el, i) => setTimeout(() => bots.react(el, 'boing'), i * 110));
    const ticket = $('.wl-ticket');
    if (still || !ticket) return;
    // a burst of little squares off the top of the ticket, the same sparks a poke makes elsewhere on the site
    const r = ticket.getBoundingClientRect(), colours = ['#fdfdfd', '#fff3a0', '#ffc4dd', '#c9f63f', '#d0cefb'];
    for (let i = 0; i < 18; i++) {
      const sp = document.createElement('i'), a = -Math.PI * (0.04 + 0.92 * (i / 17)) + (Math.random() - 0.5) * 0.3, d = 70 + Math.random() * 70;
      sp.className = 'spark'; sp.style.background = colours[i % colours.length];
      sp.style.left = `${r.left + r.width / 2 + scrollX - 4}px`; sp.style.top = `${r.top + 8 + scrollY - 4}px`;
      sp.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(0)}px`); sp.style.setProperty('--dy', `${(Math.sin(a) * d).toFixed(0)}px`);
      document.body.append(sp); setTimeout(() => sp.remove(), 760);
    }
  }

  function joined(position, email, already) {
    $$('[data-wl-num]').forEach((el) => { el.textContent = `#${position.toLocaleString('en')}`; });
    title.textContent = "you're on the list.";
    lede.textContent = '';
    lede.append(already ? 'you were already on it. ' : '', "we'll write to ", Object.assign(document.createElement('b'), { textContent: email }), " when it's your turn.");
    form.hidden = true; done.hidden = false; hero.classList.add('is-done');
    hero.dispatchEvent(new Event('wl:layout'));
    document.title = "You're on the list · Dusk Bot";
    title.focus();
    cheer();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (go.disabled) return;
    const email = input.value.trim();
    if (!email) return showError(COPY.empty);
    if (email.length > 254 || !EMAIL.test(email)) return showError(COPY.bad_email);
    clearError();
    go.disabled = true; go.textContent = 'joining…'; form.setAttribute('aria-busy', 'true');
    try {
      const r = await fetch('/api/waitlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, source, ref: ref || undefined, website: $('#wl-website', form).value }) });
      const d = await r.json().catch(() => ({}));
      if (d.ok) return joined(d.position, email.toLowerCase(), d.already);
      showError(d.message || COPY.offline);
    } catch {
      showError(COPY.offline);
    } finally {
      go.disabled = false; go.textContent = label; form.removeAttribute('aria-busy');
    }
  });
}
}
