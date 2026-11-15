// paints each [data-sky] element as the waitlist's pixel sky: flat bands with a 10px scatter at each seam.
// data-sky="#06bafd 0, #3cd0fd 100px, #90e4fc @.win-150": a stop is a fraction of the height, px from the top, or
// @selector±px (that element's top). data-ground, data-hills "x width rise, ...", data-stars, data-flowers, data-seed
(() => {
  let seed = 7;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const b = 10, s = 5, snap = (v) => Math.round(v / b) * b;
  const at = (el, tok, H) => {
    if (tok.endsWith('px')) return snap(parseFloat(tok));
    if (tok.startsWith('@')) {
      const [, sel, off] = /^@([^+-]+)([+-]\d+)?$/.exec(tok);
      const t = el.querySelector(sel);
      return snap(t ? t.getBoundingClientRect().top - el.getBoundingClientRect().top + (+off || 0) : H);
    }
    return snap(+tok * H);
  };
  const hillsOf = (el) => (el.dataset.hills || '').split(',').filter(Boolean).map((h) => h.trim().split(/\s+/).map(Number));
  const groundY = (x, G, W, hills) => { let y = G; for (const [cx, hw, rise] of hills) { const d = Math.abs(x - cx * W) / hw; if (d < 1) y = Math.min(y, snap(G - rise * (1 - d * d) ** 0.7)); } return y; };
  function paint(el) {
    let cv = el.querySelector(':scope > .sky-cv');
    if (!cv) { cv = document.createElement('canvas'); cv.className = 'sky-cv'; cv.setAttribute('aria-hidden', 'true'); el.prepend(cv); }
    const W = el.offsetWidth, H = el.offsetHeight;
    if (!W || !H) return;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    seed = +(el.dataset.seed || 11);
    const bands = el.dataset.sky.split(',').map((p) => { const [c, f] = p.trim().split(/\s+/); return [c, at(el, f, H)]; });
    let G = H, gc = null;
    const hills = hillsOf(el);
    if (el.dataset.ground) { const [c, f] = el.dataset.ground.split(/\s+/); gc = c; G = at(el, f, H); bands.push([el.dataset.line || '#d0cefb', G - b]); }
    bands.forEach(([c, y], i) => { ctx.fillStyle = c; ctx.fillRect(0, y, W, (bands[i + 1]?.[1] ?? G) - y); });
    for (let i = 1; i < bands.length; i++) {
      const [c, y] = bands[i], [cp] = bands[i - 1];
      if (i === bands.length - 1 && gc) continue;
      [0.42, 0.16, 0.05].forEach((p, k) => {
        for (let x = 0; x < W; x += b) {
          if (rnd() < p) { ctx.fillStyle = c; ctx.fillRect(x, y - (k + 1) * b, b, b); }
          if (k === 0 && rnd() < 0.1) { ctx.fillStyle = cp; ctx.fillRect(x, y, b, b); }
        }
      });
    }
    if (el.dataset.stars !== undefined) {
      const lim = snap(H * +(el.dataset.stars || 0.6));
      for (let i = 0, n = Math.round(W * lim / (+el.dataset.density || 9000)); i < n; i++) {
        const x = snap(rnd() * W), y = Math.round(rnd() * lim / s) * s, big = rnd() < 0.18;
        ctx.fillStyle = rnd() < 0.3 ? '#fff3a0' : '#fdfdfd';
        if (big) { ctx.fillRect(x, y - s, s, s); ctx.fillRect(x - s, y, 3 * s, s); ctx.fillRect(x, y + s, s, s); }
        else { ctx.globalAlpha = 0.5 + rnd() * 0.5; ctx.fillRect(x, y, s, s); ctx.globalAlpha = 1; }
      }
    }
    if (!gc) return;
    ctx.fillStyle = gc;
    for (let x = 0; x < W; x += b) { const y = groundY(x + b / 2, G, W, hills); ctx.fillRect(x, y, b, H - y); }
    ctx.fillStyle = el.dataset.ground2 || '#c6f43a';
    for (let i = 0, n = Math.round((W * (H - G)) / 1100); i < n; i++) ctx.fillRect(Math.round((rnd() * W) / s) * s, Math.round((G + b + rnd() * (H - G - b)) / s) * s, s * (rnd() < 0.5 ? 2 : 1), s);
    if (el.dataset.flowers === undefined) return;
    const cols = ['#fdfdfd', '#ffc4dd', '#fff3a0'];
    for (let i = 0, n = Math.max(6, Math.round(W / 110)); i < n; i++) {
      const x = Math.round((rnd() * W) / s) * s, y = Math.round((G + 3 * b + rnd() * Math.max(10, H - G - 5 * b)) / s) * s;
      ctx.fillStyle = cols[i % 3]; ctx.fillRect(x, y - s, s, s); ctx.fillRect(x - s, y, s, s); ctx.fillRect(x + s, y, s, s); ctx.fillRect(x, y + s, s, s);
      ctx.fillStyle = i % 3 === 2 ? '#ffb020' : '#ffe25c'; ctx.fillRect(x, y, s, s);
    }
  }
  // [data-stand] children stand on the ground or hill under their middle
  function stand(el) {
    if (!el.dataset.ground) return;
    const H = el.offsetHeight, W = el.offsetWidth, G = at(el, el.dataset.ground.split(/\s+/)[1], H), hills = hillsOf(el), box = el.getBoundingClientRect();
    el.querySelectorAll('[data-stand]').forEach((m) => {
      if (!m.offsetWidth) return;
      m.style.top = '0px';
      const r = m.getBoundingClientRect(), cx = r.left - box.left + r.width / 2;
      const y = groundY(Math.floor(cx / b) * b + b / 2, G, W, hills), bot = m.querySelector('svg.bot:last-of-type') || m;
      m.style.top = `${y - m.offsetHeight + bot.getBoundingClientRect().height * 0.1 + (+m.dataset.stand || 0)}px`;
    });
  }
  const skies = () => document.querySelectorAll('[data-sky]');
  const go = () => skies().forEach((el) => { stand(el); paint(el); });
  let w = innerWidth, t = 0;
  addEventListener('resize', () => { if (innerWidth === w) return; w = innerWidth; clearTimeout(t); t = setTimeout(go, 150); });
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(go);
  addEventListener('load', go);
  if ('ResizeObserver' in window) {
    // a sky whose height changes (an open question, the live demo settling) repaints
    const seen = new WeakMap();
    const ro = new ResizeObserver((es) => es.forEach((e) => { const h = Math.round(e.contentRect.height); if (seen.has(e.target) && seen.get(e.target) !== h) { stand(e.target); paint(e.target); } seen.set(e.target, h); }));
    addEventListener('DOMContentLoaded', () => skies().forEach((el) => ro.observe(el)));
  }
})();
