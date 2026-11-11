// the waitlist page: draws the logo's pixel world behind the section at whatever size it is, sends the form to
// /api/waitlist, and lets kit and friends cheer when you are in
{
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hero = $('[data-wl]');

// the world. the logo's sky bands with their edges scattered, a lilac line, the lime meadow with a hill under kit,
// grass flecks and a few flowers. every block sits on one grid so it stays crisp
const P = { sky0: '#06bafd', sky1: '#3cd0fd', sky3: '#87e2fc', sky4: '#90e4fc', sky5: '#c2ecfc', lilac: '#d0cefb', lime: '#c9f63f', lime2: '#bdec33', white: '#fdfdfd', pink: '#ffc4dd', lemon: '#fff3a0', lemonDeep: '#ffe25c' };
let seed = 7;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function draw() {
  const cv = $('.wl-sky', hero), ground = $('[data-wl-ground]', hero), hill = $('[data-wl-hill]', hero);
  const box = hero.getBoundingClientRect(), w = Math.ceil(box.width), h = Math.ceil(box.height);
  if (!w || !h) return;
  const dpr = Math.min(devicePixelRatio || 1, 2), b = w < 700 ? 8 : 10, snap = (v) => Math.round(v / b) * b;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false;
  const G = snap(ground.getBoundingClientRect().top - box.top);

  const bands = [[P.sky0, 0], [P.sky1, snap(G * 0.18)], [P.sky3, snap(G * 0.5)], [P.sky4, snap(G * 0.64)], [P.sky5, snap(G * 0.78)], [P.lilac, G - b]];
  bands.forEach(([c, y], i) => { ctx.fillStyle = c; ctx.fillRect(0, y, w, (bands[i + 1]?.[1] ?? G) - y); });
  seed = 11;
  for (let i = 1; i < bands.length - 1; i++) {
    const [c, y] = bands[i], [cp] = bands[i - 1];
    [0.42, 0.16, 0.05].forEach((p, k) => {
      for (let x = 0; x < w; x += b) {
        if (rnd() < p) { ctx.fillStyle = c; ctx.fillRect(x, y - (k + 1) * b, b, b); }
        if (k === 0 && rnd() < 0.1) { ctx.fillStyle = cp; ctx.fillRect(x, y, b, b); }
      }
    });
  }

  // two calm clouds, white over a tinted underside, kept to the right so they never sit under the words
  const cloud = (x, y, cw, ch, under) => {
    const lumps = [[0.5, 0.62, 0.5, 0.38], [0.33, 0.5, 0.2, 0.42], [0.62, 0.36, 0.22, 0.5]], s = b / 2;
    const test = (px, py) => { const u = px / cw, v = py / ch; return v <= 0.95 && (lumps.some(([cx, cy, rx, ry]) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 < 1) || (v > 0.6 && u > 0.04 && u < 0.96)); };
    for (const [col, dy, t] of [[under, 0, test], [P.white, -s, (px, py) => test(px, py + s) && test(px, py + 2 * s)]]) {
      ctx.fillStyle = col;
      for (let py = 0; py < ch; py += s) for (let px = 0; px < cw; px += s) if (t(px + s / 2, py + s / 2)) ctx.fillRect(snap(x) + px, snap(y) + dy + py, s, s);
    }
  };
  // on one column the words fill the top, so the clouds only come out on wide screens
  if (w >= 900) { cloud(w * 0.6, G * 0.13, 150, 50, P.pink); cloud(w * 0.86, G * 0.34, 110, 38, P.lemon); }

  // the meadow, rising into a hill under the hill box
  const hb = hill.getBoundingClientRect(), cx = hb.left - box.left + hb.width / 2, half = hb.width / 2, top = hb.top - box.top;
  ctx.fillStyle = P.lime;
  for (let x = 0; x < w; x += b) {
    const d = Math.abs(x + b / 2 - cx) / half, y = d < 1 ? snap(G - (G - top) * (1 - d * d) ** 0.7) : G;
    ctx.fillRect(x, y, b, h - y);
  }
  seed = 5; ctx.fillStyle = P.lime2;
  for (let i = 0, n = Math.round((w * (h - G)) / 1400); i < n; i++) ctx.fillRect(snap(rnd() * w), snap(G + b + rnd() * (h - G - b)), b * (rnd() < 0.5 ? 2 : 1), b / 2);
  seed = 3;
  const s = b / 2, cols = [P.white, P.pink, P.lemon];
  for (let i = 0, n = Math.round(w / 90); i < n; i++) {
    const x = snap(rnd() * w), y = snap(G + 2 * b + rnd() * (h - G - 4 * b));
    ctx.fillStyle = cols[i % 3];
    ctx.fillRect(x, y - s, s, s); ctx.fillRect(x - s, y, s, s); ctx.fillRect(x + s, y, s, s); ctx.fillRect(x, y + s, s, s);
    ctx.fillStyle = i % 3 === 2 ? '#ffb020' : P.lemonDeep; ctx.fillRect(x, y, s, s);
  }
}
if (hero) {
  let queued = 0;
  const later = () => { if (!queued) queued = requestAnimationFrame(() => { queued = 0; draw(); }); };
  if ('ResizeObserver' in window) new ResizeObserver(later).observe(hero); else addEventListener('resize', later);
  document.fonts?.ready.then(later);
  later();
}

// the form
const form = $('[data-wl-form]');
if (form) {
  const input = $('#wl-email', form), go = $('[data-wl-go]', form), msg = $('#wl-msg', form), label = go.textContent;
  const title = $('[data-wl-title]'), lede = $('[data-wl-lede]'), done = $('[data-wl-done]'), say = $('[data-wl-say]');
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
    const kit = $('.wl-kit svg.bot'), friends = $$('.wl-f svg.bot');
    const bots = window.duskBots;
    if (bots) {
      bots.react(kit, 'boing');
      friends.forEach((el, i) => setTimeout(() => bots.react(el, i % 2 ? 'hop' : 'boing'), 140 + i * 110));
      setTimeout(() => bots.state(kit, 'finished'), 900);
    }
    if (still || !kit) return;
    // a burst of little squares out of kit, the same sparks a poke makes elsewhere on the site
    const r = kit.getBoundingClientRect(), colours = ['#2f7bf2', '#ff7d1f', '#8d5cf0', '#ff5c9d', '#1fb866', '#f8c623'];
    for (let i = 0; i < 14; i++) {
      const sp = document.createElement('i'), a = -Math.PI * (0.1 + 0.8 * (i / 13)) + (Math.random() - 0.5) * 0.3, d = 70 + Math.random() * 60;
      sp.className = 'spark'; sp.style.background = colours[i % colours.length];
      sp.style.left = `${r.left + r.width / 2 + scrollX - 4}px`; sp.style.top = `${r.top + r.height * 0.35 + scrollY - 4}px`;
      sp.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(0)}px`); sp.style.setProperty('--dy', `${(Math.sin(a) * d).toFixed(0)}px`);
      document.body.append(sp); setTimeout(() => sp.remove(), 760);
    }
  }

  function joined(position, email, already) {
    const n = `#${position.toLocaleString('en')}`;
    $$('[data-wl-num]').forEach((el) => { el.textContent = n; });
    title.textContent = "you're on the list.";
    lede.textContent = '';
    lede.append(already ? 'you were already on it, so you keep your spot. ' : '', "we'll write to ", Object.assign(document.createElement('b'), { textContent: email }), " when it's your turn. it won't be long.");
    form.hidden = true; done.hidden = false;
    $('[data-say="idle"]', say).hidden = true; $('[data-say="done"]', say).hidden = false;
    say.classList.remove('pop'); void say.offsetWidth; say.classList.add('pop');
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
