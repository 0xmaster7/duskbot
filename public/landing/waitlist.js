// the waitlist page: the logo's sky and meadow on a canvas sized to the section, slow pixel clouds in three layers, a
// few twinkles, bots out walking in the meadow; then the form, sent to /api/waitlist. motion stops while the tab is
// hidden or the section is off screen, and never starts under reduced motion
{
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hero = $('[data-wl]');

const P = { sky0: '#06bafd', sky1: '#3cd0fd', sky3: '#87e2fc', sky4: '#90e4fc', sky5: '#c2ecfc', lilac: '#d0cefb', lime: '#c9f63f', lime2: '#bdec33', white: '#fdfdfd', pink: '#ffc4dd', lemon: '#fff3a0', lemonDeep: '#ffe25c' };
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
  const cv = $('.wl-sky', hero), ctx = cv.getContext('2d'), col = $('[data-wl-col]', hero), ground = $('[data-wl-ground]', hero);
  const base = document.createElement('canvas'), bctx = base.getContext('2d');
  let W = 0, H = 0, b = 10, clouds = [], stars = [];

  // the still picture: one calm band behind the words, the logo's bands below them with scattered edges, the meadow
  function layout() {
    const box = hero.getBoundingClientRect();
    W = Math.ceil(box.width); H = Math.ceil(box.height);
    if (!W || !H) return false;
    b = W < 700 ? 8 : 10;
    const snap = (v) => Math.round(v / b) * b;
    cv.width = base.width = W; cv.height = base.height = H;
    const G = snap(ground.getBoundingClientRect().top - box.top);
    // the words' own extent: the column itself stretches to fill the sky
    const shown = [...col.children].filter((el) => el.offsetParent), first = shown[0].getBoundingClientRect(), lastEl = shown[shown.length - 1].getBoundingClientRect();
    const top = first.top - box.top, bottom = lastEl.bottom - box.top;
    const calm = Math.min(snap(bottom + 5 * b), G - 6 * b), step = (G - b - calm) / 4;
    const bands = [[P.sky0, 0], [P.sky1, calm], [P.sky3, snap(calm + step)], [P.sky4, snap(calm + 2 * step)], [P.sky5, snap(calm + 3 * step)], [P.lilac, G - b]];
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
    bctx.fillStyle = P.lime; bctx.fillRect(0, G, W, H - G);
    seed = 5; bctx.fillStyle = P.lime2;
    for (let i = 0, n = Math.round((W * (H - G)) / 1400); i < n; i++) bctx.fillRect(snap(rnd() * W), snap(G + b + rnd() * (H - G - b)), b * (rnd() < 0.5 ? 2 : 1), b / 2);
    seed = 3;
    const s = b / 2, cols = [P.white, P.pink, P.lemon];
    for (let i = 0, n = Math.round(W / 90); i < n; i++) {
      const x = snap(rnd() * W), y = snap(G + 2 * b + rnd() * (H - G - 4 * b));
      bctx.fillStyle = cols[i % 3];
      bctx.fillRect(x, y - s, s, s); bctx.fillRect(x - s, y, s, s); bctx.fillRect(x + s, y, s, s); bctx.fillRect(x, y + s, s, s);
      bctx.fillStyle = i % 3 === 2 ? '#ffb020' : P.lemonDeep; bctx.fillRect(x, y, s, s);
    }

    // clouds keep out of the words: they float in the sky above the column and in the bands below it, three layers,
    // the far ones small and slow. the twinkles live only above the column
    seed = 21;
    const zones = [[b * 2, top - 3 * b], [calm + 2 * b, G - 4 * b]].filter(([a, z]) => z - a > 30);
    clouds = [];
    // one cloud per layer, far to near, spread across the width; each drifts at its own pace
    [[0.6, 4, P.lemon], [1, 8, P.pink], [1.35, 13, P.pink]].forEach(([size, speed, under], layer) => {
      const zone = zones[layer === 1 ? zones.length - 1 : 0];
      if (!zone) return;
      const [a, z] = zone, cw = snap(100 * size * (W < 700 ? 0.7 : 1)), ch = snap(cw / 3);
      if (z - a < ch) return;
      clouds.push({ img: cloudSprite(cw, ch, under, b / 2), x: ((layer * 0.37 + 0.12 + rnd() * 0.1) * (W + cw)) - cw, y: snap(a + rnd() * (z - a - ch)), speed, cw });
    });
    stars = [];
    if (top > 4 * b) for (let i = 0, n = Math.round(W / 110); i < n; i++) stars.push({ x: snap(rnd() * W), y: snap(b + rnd() * (top - 3 * b)), ph: rnd() * 6.3, sp: 0.6 + rnd() * 0.8 });
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
    requestAnimationFrame(() => { msg.hidden = false; });
    form.dataset.bad = '';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  };
  const clearError = () => { msg.hidden = true; delete form.dataset.bad; input.removeAttribute('aria-invalid'); };
  input.addEventListener('input', () => { if (!msg.hidden) clearError(); });

  // "n people waiting" only once there are enough of them to say so
  fetch('/api/waitlist/count').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d || !(d.count >= 50)) return;
    const c = $('[data-wl-count]', form);
    c.textContent = `${d.count.toLocaleString('en')} people waiting`; c.hidden = false;
  }).catch(() => {});

  function cheer() {
    const kit = $('.wl-kit svg.bot'), bots = window.duskBots;
    if (bots) {
      bots.react(kit, 'boing');
      $$('[data-walk] svg.bot').forEach((el, i) => setTimeout(() => bots.react(el, 'boing'), 160 + i * 120));
      setTimeout(() => bots.state(kit, 'finished'), 900);
    }
    if (still || !kit) return;
    // a burst of little squares out of kit, the same sparks a poke makes elsewhere on the site
    const r = kit.getBoundingClientRect(), colours = ['#fdfdfd', '#fff3a0', '#ffc4dd', '#c9f63f', '#d0cefb'];
    for (let i = 0; i < 16; i++) {
      const sp = document.createElement('i'), a = -Math.PI * (0.05 + 0.9 * (i / 15)) + (Math.random() - 0.5) * 0.3, d = 60 + Math.random() * 60;
      sp.className = 'spark'; sp.style.background = colours[i % colours.length];
      sp.style.left = `${r.left + r.width / 2 + scrollX - 4}px`; sp.style.top = `${r.top + r.height * 0.4 + scrollY - 4}px`;
      sp.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(0)}px`); sp.style.setProperty('--dy', `${(Math.sin(a) * d).toFixed(0)}px`);
      document.body.append(sp); setTimeout(() => sp.remove(), 760);
    }
  }

  function joined(position, email, already) {
    $$('[data-wl-num]').forEach((el) => { el.textContent = `#${position.toLocaleString('en')}`; });
    title.textContent = "you're on the list.";
    lede.textContent = '';
    lede.append(already ? 'you were already on it. ' : '', "we'll write to ", Object.assign(document.createElement('b'), { textContent: email }), " when it's your turn.");
    form.hidden = true; done.hidden = false;
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
