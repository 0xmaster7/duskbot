// logo studio: one 1024 canvas. scene snapped to a cell grid, mascots rasterized on the same grid or their own
(function () {
  'use strict';
  const W = 1024, FLOOR = 43 / 64;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const R = Math.round, abs = Math.abs, clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const DPR = Math.min(3, window.devicePixelRatio || 1);
  const BGS = window.LOGO_BGS || [];
  const BY = Object.fromEntries(BGS.map((b) => [b.id, b]));

  // ---- colour
  const hex = (c) => '#' + c.map((v) => clamp(R(v), 0, 255).toString(16).padStart(2, '0')).join('');
  const unhex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function rgb2hls(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx == mn) return [0, l, 0];
    const d = mx - mn, s = l <= 0.5 ? d / (mx + mn) : d / (2 - mx - mn);
    const h = mx == r ? (g - b) / d + (g < b ? 6 : 0) : mx == g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h / 6, l, s];
  }
  function hls2rgb(h, l, s) {
    if (!s) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }
  const hsv2rgb = (h, s, v) => { h = ((h % 1) + 1) % 1; const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]; };
  const rgb2hsv = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = mx == r ? ((g - b) / d) % 6 : mx == g ? (b - r) / d + 2 : (r - g) / d + 4; return [((h / 6) + 1) % 1, mx ? d / mx : 0, mx]; };
  const to255 = (a) => a.map((v) => R(v * 255));
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  function shade(c, f) { const [h, l, s] = rgb2hls(c[0] / 255, c[1] / 255, c[2] / 255); return to255(hls2rgb(h, l * f, Math.min(1, s * 1.08))); }
  function deep(c, f = 0.8) {
    let [h, l, s] = rgb2hls(c[0] / 255, c[1] / 255, c[2] / 255);
    if (s < 0.2) { h = 0.56; s = 0.6; }
    return to255(hls2rgb(h, Math.min(l, 0.9) * f, Math.min(1, Math.max(s, 0.35) * 1.1)));
  }
  const inkFrom = (c) => { const [h] = rgb2hsv(c[0] / 255, c[1] / 255, c[2] / 255); return to255(hsv2rgb(h + 0.04, 0.72, 0.24)); };
  function adjust(c, hue, sat, lum) {
    let [h, l, s] = rgb2hls(c[0] / 255, c[1] / 255, c[2] / 255);
    h += hue / 360; s = clamp(s * sat, 0, 1);
    l = lum <= 1 ? l * lum : l + (1 - l) * (lum - 1) * 0.9;
    return to255(hls2rgb(h, clamp(l, 0, 0.97), s));
  }

  // ---- mascots: crowd.js shapes compiled without the animation engine
  const SH = {
    c: (x0, y0, r) => (x, y) => (x - x0) ** 2 + (y - y0) ** 2 < r * r,
    e: (x0, y0, rx, ry) => (x, y) => ((x - x0) / rx) ** 2 + ((y - y0) / ry) ** 2 < 1,
    s: (x0, y0, rx, ry, p = 4) => (x, y) => abs((x - x0) / rx) ** p + abs((y - y0) / ry) ** p < 1,
    r: (x0, y0, x1, y1, r = 0) => (x, y) => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      const dx = Math.max(x0 + r - x, 0, x - x1 + r), dy = Math.max(y0 + r - y, 0, y - y1 + r);
      return dx * dx + dy * dy <= r * r;
    },
    l: (ax, ay, bx, by, th = 1) => (x, y, k) => {
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1, t = clamp(((x - ax) * dx + (y - ay) * dy) / L, 0, 1);
      const ex = x - ax - t * dx, ey = y - ay - t * dy, h = Math.max(th / 2, k * 0.55);
      return ex * ex + ey * ey < h * h;
    },
    p: (...q) => (x, y) => {
      let inn = false;
      for (let i = 0, j = q.length - 2; i < q.length; j = i, i += 2) {
        const xi = q[i], yi = q[i + 1], xj = q[j], yj = q[j + 1];
        if (yi > y != yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inn = !inn;
      }
      return inn;
    },
  };
  function mirArgs(t, a, N) {
    a = a.slice();
    if (t == 'r') { const x0 = a[0]; a[0] = N - a[2]; a[2] = N - x0; }
    else if (t == 'l') { a[0] = N - a[0]; a[2] = N - a[2]; }
    else if (t == 'p') for (let i = 0; i < a.length; i += 2) a[i] = N - a[i];
    else a[0] = N - a[0];
    return a;
  }
  function compile(d) {
    const N = d.N || 16, tests = [];
    for (const p of d.parts) {
      const last = p[p.length - 1], o = typeof last == 'object' ? last : {}, a = p.slice(1, o === last ? -1 : undefined);
      tests.push({ f: SH[p[0]](...a), cut: !!o.cut });
      if (o.mir) tests.push({ f: SH[p[0]](...mirArgs(p[0], a, N)), cut: !!o.cut });
    }
    return { N, tests, eyes: Object.assign({ w: 2, h: 3, gap: 4, y: N * 0.45, x: N / 2 }, d.eyes) };
  }
  const MASCOTS = [];
  for (const c of window.CROWD || []) MASCOTS.push({ name: c.name, colour: c.colour, def: compile(window.LOGO_DEFS[c.name]) });
  for (const [name, colour, d] of window.LOGO_EXTRA || []) MASCOTS.push({ name, colour, def: compile(d) });
  const MB = Object.fromEntries(MASCOTS.map((m) => [m.name, m]));

  // body mask on an M x M grid over the N box plus eye cells. eye: null for the shape's own eyes, or {w,h,gap,oy,round,pat}
  const rcache = new Map();
  function body(name, M) {
    const key = name + '|' + M;
    if (rcache.has(key)) return rcache.get(key);
    const { N, tests } = MB[name].def, k = N / M, m = new Uint8Array(M * M);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const x = (i + 0.5) * k, y = (j + 0.5) * k;
      let v = 0;
      for (const t of tests) if (t.f(x, y, k)) v = t.cut ? 0 : 1;
      m[j * M + i] = v;
    }
    const ext = (y, d) => { if (y < 0 || y >= M) return null; if (d < 0) { for (let x = 0; x < M; x++) if (m[y * M + x]) return x; } else for (let x = M - 1; x >= 0; x--) if (m[y * M + x]) return x; return null; };
    for (const d of [-1, 1]) for (let y = 1; y < M - 1; y++) for (const n of [1, 2]) {
      const e = ext(y, d), a = ext(y - 1, d), z = ext(y + n, d);
      if (e == null || a == null || z == null) continue;
      let same = true;
      for (let j = 1; j < n; j++) if (ext(y + j, d) !== e) same = false;
      const out = (v) => (d < 0 ? e < v : e > v);
      if (same && out(a) && out(z) && abs(e - a) == 1 && abs(e - z) == 1) for (let j = 0; j < n; j++) m[(y + j) * M + e] = 0;
    }
    rcache.set(key, m);
    return m;
  }
  function baseEyes(name, M) {
    const E = MB[name].def.eyes, k = MB[name].def.N / M;
    const lx = (E.x - E.gap / 2 - E.w / 2) / k, rx = (E.x + E.gap / 2 + E.w / 2) / k;
    const w = Math.max(1, R(E.w / k)), h = Math.max(1, R(E.h / k));
    return { w, h, gap: Math.max(1, R(abs(rx - lx) - w)), cy: (E.y + E.h / 2) / k };
  }
  function raster(name, M, eye, rot, flip) {
    const key = [name, M, JSON.stringify(eye), rot, flip].join('|');
    if (rcache.has(key)) return rcache.get(key);
    const m0 = body(name, M), be = baseEyes(name, M);
    const w = eye ? eye.w : be.w, h = eye ? eye.h : be.h, cy = be.cy + (eye ? eye.oy : 0);
    let gap = eye ? eye.gap : be.gap;
    const y0 = R(cy - h / 2), row = clamp(R(cy), 0, M - 1);
    let a = R(M / 2) - 1, z = a, x0 = R(M / 2 - (2 * w + gap) / 2);
    if (m0[row * M + a]) {
      while (a > 0 && m0[row * M + a - 1]) a--;
      while (z < M - 1 && m0[row * M + z + 1]) z++;
      const bw = z - a + 1;
      if (!eye && (bw - 2 * w - gap) % 2) gap += gap > 1 ? -1 : 1;
      x0 = R(a + (bw - 2 * w - gap) / 2);
    }
    const pat = eye ? eye.pat : 'rect', rnd = eye && eye.round && w >= 3 && h >= 3;
    const on = (ii, jj) => {
      if (pat == 'happy') return jj == 0 ? w < 3 || (ii > 0 && ii < w - 1) : ii == 0 || ii == w - 1;
      if (pat == 'sleepy') return jj == h - 1 && (w < 3 || h < 2 || true);
      if (rnd && (ii == 0 || ii == w - 1) && (jj == 0 || jj == h - 1)) return false;
      return true;
    };
    const eyes = new Uint8Array(M * M);
    for (const xs of [x0, x0 + w + gap]) for (let jj = 0; jj < h; jj++) for (let ii = 0; ii < w; ii++) {
      const X = xs + ii, Y = y0 + jj;
      if (X >= 0 && X < M && Y >= 0 && Y < M && m0[Y * M + X] && on(xs == x0 ? ii : ii, jj)) eyes[Y * M + X] = 1;
    }
    // turn and mirror the whole sprite
    let mm = m0, ee = eyes;
    const tf = (src, fn) => { const o = new Uint8Array(M * M); for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) if (src[j * M + i]) { const [X, Y] = fn(i, j); o[Y * M + X] = 1; } return o; };
    if (flip) { const f = (i, j) => [M - 1 - i, j]; mm = tf(mm, f); ee = tf(ee, f); }
    for (let t = 0; t < (rot / 90) % 4; t++) { const f = (i, j) => [M - 1 - j, i]; mm = tf(mm, f); ee = tf(ee, f); }
    let top = M, bot = -1, left = M, right = -1;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) if (mm[j * M + i]) { top = Math.min(top, j); bot = Math.max(bot, j); left = Math.min(left, i); right = Math.max(right, i); }
    const r = { M, m: mm, eyes: ee, top, bot, left, right, eye: { w, h, gap } };
    if (rcache.size > 400) rcache.clear();
    rcache.set(key, r);
    return r;
  }

  // ---- pixel font, 5 x 7
  const GL = {
    A: '.###.#...##...######...##...##...#', B: '####.#...##...#####.#...##...#####.', C: '.###.#...##....#....#....#...#.###.',
    D: '####.#...##...##...##...##...#####.', E: '######....#....####.#....#....#####', F: '######....#....####.#....#....#....',
    G: '.###.#...##....#.####...##...#.####', H: '#...##...##...#######...##...##...#', I: '.###...#....#....#....#....#...###.',
    J: '..###...#....#....#....##..#..##...', K: '#...##..#.#.#..##...#.#..#..#.#...#', L: '#....#....#....#....#....#....#####',
    M: '#...###.###.#.##.#.##...##...##...#', N: '#...##...###..##.#.##..###...##...#', O: '.###.#...##...##...##...##...#.###.',
    P: '####.#...##...#####.#....#....#....', Q: '.###.#...##...##...##.#.##..#..##.#', R: '####.#...##...#####.#.#..#..#.#...#',
    S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..', U: '#...##...##...##...##...##...#.###.',
    V: '#...##...##...##...##...#.#.#...#..', W: '#...##...##...##.#.##.#.##.#..#.#.', X: '#...##...#.#.#...#...#.#.#...##...#',
    Y: '#...##...#.#.#...#....#....#....#..', Z: '#####....#...#...#...#...#....#####', 0: '.###.#...##..###.#.###..##...#.###.',
    1: '..#...##....#....#....#....#...###.', 2: '.###.#...#....#...#...#...#...#####', 3: '####.....#....#.###.....#....#####.',
    4: '...#...##..#.#.#..#.#####...#....#.', 5: '######....####.....#....##...#.###.', 6: '.###.#....#....####.#...##...#.###.',
    7: '#####....#...#...#...#....#....#...', 8: '.###.#...##...#.###.#...##...#.###.', 9: '.###.#...##...#.####....#....#.###.',
    '.': '.........................##...##..', '!': '..#....#....#....#....#.........#..', '-': '...............###...............',
    '?': '.###.#...#....#...#...#.........#..', ',': '....................##....#...#....', "'": '..#....#...........................',
    '&': '.##..#..#.#.#...#...#.#.##..#..##.#', ' ': '...................................',
  };

  // ---- state
  const BODY = [['white', '#ffffff'], ['cream', '#fff4dc'], ['peach', '#ffe1cc'], ['pink', '#ffdbe9'], ['lemon', '#fff6b8'], ['mint', '#d6f5e6'], ['sky', '#d6efff'], ['lilac', '#ece2ff'], ['own', null]];
  const EYEC = [['ink', '#162642'], ['auto', null], ['black', '#111318'], ['cocoa', '#5a3a24'], ['plum', '#5b2a6e'], ['forest', '#1f5a3a'], ['berry', '#b0306a'], ['coral', '#e2553f'], ['blue', '#2f6fd8'], ['gold', '#c98a10'], ['white', '#ffffff']];
  const OC = [['sky', null], ['behind', null], ['ink', '#162642'], ['white', '#ffffff'], ['coral', '#d9604f'], ['pink', '#e86aa6'], ['olive', '#6b7a1f'], ['ochre', '#c48a1c'], ['teal', '#1f8a8a'], ['lilac', '#8a6ad8']];
  const OC2 = [['white', '#ffffff'], ['cream', '#fff4dc'], ['ink', '#162642'], ['sky', null]];
  const GC = [['white', '#ffffff'], ['lemon', '#fff3a0'], ['peach', '#ffd2b0'], ['pink', '#ffc4e1'], ['aqua', '#c4f4ff']];
  const TINT = [['none', null], ['peach', '#ffc9a8'], ['lemon', '#fff0a0'], ['pink', '#ffb8d9'], ['lilac', '#cdb8ff'], ['mint', '#a8f0d4'], ['sky', '#8fd8ff']];
  const TC = [['ink', '#162642'], ['white', '#ffffff'], ['auto', null], ['black', '#111318']];
  const FC = [['auto', null], ['card', '#fcfcfd'], ['ink', '#162642'], ['cream', '#fff4dc']];
  const GRIDS = [64, 48, 40, 32, 24, 16];
  const MGRIDS = [0, 12, 16, 20, 24, 32, 48, 64];
  const POSTS = [0, 16, 8, 6, 4];
  const EYES = ['auto', 'tall', 'wide', 'dots', 'happy', 'sleepy', 'custom'];
  const DIRS = { nw: [-1, -1], n: [0, -1], ne: [1, -1], w: [-1, 0], e: [1, 0], sw: [-1, 1], s: [0, 1], se: [1, 1] };
  const DIRSYM = { nw: '↖', n: '↑', ne: '↗', w: '←', e: '→', sw: '↙', s: '↓', se: '↘' };

  const first = BGS.find((b) => b.centred) || BGS[0] || { id: '', m: 'pip' };
  const DEF = {
    bg: first.id, clear: 0, grid: 64, post: 0, zoom: 100, panx: 0, pany: 0, flip: 0, hue: 0, sat: 100, lum: 100, tint: 'none', tinta: 40, vig: 0, vigc: 'light',
    m: first.m, size: 44, cx: 50, cy: 50, lock: 1, fit: 1, mg: 0, rot: 0, mflip: 0,
    body: 'white', eye: 'ink', eyes: 'auto', ew: 4, eh: 5, eg: 6, eo: 0, er: 0, ep: 'rect',
    ol: 1, olk: 'round', oc: 'sky', ol2: 0, oc2: 'white', glow: 0, gc: 'white', sh: 'ground', shd: 'se', shl: 2, shs: 18,
    f1: '', f2: '', txt: '', tf: 'sans', ty: 88, tsz: 4, tc: 'ink', tol: 0, frame: 'none', fw: 2, fc: 'auto', shape: 'square',
  };
  const S = Object.assign({}, DEF);
  const NUM = { clear: [0, 1], grid: [16, 64], post: [0, 16], zoom: [100, 300], panx: [-100, 100], pany: [-100, 100], flip: [0, 1], hue: [-180, 180], sat: [0, 200], lum: [60, 140], tinta: [0, 100], vig: [0, 100], size: [5, 120], cx: [-20, 120], cy: [-20, 120], lock: [0, 1], fit: [0, 1], mg: [0, 64], rot: [0, 270], mflip: [0, 1], ew: [1, 12], eh: [1, 14], eg: [1, 24], eo: [-10, 10], er: [0, 1], ol: [0, 4], ol2: [0, 1], glow: [0, 4], shl: [1, 8], shs: [5, 60], ty: [4, 96], tsz: [1, 10], tol: [0, 1], fw: [1, 8] };
  const ENUM = { vigc: ['light', 'deep'], eyes: EYES, ep: ['rect', 'happy', 'sleepy'], olk: ['round', 'square'], sh: ['none', 'ground', 'drop'], shd: Object.keys(DIRS), tf: ['sans', 'pixel'], frame: ['none', 'pixel', 'double', 'card'], shape: ['square', 'ios', 'circle', 'fav'] };
  const COLS = { body: BODY, eye: EYEC, oc: OC, oc2: OC2, gc: GC, tint: TINT, tc: TC, fc: FC };
  const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v);
  function setFrom(p) {
    for (const [k, v] of Object.entries(p)) {
      if (!(k in DEF)) continue;
      if (k in NUM) { if (isFinite(+v)) S[k] = clamp(+v, NUM[k][0], NUM[k][1]); }
      else if (k in ENUM) { if (ENUM[k].includes(v)) S[k] = v; }
      else if (k in COLS) { if (COLS[k].some((o) => o[0] == v) || isHex(v)) S[k] = v; }
      else if (k == 'bg') { if (BY[v]) S.bg = v; }
      else if (k == 'm') { if (MB[v]) S.m = v; }
      else if (k == 'f1' || k == 'f2') S[k] = parseFriend(v) ? v : '';
      else if (k == 'txt') S.txt = String(v).slice(0, 24);
    }
    if (!GRIDS.includes(S.grid)) S.grid = 64;
    if (!MGRIDS.includes(S.mg)) S.mg = 0;
    if (!POSTS.includes(S.post)) S.post = 0;
    S.rot = (R(S.rot / 90) * 90) % 360;
  }
  const query = () => new URLSearchParams(Object.entries(S).filter(([k, v]) => v !== DEF[k] || k == 'bg' || k == 'm').map(([k, v]) => [k, String(v)])).toString();
  const shareUrl = () => location.origin + location.pathname + '#' + query();
  function parseFriend(v) {
    const a = String(v || '').split('.');
    if (a.length < 4 || !MB[a[0]]) return null;
    return { m: a[0], size: clamp(+a[1] || 18, 5, 120), x: clamp(+a[2] || 0, -20, 120), y: clamp(+a[3] || 0, -20, 120), flip: +a[4] ? 1 : 0 };
  }
  const friendStr = (f) => [f.m, R(f.size), R(f.x * 10) / 10, R(f.y * 10) / 10, f.flip ? 1 : 0].join('.');

  // ---- history
  const hist = [], fut = [];
  let lastSnap = null, histT = 0;
  function snapshot() { const q = JSON.stringify(S); if (q != lastSnap) { if (lastSnap) { hist.push(lastSnap); if (hist.length > 120) hist.shift(); fut.length = 0; } lastSnap = q; } syncHistBtns(); }
  function restore(q) { Object.assign(S, DEF, JSON.parse(q)); lastSnap = q; writeHash(true); schedule(); syncHistBtns(); }
  function undo() { if (!hist.length) return; fut.push(lastSnap); restore(hist.pop()); status('Undone'); }
  function redo() { if (!fut.length) return; hist.push(lastSnap); restore(fut.pop()); status('Redone'); }
  function syncHistBtns() { $('#undo').disabled = !hist.length; $('#redo').disabled = !fut.length; }

  let hashT = 0;
  function writeHash(now) { clearTimeout(hashT); const go = () => history.replaceState(null, '', '#' + query()); now ? go() : (hashT = setTimeout(go, 120)); }
  function change() { writeHash(); schedule(); clearTimeout(histT); histT = setTimeout(snapshot, 350); }

  // ---- scene processing
  const imgs = new Map();
  function loadBg(id) {
    if (imgs.has(id)) return imgs.get(id);
    const p = new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingEnabled = false;
        // the art is a true 64 cell grid: sample each cell centre
        const big = document.createElement('canvas'); big.width = big.height = W;
        const bx = big.getContext('2d', { willReadFrequently: true }); bx.drawImage(im, 0, 0, W, W);
        const d = bx.getImageData(0, 0, W, W).data, out = new Uint8ClampedArray(64 * 64 * 4);
        for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) { const o = ((j * 16 + 8) * W + i * 16 + 8) * 4, q = (j * 64 + i) * 4; out[q] = d[o]; out[q + 1] = d[o + 1]; out[q + 2] = d[o + 2]; out[q + 3] = 255; }
        res(out);
      };
      im.onerror = () => rej(new Error('could not load the scene ' + id));
      im.src = '/explore/logo/bg/' + id + '.webp';
    });
    imgs.set(id, p);
    p.catch(() => imgs.delete(id));
    return p;
  }
  // clear sky: in the sky rows keep only colours that run across the whole width (the bands and their scatter)
  function clearSky(src) {
    const out = new Uint8ClampedArray(src), key = (o) => (out[o] << 16) | (out[o + 1] << 8) | out[o + 2];
    const lastRow = 40;
    let prevBand = null;
    for (let y = 0; y <= lastRow; y++) {
      // which of the eight strips across the row each colour shows up in
      const segs = new Map();
      for (let x = 0; x < 64; x++) {
        const k = key((y * 64 + x) * 4);
        if (!segs.has(k)) segs.set(k, new Set());
        segs.get(k).add(x >> 3);
      }
      const band = new Set();
      for (const [k, sg] of segs) if (sg.has(0) && sg.has(7) && (sg.has(3) || sg.has(4)) && sg.size >= 5) band.add(k);
      if (!band.size && prevBand) for (const k of prevBand) band.add(k);
      if (!band.size) continue;
      const row = [];
      for (let x = 0; x < 64; x++) row.push(key((y * 64 + x) * 4));
      for (let x = 0; x < 64; x++) {
        if (band.has(row[x])) continue;
        let pick = null;
        for (let d = 1; d < 64 && pick == null; d++) {
          if (x - d >= 0 && band.has(row[x - d])) pick = row[x - d];
          else if (x + d < 64 && band.has(row[x + d])) pick = row[x + d];
        }
        if (pick == null) pick = band.values().next().value;
        // keep the scatter pattern: copy what sits the same distance away in the row above when it is a band colour
        if (y > 0) { const up = key(((y - 1) * 64 + x) * 4); if (band.has(up) && (x + y) % 3 == 0) pick = up; }
        const o = (y * 64 + x) * 4; out[o] = pick >> 16; out[o + 1] = (pick >> 8) & 255; out[o + 2] = pick & 255;
      }
      prevBand = band;
    }
    return out;
  }
  function modeCells(src, G) {
    // src is a W x W rgba buffer, one colour per cell by majority
    const out = new Uint8ClampedArray(G * G * 4), cs = W / G, cnt = new Map();
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      cnt.clear();
      const st = Math.max(1, cs / 8);
      let best = 0, bk = 0;
      for (let y = (j + 0.2) * cs; y < (j + 0.8) * cs; y += st) for (let x = (i + 0.2) * cs; x < (i + 0.8) * cs; x += st) {
        const o = ((y | 0) * W + (x | 0)) * 4, k = (src[o] << 16) | (src[o + 1] << 8) | src[o + 2], v = (cnt.get(k) || 0) + 1;
        cnt.set(k, v); if (v > best) { best = v; bk = k; }
      }
      const o = (j * G + i) * 4; out[o] = bk >> 16; out[o + 1] = (bk >> 8) & 255; out[o + 2] = bk & 255; out[o + 3] = 255;
    }
    return out;
  }
  const dist = (a, b) => 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2;
  function posterize(cells, K) {
    const hist = new Map();
    for (let o = 0; o < cells.length; o += 4) { const k = (cells[o] << 16) | (cells[o + 1] << 8) | cells[o + 2]; hist.set(k, (hist.get(k) || 0) + 1); }
    const pts = Array.from(hist, ([k, n]) => ({ c: [k >> 16, (k >> 8) & 255, k & 255], n }));
    if (pts.length <= K) return cells;
    pts.sort((a, b) => b.n - a.n);
    const cen = [pts[0].c.slice()];
    while (cen.length < K) {
      let bp = null, bs = -1;
      for (const p of pts) { const d = Math.min(...cen.map((c) => dist(p.c, c))) * Math.sqrt(p.n); if (d > bs) { bs = d; bp = p; } }
      cen.push(bp.c.slice());
    }
    for (let it = 0; it < 8; it++) {
      const acc = cen.map(() => [0, 0, 0, 0]);
      for (const p of pts) {
        let bi = 0, bd = Infinity;
        cen.forEach((c, i) => { const d = dist(p.c, c); if (d < bd) { bd = d; bi = i; } });
        p.i = bi; const a = acc[bi]; a[0] += p.c[0] * p.n; a[1] += p.c[1] * p.n; a[2] += p.c[2] * p.n; a[3] += p.n;
      }
      acc.forEach((a, i) => { if (a[3]) cen[i] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    }
    const map = new Map(pts.map((p) => [(p.c[0] << 16) | (p.c[1] << 8) | p.c[2], cen[p.i].map(R)]));
    const out = new Uint8ClampedArray(cells.length);
    for (let o = 0; o < cells.length; o += 4) { const c = map.get((cells[o] << 16) | (cells[o + 1] << 8) | cells[o + 2]); out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; }
    return out;
  }
  const sceneCache = new Map();
  const SCENE_KEYS = ['bg', 'clear', 'grid', 'post', 'zoom', 'panx', 'pany', 'flip', 'hue', 'sat', 'lum', 'tint', 'tinta', 'vig', 'vigc'];
  async function scene() {
    const key = SCENE_KEYS.map((k) => S[k]).join('|');
    if (sceneCache.has(key)) return sceneCache.get(key);
    let src = await loadBg(S.bg);
    if (S.clear) src = clearSky(src);
    const s64 = document.createElement('canvas'); s64.width = s64.height = 64;
    s64.getContext('2d').putImageData(new ImageData(src, 64, 64), 0, 0);
    // zoom, pan and mirror at full size, then snap to the grid
    const z = S.zoom / 100, view = W / z, slack = W - view;
    const sx = (slack / 2) * (1 + S.panx / 100), sy = (slack / 2) * (1 + S.pany / 100);
    const tr = document.createElement('canvas'); tr.width = tr.height = W;
    const tx = tr.getContext('2d', { willReadFrequently: true }); tx.imageSmoothingEnabled = false;
    if (S.flip) { tx.translate(W, 0); tx.scale(-1, 1); }
    tx.drawImage(s64, (sx / W) * 64, (sy / W) * 64, (view / W) * 64, (view / W) * 64, 0, 0, W, W);
    const G = S.grid;
    let cells = modeCells(tx.getImageData(0, 0, W, W).data, G);
    if (S.post) cells = posterize(cells, S.post);
    const tint = S.tint != 'none' ? unhex(isHex(S.tint) ? S.tint : TINT.find((t) => t[0] == S.tint)[1]) : null;
    // the stage row after zoom and pan, so the tint stays in the sky
    const horizon = ((FLOOR * W - sy) * z) / W;
    const look = S.hue || S.sat != 100 || S.lum != 100;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const o = (j * G + i) * 4;
      let c = [cells[o], cells[o + 1], cells[o + 2]];
      if (look) c = adjust(c, S.hue, S.sat / 100, S.lum / 100);
      const v = (j + 0.5) / G;
      if (tint && S.tinta && v < horizon - 0.02) c = mix(c, tint, (S.tinta / 100) * 0.7 * clamp((horizon - v) / 0.12, 0.35, 1));
      if (S.vig) {
        const u = (i + 0.5) / G - 0.5, w = v - 0.5, d = Math.sqrt(u * u + w * w) / 0.707;
        const t = R(clamp((d - 0.55) / 0.45, 0, 1) * 4) / 4 * (S.vig / 100) * 0.55;
        if (t) c = S.vigc == 'light' ? mix(c, [255, 252, 246], t) : mix(c, deep(c, 0.7), t);
      }
      cells[o] = c[0]; cells[o + 1] = c[1]; cells[o + 2] = c[2];
    }
    const small = document.createElement('canvas'); small.width = small.height = G;
    small.getContext('2d').putImageData(new ImageData(cells, G, G), 0, 0);
    const big = document.createElement('canvas'); big.width = big.height = W;
    const bx = big.getContext('2d', { willReadFrequently: true }); bx.imageSmoothingEnabled = false; bx.drawImage(small, 0, 0, W, W);
    const r = { canvas: big, small, data: bx.getImageData(0, 0, W, W).data, cells, G };
    if (sceneCache.size > 16) sceneCache.clear();
    sceneCache.set(key, r);
    return r;
  }

  // ---- mascot geometry
  function eyeOpt() {
    if (S.eyes == 'auto') return null;
    return { w: S.ew, h: S.eh, gap: S.eg, oy: S.eo, round: !!S.er, pat: S.ep };
  }
  function lattice(size) {
    const G = S.grid, f = size / 100;
    const M = S.mg ? S.mg : Math.max(3, R(f * G));
    return { M, cp: S.mg ? (f * W) / M : W / G };
  }
  function fitSize(name) {
    // size where a centred body's bottom lands on the stage row
    const r = raster(name, 64, null, S.rot, S.mflip), hf = (r.bot - r.top + 1) / 64;
    return clamp(R((2 * (FLOOR - 0.5)) / hf * 100) + 1, 5, 120);
  }
  function placeOf(size, x, y, name, flip, isMain) {
    const { M, cp } = lattice(size);
    const r = raster(name, M, eyeOpt(), isMain ? S.rot : 0, flip);
    const ox = R((x / 100) * (W / cp) - (r.left + r.right + 1) / 2);
    const oy = R((y / 100) * (W / cp) - (r.top + r.bot + 1) / 2);
    return { r, M, cp, ox, oy };
  }
  function actors() {
    const list = [];
    for (const k of ['f1', 'f2']) { const f = parseFriend(S[k]); if (f) list.push(Object.assign(placeOf(f.size, f.x, f.y, f.m, f.flip, false), { key: k })); }
    const cx = S.lock ? 50 : S.cx, cy = S.lock ? 50 : S.cy;
    list.push(Object.assign(placeOf(S.size, cx, cy, S.m, S.mflip, true), { key: 'main' }));
    return list;
  }

  // ---- compose into any canvas size
  const full = document.createElement('canvas'); full.width = full.height = W;
  const shaped = document.createElement('canvas'); shaped.width = shaped.height = W;
  let info = {}, hits = [];
  function shapePath(ctx, shape, s) {
    ctx.beginPath();
    if (shape == 'circle') ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    else if (shape == 'fav') ctx.roundRect(0, 0, s, s, s * 0.14);
    else if (shape == 'ios') {
      const n = 5, h = s / 2;
      for (let i = 0; i <= 360; i++) {
        const t = (i / 360) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
        const x = h + h * Math.sign(c) * abs(c) ** (2 / n), y = h + h * Math.sign(sn) * abs(sn) ** (2 / n);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    } else ctx.rect(0, 0, s, s);
  }
  const pickCol = (list, v, auto) => (isHex(v) ? unhex(v) : list.find((o) => o[0] == v)[1] ? unhex(list.find((o) => o[0] == v)[1]) : auto);

  async function compose(target, Z) {
    const sc = await scene();
    const ctx = target.getContext('2d');
    ctx.setTransform(Z / W, 0, 0, Z / W, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, W);
    ctx.drawImage(sc.canvas, 0, 0);
    const atPx = (px, py) => { const x = clamp(px | 0, 0, W - 1), y = clamp(py | 0, 0, W - 1), o = (y * W + x) * 4; return [sc.data[o], sc.data[o + 1], sc.data[o + 2]]; };
    const sky = atPx(W / 2, (3.5 / 64) * W);
    const list = actors();
    const main = list[list.length - 1];
    // colours
    let oc;
    if (S.oc == 'sky') oc = deep(sky, 0.8);
    else if (S.oc == 'behind') {
      const { r, ox, oy, cp } = main, acc = [0, 0, 0];
      let n = 0;
      for (let j = r.top; j <= r.bot; j++) for (const i of [r.left - 1, r.right + 1]) { const c = atPx((ox + i + 0.5) * cp, (oy + j + 0.5) * cp); acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; n++; }
      oc = deep(acc.map((v) => v / n), 0.72);
    } else oc = pickCol(OC, S.oc);
    const oc2 = pickCol(OC2, S.oc2, deep(sky, 0.8));
    const eye = pickCol(EYEC, S.eye, inkFrom(sky));
    const bodyC = isHex(S.body) ? unhex(S.body) : S.body == 'own' ? unhex(MB[S.m].colour) : pickCol(BODY, S.body);
    const gc = pickCol(GC, S.gc);
    hits = [];
    for (const a of list) {
      const { r, M, cp, ox, oy } = a, KEY = (X, Y) => (X + 4096) * 16384 + (Y + 4096);
      const cell = (X, Y, c) => { const x0 = R(X * cp), y0 = R(Y * cp); ctx.fillStyle = hex(c); ctx.fillRect(x0, y0, R((X + 1) * cp) - x0, R((Y + 1) * cp) - y0); };
      const at = (X, Y) => atPx((X + 0.5) * cp, (Y + 0.5) * cp);
      const bodyS = new Set(), pts = [];
      for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) if (r.m[j * M + i]) { bodyS.add(KEY(i + ox, j + oy)); pts.push([i + ox, j + oy, r.eyes[j * M + i]]); }
      const grow = (from, n, kind, skip) => {
        const out = new Map();
        for (const [X, Y] of from) for (let dx = -n; dx <= n; dx++) for (let dy = -n; dy <= n; dy++) {
          if (kind == 'round' ? abs(dx) + abs(dy) > n : false) continue;
          const k = KEY(X + dx, Y + dy);
          if (!skip.has(k) && !out.has(k)) out.set(k, [X + dx, Y + dy]);
        }
        return out;
      };
      const ring = S.ol ? grow(pts, S.ol, S.olk, bodyS) : new Map();
      const solid = new Set([...bodyS, ...ring.keys()]);
      const ring2 = S.ol && S.ol2 ? grow([...ring.values()], 1, 'round', solid) : new Map();
      for (const k of ring2.keys()) solid.add(k);
      // glow, softest ring first
      if (S.glow) {
        let edge = [...pts.map((p) => [p[0], p[1]]), ...ring.values(), ...ring2.values()], seen = new Set(solid);
        const layers = [];
        for (let g = 0; g < S.glow; g++) { const nx = grow(edge, 1, g % 2 ? 'square' : 'round', seen); for (const k of nx.keys()) seen.add(k); layers.push(nx); edge = [...nx.values()]; }
        const str = [0.62, 0.42, 0.26, 0.14];
        layers.forEach((L, g) => { for (const [X, Y] of L.values()) cell(X, Y, mix(at(X, Y), gc, str[g])); });
      }
      if (S.sh == 'ground') {
        const Y = oy + r.bot + 1;
        for (let X = ox + r.left - 1; X <= ox + r.right + 1; X++) if (!solid.has(KEY(X, Y))) cell(X, Y, shade(at(X, Y), 1 - S.shs / 100));
      } else if (S.sh == 'drop') {
        const [dx, dy] = DIRS[S.shd], done = new Set();
        const all = [...pts.map((p) => [p[0], p[1]]), ...ring.values(), ...ring2.values()];
        for (let k = 1; k <= S.shl; k++) for (const [X, Y] of all) {
          const kk = KEY(X + dx * k, Y + dy * k);
          if (solid.has(kk) || done.has(kk)) continue;
          done.add(kk); cell(X + dx * k, Y + dy * k, shade(at(X + dx * k, Y + dy * k), 1 - S.shs / 100));
        }
      }
      for (const [X, Y] of ring2.values()) cell(X, Y, oc2);
      for (const [X, Y] of ring.values()) cell(X, Y, oc);
      for (const [X, Y, e] of pts) cell(X, Y, e ? eye : bodyC);
      hits.push({ key: a.key, x0: (ox + r.left) * cp, y0: (oy + r.top) * cp, x1: (ox + r.right + 1) * cp, y1: (oy + r.bot + 1) * cp, cp });
    }
    // words
    if (S.txt.trim()) {
      const tc = pickCol(TC, S.tc, deep(sky, 0.5)), y = (S.ty / 100) * W;
      if (S.tf == 'sans') {
        const px = 40 + S.tsz * 16;
        ctx.font = `600 ${px}px 'General Sans', system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        if (S.tol) { ctx.lineJoin = 'round'; ctx.lineWidth = px * 0.16; ctx.strokeStyle = hex(oc); ctx.strokeText(S.txt, W / 2, y); }
        ctx.fillStyle = hex(tc); ctx.fillText(S.txt, W / 2, y);
      } else {
        const t = S.txt.toUpperCase(), p = 4 + S.tsz * 2, cols = t.length * 6 - 1, x0 = R(W / 2 - (cols * p) / 2), y0 = R(y - 3.5 * p);
        const on = [];
        [...t].forEach((ch, n) => { const g = GL[ch] || GL['?']; for (let j = 0; j < 7; j++) for (let i = 0; i < 5; i++) if (g[j * 5 + i] == '#') on.push([n * 6 + i, j]); });
        const fill = (i, j, c) => { ctx.fillStyle = hex(c); ctx.fillRect(x0 + i * p, y0 + j * p, p, p); };
        if (S.tol) { const s = new Set(on.map(([i, j]) => i + ',' + j)); for (const [i, j] of on) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!s.has(i + a + ',' + (j + b))) fill(i + a, j + b, oc); }
        for (const [i, j] of on) fill(i, j, tc);
      }
    }
    // frame
    if (S.frame != 'none') {
      const fc = pickCol(FC, S.fc, deep(sky, 0.8)), cw = W / sc.G;
      ctx.fillStyle = hex(fc);
      if (S.frame == 'card') {
        const m = S.fw * 14;
        ctx.beginPath(); ctx.rect(0, 0, W, W); ctx.roundRect(m, m, W - 2 * m, W - 2 * m, 40 + S.fw * 6); ctx.fill('evenodd');
      } else {
        const t = R(S.fw * cw);
        ctx.fillRect(0, 0, W, t); ctx.fillRect(0, W - t, W, t); ctx.fillRect(0, 0, t, W); ctx.fillRect(W - t, 0, t, W);
        if (S.frame == 'double') { const a = t + R(cw), b = R(cw); ctx.fillRect(a, a, W - 2 * a, b); ctx.fillRect(a, W - a - b, W - 2 * a, b); ctx.fillRect(a, a, b, W - 2 * a); ctx.fillRect(W - a - b, a, b, W - 2 * a); }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    info = { M: main.M, oc: hex(oc), eye: hex(eye), body: hex(bodyC), sc, sky: hex(sky) };
  }
  async function renderShaped(Z, shape) {
    const c = Z == W ? full : document.createElement('canvas');
    c.width = c.height = Z;
    await compose(c, Z);
    const o = Z == W && shape == S.shape ? shaped : document.createElement('canvas');
    o.width = o.height = Z;
    const x = o.getContext('2d'); x.clearRect(0, 0, Z, Z); x.save(); shapePath(x, shape, Z); x.clip(); x.drawImage(c, 0, 0); x.restore();
    return o;
  }

  // ---- drawing out
  const stage = $('#stage'), stx = stage.getContext('2d', { willReadFrequently: true });
  let showGrid = false;
  function down(src, size) {
    let c = src, s = src.width;
    while (s / 2 >= size * 1.5) {
      const n = document.createElement('canvas'); n.width = n.height = R(s / 2);
      const x = n.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, n.width, n.height);
      c = n; s = n.width;
    }
    const o = document.createElement('canvas'); o.width = o.height = size;
    const x = o.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, size, size);
    return o;
  }
  function masked(shape) {
    if (shape == S.shape) return shaped;
    const c = document.createElement('canvas'); c.width = c.height = W;
    const x = c.getContext('2d'); x.save(); shapePath(x, shape, W); x.clip(); x.drawImage(full, 0, 0); x.restore();
    return c;
  }
  function header(cv) {
    // X header: the scene at 2x, the middle band
    const x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
    const s = 2 * W, k = cv.width / 1500;
    x.drawImage(info.sc.canvas, 0, 0, W, W, (-(s - 1500) / 2) * k, (-(s / 2 - 250)) * k, s * k, s * k);
  }
  function paintPreviews() {
    const cache = {}, mk = {};
    for (const cv of $$('canvas[data-size]')) {
      const size = +cv.dataset.size, shape = cv.dataset.shape == 'pick' ? S.shape : cv.dataset.shape, px = R(size * DPR), k = shape + px;
      const src = cache[k] || (cache[k] = down(mk[shape] || (mk[shape] = masked(shape)), px));
      if (cv.width != px) cv.width = cv.height = px;
      if (!cv.style.width) cv.style.width = cv.style.height = size + 'px';
      const x = cv.getContext('2d'); x.clearRect(0, 0, px, px); x.drawImage(src, 0, 0);
    }
    header($('#xp-banner'));
  }
  function paintStage() {
    stx.clearRect(0, 0, W, W); stx.drawImage(shaped, 0, 0);
    if (showGrid) {
      const G = info.sc.G, cw = W / G;
      stx.fillStyle = 'rgba(18,21,28,0.12)';
      for (let i = 1; i < G; i++) { stx.fillRect(R(i * cw), 0, 1, W); stx.fillRect(0, R(i * cw), W, 1); }
      stx.fillStyle = 'rgba(30,78,172,0.55)';
      stx.fillRect(W / 2 - 1, 0, 2, W); stx.fillRect(0, W / 2 - 1, W, 2);
    }
  }

  let busy = false, again = false, ready = false;
  async function render() {
    if (busy) { again = true; return; }
    busy = true;
    try {
      if (S.txt && S.tf == 'sans' && document.fonts) await document.fonts.load(`600 64px 'General Sans'`);
      await renderShaped(W, S.shape);
      paintStage();
      paintPreviews();
      syncUi();
      ready = true;
    } catch (e) {
      status(e.message + '. Check the connection and pick it again.', true);
    }
    busy = false;
    if (again) { again = false; render(); }
  }
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };

  // ---- ui
  const toast = $('#status');
  let toastT = 0;
  function status(msg, err) {
    clearTimeout(toastT);
    if (!msg) { toast.classList.remove('on'); return; }
    toast.textContent = msg; toast.classList.toggle('err', !!err); toast.classList.add('on');
    toastT = setTimeout(() => toast.classList.remove('on'), err ? 5000 : 2200);
  }
  const palHtml = (pal) => (pal || []).map((c) => `<i style="background:${c}"></i>`).join('');

  function buildBgPick() {
    const fs = $('#bg-pick');
    for (const b of BGS) {
      const l = document.createElement('label');
      l.dataset.tone = b.tone; l.dataset.centred = b.centred ? '1' : ''; l.dataset.clear = b.clear ? '1' : '';
      l.title = b.name;
      l.innerHTML = `<input type="radio" name="bg" value="${b.id}"><img src="/explore/logo/thumb/${b.id}.webp" alt="" width="62" height="62" loading="lazy" decoding="async"><span class="tpal" aria-hidden="true">${palHtml(b.pal)}</span><span class="ring"></span><span class="vh">${b.name}</span>`;
      fs.append(l);
    }
    fs.addEventListener('change', (e) => { if (BY[e.target.value]) { S.bg = e.target.value; change(); } });
    $('#bg-filter').addEventListener('change', (e) => filterBgs(e.target.value));
    $('[data-reset-filter]').addEventListener('click', () => { $('#bg-filter input[value=all]').checked = true; filterBgs('all'); });
  }
  function filterBgs(f) {
    let n = 0;
    for (const l of $$('#bg-pick label')) {
      const show = f == 'all' || (f == 'centred' ? !!l.dataset.centred : f == 'clear' ? !!l.dataset.clear : l.dataset.tone == f);
      l.hidden = !show; n += show;
    }
    $('#bg-empty').hidden = n > 0;
  }
  function buildMascotPick() {
    const fs = $('#m-pick');
    for (const m of MASCOTS) {
      const l = document.createElement('label');
      l.innerHTML = `<input type="radio" name="m" value="${m.name}"><canvas width="${R(36 * DPR)}" height="${R(36 * DPR)}" data-m="${m.name}" aria-hidden="true"></canvas><span class="nm">${m.name}</span><span class="ring"></span>`;
      fs.append(l);
    }
    fs.addEventListener('change', (e) => { S.m = e.target.value; if (S.fit) S.size = fitSize(S.m); change(); });
  }
  function paintMascotTiles() {
    const bgc = info.sky, M = 16;
    for (const c of $$('#m-pick canvas')) {
      const r = raster(c.dataset.m, M, null, 0, 0), x = c.getContext('2d'), s = c.width / (M + 4);
      x.fillStyle = bgc; x.fillRect(0, 0, c.width, c.height);
      for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) if (r.m[j * M + i]) {
        x.fillStyle = r.eyes[j * M + i] ? info.eye : info.body;
        x.fillRect(R((i + 2) * s), R((j + 2) * s), R((i + 3) * s) - R((i + 2) * s), R((j + 3) * s) - R((j + 2) * s));
      }
    }
  }
  function chips(fs, key, list, textAuto) {
    for (const [v, c] of list) {
      const l = document.createElement('label'); l.title = v;
      if (c) l.innerHTML = `<input type="radio" name="${key}" value="${v}"><span class="sw" style="background:${c}"></span><span class="vh">${v}</span>`;
      else l.innerHTML = `<input type="radio" name="${key}" value="${v}"><span class="tx"><span class="sw" data-auto="${key}:${v}"></span>${textAuto && textAuto[v] ? textAuto[v] : v}</span>`;
      fs.append(l);
    }
    const p = document.createElement('label'); p.className = 'pick'; p.title = 'any colour';
    p.innerHTML = `<input type="radio" name="${key}" value="custom"><span class="sw"></span><input type="color" aria-label="any ${fs.querySelector('legend').textContent} colour" value="#ffffff">`;
    fs.append(p);
    const ci = p.querySelector('input[type=color]');
    fs.addEventListener('change', (e) => {
      if (e.target.type == 'color') return;
      S[key] = e.target.value == 'custom' ? ci.value : e.target.value;
      change();
    });
    ci.addEventListener('input', () => { S[key] = ci.value; p.querySelector('input[type=radio]').checked = true; change(); });
  }
  function segs(fs, name, list, label) { for (const v of list) fs.insertAdjacentHTML('beforeend', `<label><input type="radio" name="${name}" value="${v}"><span>${label(v)}</span></label>`); }

  function friendsUi() {
    const box = $('#friends'); box.innerHTML = '';
    let n = 0;
    for (const k of ['f1', 'f2']) {
      const f = parseFriend(S[k]); if (!f) continue; n++;
      const d = document.createElement('div'); d.className = 'friend'; d.dataset.k = k;
      d.innerHTML = `<div class="friend-head"><strong>friend ${n}</strong>
        <label class="vh" for="${k}-m">friend ${n} mascot</label><select id="${k}-m">${MASCOTS.map((m) => `<option${m.name == f.m ? ' selected' : ''}>${m.name}</option>`).join('')}</select>
        <button type="button" class="btn ghost sm" data-ff="flip" aria-pressed="${!!f.flip}">mirror</button>
        <button type="button" class="btn ghost sm" data-ff="rm" aria-label="remove friend ${n}">remove</button></div>
        <div class="two">
          <div class="field"><div class="lab"><label for="${k}-s">size</label><output>${R(f.size)}%</output></div><input type="range" id="${k}-s" data-ff="size" min="5" max="80" value="${f.size}"></div>
          <div class="field"><div class="lab"><label for="${k}-x">across</label><output>${R(f.x)}%</output></div><input type="range" id="${k}-x" data-ff="x" min="-20" max="120" step="0.5" value="${f.x}"></div>
          <div class="field"><div class="lab"><label for="${k}-y">down</label><output>${R(f.y)}%</output></div><input type="range" id="${k}-y" data-ff="y" min="-20" max="120" step="0.5" value="${f.y}"></div>
        </div>`;
      box.append(d);
    }
    $('#add-friend').disabled = n >= 2;
  }
  function bindFriends() {
    const box = $('#friends');
    const upd = (k, fn) => { const f = parseFriend(S[k]); if (!f) return; fn(f); S[k] = friendStr(f); change(); };
    box.addEventListener('input', (e) => {
      const d = e.target.closest('.friend'); if (!d) return;
      const p = e.target.dataset.ff;
      if (p) { upd(d.dataset.k, (f) => (f[p] = +e.target.value)); const o = e.target.parentElement.querySelector('output'); if (o) o.textContent = R(+e.target.value) + '%'; }
    });
    box.addEventListener('change', (e) => { const d = e.target.closest('.friend'); if (d && e.target.tagName == 'SELECT') upd(d.dataset.k, (f) => (f.m = e.target.value)); });
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button'), d = e.target.closest('.friend'); if (!b || !d) return;
      if (b.dataset.ff == 'rm') { S[d.dataset.k] = ''; if (!S.f1 && S.f2) { S.f1 = S.f2; S.f2 = ''; } friendsUi(); change(); }
      if (b.dataset.ff == 'flip') { upd(d.dataset.k, (f) => (f.flip = f.flip ? 0 : 1)); b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') != 'true')); }
    });
    $('#add-friend').addEventListener('click', () => {
      const k = !S.f1 ? 'f1' : !S.f2 ? 'f2' : null; if (!k) return;
      const left = k == 'f1';
      const pool = MASCOTS.filter((m) => m.name != S.m);
      S[k] = friendStr({ m: pool[(Math.random() * pool.length) | 0].name, size: 17, x: left ? 20 : 80, y: 62, flip: left ? 0 : 1 });
      friendsUi(); change(); status('Friend added. Drag it on the preview.');
    });
  }

  const summaries = () => {
    const b = BY[S.bg];
    return {
      scene: (b ? b.name : '') + (S.clear ? ', clear sky' : ''),
      mascot: `${S.m}, ${S.size}%${S.lock ? ', centred' : ''}`,
      colours: `${S.body} body, ${S.eye} eyes`,
      eyes: S.eyes,
      edges: `${S.ol ? S.ol + ' px border' : 'no border'}${S.glow ? ', glow' : ''}, ${S.sh == 'drop' ? 'long' : S.sh} shadow`,
      look: [S.zoom != 100 && 'zoom ' + S.zoom + '%', S.flip && 'mirrored', S.hue && 'hue ' + S.hue, S.tint != 'none' && S.tint + ' sky', S.vig && 'vignette', S.grid != 64 && S.grid + ' cells', S.post && S.post + ' colours'].filter(Boolean).join(', ') || 'as drawn',
      friends: [S.f1, S.f2].filter(Boolean).length ? [S.f1, S.f2].filter(Boolean).map((f) => f.split('.')[0]).join(', ') : 'none',
      words: S.txt ? `"${S.txt}"` : 'none',
      frame: `${S.frame == 'none' ? 'no frame' : S.frame + ' frame'}, ${S.shape}`,
    };
  };
  function syncUi() {
    const set = (name, v) => { const i = document.querySelector(`input[type=radio][name="${name}"][value="${v}"]`); if (i) i.checked = true; };
    for (const k of ['bg', 'm', 'ol', 'olk', 'sh', 'grid', 'mg', 'post', 'shape', 'vigc', 'eyes', 'glow', 'tf', 'frame', 'shd']) set(k, S[k]);
    for (const k of Object.keys(COLS)) {
      if (isHex(S[k])) { set(k, 'custom'); const ci = document.querySelector(`input[type=radio][name="${k}"][value="custom"]`); if (ci) ci.parentElement.querySelector('input[type=color]').value = S[k]; }
      else set(k, S[k]);
    }
    const val = (id, v, txt) => { const e = $('#' + id); if (e && document.activeElement !== e) e.value = v; const o = $('#' + id + '-out'); if (o) o.textContent = txt; };
    val('size', S.size); if (document.activeElement !== $('#size-n')) $('#size-n').value = S.size;
    const cx = S.lock ? 50 : S.cx, cy = S.lock ? 50 : S.cy;
    val('px', cx, cx.toFixed(1) + '%'); val('py', cy, cy.toFixed(1) + '%');
    const be = baseEyes(S.m, info.M);
    const ew = S.eyes == 'auto' ? be.w : S.ew, eh = S.eyes == 'auto' ? be.h : S.eh, eg = S.eyes == 'auto' ? be.gap : S.eg;
    val('ew', ew, ew + ' px'); val('eh', eh, eh + ' px'); val('eg', eg, eg + ' px'); val('eo', S.eyes == 'auto' ? 0 : S.eo, (S.eyes == 'auto' ? 0 : S.eo) + ' px');
    val('shl', S.shl, S.shl + ' px'); val('shs', S.shs, S.shs + '%');
    val('zoom', S.zoom, S.zoom + '%'); val('panx', S.panx, S.panx); val('pany', S.pany, S.pany);
    val('hue', S.hue, S.hue + '°'); val('sat', S.sat, S.sat + '%'); val('lum', S.lum, S.lum + '%'); val('vig', S.vig, S.vig + '%');
    val('tinta', S.tinta, S.tinta + '%'); val('ty', S.ty, S.ty + '%'); val('tsz', S.tsz, S.tsz); val('fw', S.fw, S.fw);
    if (document.activeElement !== $('#txt')) $('#txt').value = S.txt;
    for (const [id, k] of [['lock', 'lock'], ['fit', 'fit'], ['eround', 'er'], ['ol2', 'ol2'], ['flip', 'flip'], ['tol', 'tol'], ['clear', 'clear']]) $('#' + id).checked = !!S[k];
    $('#mflip').setAttribute('aria-pressed', String(!!S.mflip));
    $('#rot').textContent = `turn 90°${S.rot ? ' (' + S.rot + '°)' : ''}`;
    const dis = (sel, off) => $$(sel).forEach((e) => (e.disabled = off));
    dis('#panx, #pany', S.zoom == 100);
    dis('#shd-pick input, #shl', S.sh != 'drop');
    dis('#oc2-pick input', !S.ol2);
    dis('#gc-pick input', !S.glow);
    for (const sw of $$('[data-auto]')) {
      const [k, v] = sw.dataset.auto.split(':');
      const c = k == 'oc' ? (S.oc == v ? info.oc : null) : k == 'eye' ? info.eye : k == 'body' && v == 'own' ? MB[S.m].colour : k == 'tc' || k == 'fc' || k == 'oc2' ? info.oc : null;
      sw.style.background = c || (v == 'none' ? 'repeating-linear-gradient(45deg,#e2e5eb 0 3px,#fcfcfd 3px 6px)' : '#dfe3ea');
    }
    const b = BY[S.bg];
    $('#pal').innerHTML = palHtml(b && b.pal); $('#pal-name').textContent = b ? b.name : '';
    $('#cap').textContent = `${b ? b.name : S.bg}, ${S.m}, ${info.M} px mascot${S.lock ? ', centred' : ''}`;
    stage.setAttribute('aria-label', `logo preview: ${S.m} on ${b ? b.name : S.bg}. drag a mascot, or focus here and use the arrow keys to move it`);
    const sm = summaries();
    for (const e of $$('[data-sum]')) e.textContent = sm[e.dataset.sum] || '';
    $('#gridbtn').setAttribute('aria-pressed', String(showGrid));
    paintMascotTiles();
  }

  // ---- movement
  function unlock() { if (S.lock) { S.lock = 0; S.cx = 50; S.cy = 50; } }
  function nudge(dx, dy, mul = 1) {
    unlock();
    const { cp } = lattice(S.size), f = (cp / W) * 100 * mul;
    S.cx = R(clamp(S.cx + dx * f, -20, 120) * 100) / 100; S.cy = R(clamp(S.cy + dy * f, -20, 120) * 100) / 100;
    change();
  }
  function bindStage() {
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      const rect = stage.getBoundingClientRect(), px = ((e.clientX - rect.left) / rect.width) * W, py = ((e.clientY - rect.top) / rect.height) * W;
      // grab the topmost mascot under the pointer, else the main one
      let hit = 'main';
      for (let i = hits.length - 1; i >= 0; i--) { const h = hits[i]; if (px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1) { hit = h.key; break; } }
      stage.setPointerCapture(e.pointerId);
      const f = hit != 'main' ? parseFriend(S[hit]) : null;
      if (!f) unlock();
      drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, sx: f ? f.x : S.cx, sy: f ? f.y : S.cy, rect, hit, f };
      stage.classList.add('drag');
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId != drag.id) return;
      const nx = R(clamp(drag.sx + ((e.clientX - drag.x0) / drag.rect.width) * 100, -20, 120) * 100) / 100;
      const ny = R(clamp(drag.sy + ((e.clientY - drag.y0) / drag.rect.height) * 100, -20, 120) * 100) / 100;
      if (drag.f) { drag.f.x = nx; drag.f.y = ny; S[drag.hit] = friendStr(drag.f); } else { S.cx = nx; S.cy = ny; }
      change();
    });
    const end = () => { if (drag && drag.f) friendsUi(); drag = null; stage.classList.remove('drag'); };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  }

  // ---- export
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    window.__lastExport = { name, bytes: blob.size };
  }
  const blobOf = (c) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not make the PNG'))), 'image/png'));
  const base = () => `dusk-logo-${S.bg}-${S.m}`;
  async function exportPng(size) {
    const c = size > W ? await renderShaped(size, S.shape) : size == W ? shaped : down(shaped, size);
    const blob = await blobOf(c);
    download(blob, `${base()}-${size}.png`);
    window.__lastExport.size = c.width;
    status(`Saved ${size} px PNG`);
  }
  const T32 = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u) => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = T32[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], cd = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, n, true); h.setUint32(22, n, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, n, true); c.setUint32(24, n, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      cd.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + n;
    }
    const cdSize = cd.reduce((s, u) => s + u.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cd, new Uint8Array(e.buffer)], { type: 'application/zip' });
  }
  function ico(pngs) {
    const head = new DataView(new ArrayBuffer(6 + 16 * pngs.length));
    head.setUint16(2, 1, true); head.setUint16(4, pngs.length, true);
    let off = 6 + 16 * pngs.length;
    pngs.forEach(([s, d], i) => { const o = 6 + 16 * i; head.setUint8(o, s % 256); head.setUint8(o + 1, s % 256); head.setUint16(o + 4, 1, true); head.setUint16(o + 6, 32, true); head.setUint32(o + 8, d.length, true); head.setUint32(o + 12, off, true); off += d.length; });
    const out = new Uint8Array(off); out.set(new Uint8Array(head.buffer), 0);
    let p = 6 + 16 * pngs.length; for (const [, d] of pngs) { out.set(d, p); p += d.length; }
    return out;
  }
  async function exportFavicons() {
    const files = [], ic = [];
    for (const s of [16, 32, 48, 180, 192, 512]) {
      const d = new Uint8Array(await (await blobOf(down(shaped, s))).arrayBuffer());
      files.push({ name: s == 180 ? 'apple-touch-icon.png' : `icon-${s}.png`, data: d });
      if (s <= 48) ic.push([s, d]);
    }
    files.push({ name: 'favicon.ico', data: ico(ic) });
    files.push({ name: 'head.html', data: new TextEncoder().encode('<link rel="icon" href="/favicon.ico" sizes="48x48">\n<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n') });
    const blob = zip(files);
    download(blob, `${base()}-favicons.zip`);
    window.__lastExport.files = files.map((f) => f.name);
    status('Saved the favicon pack');
  }
  async function exportHeader() {
    const c = document.createElement('canvas'); c.width = 1500; c.height = 500;
    header(c);
    download(await blobOf(c), `${base()}-x-header.png`);
    window.__lastExport.size = [1500, 500];
    status('Saved the X header');
  }
  async function copy(text, done) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.append(t); t.select();
      const ok = document.execCommand('copy'); t.remove();
      if (!ok) { status('The browser blocked copying. The link is in the address bar.', true); return; }
    }
    window.__lastCopy = text;
    status(done);
  }
  function settingsText() {
    const sm = summaries();
    return ['dusk logo pick', ...Object.entries(sm).map(([k, v]) => `${k}: ${v}`), `border colour: ${info.oc}, eye colour: ${info.eye}, body colour: ${info.body}`, `link: ${shareUrl()}`].join('\n');
  }

  // ---- favourites
  const FKEY = 'dusk-logo-favs';
  const favs = () => { try { return JSON.parse(localStorage.getItem(FKEY) || '[]'); } catch { return []; } };
  function saveFavs(list) { try { localStorage.setItem(FKEY, JSON.stringify(list)); return true; } catch { status('Could not save: browser storage is full or blocked.', true); return false; } }
  function addFav() {
    const list = favs(), q = query();
    if (list.some((f) => f.q == q)) { status('Already in favourites'); return; }
    const img = down(shaped, 360).toDataURL('image/webp', 0.92);
    list.unshift({ q, img, name: `${(BY[S.bg] || {}).name || S.bg}, ${S.m}` });
    if (saveFavs(list.slice(0, 40))) { paintFavs(); status('Saved to favourites'); }
  }
  function paintFavs() {
    const list = favs(), g = $('#fav-grid'), size = +($('input[name=favsz]:checked') || { value: 180 }).value;
    g.innerHTML = list.map((f, i) => `<figure class="fav"><img src="${f.img}" alt="${f.name}" width="${size}" height="${size}"><figcaption>${f.name}</figcaption><div class="btns"><button type="button" class="btn sm" data-fopen="${i}" aria-label="open ${f.name}">open</button><button type="button" class="btn ghost sm" data-frm="${i}" aria-label="remove ${f.name}">remove</button></div></figure>`).join('');
    $('#fav-empty').hidden = list.length > 0;
    $('#fav-count').textContent = list.length ? list.length : '';
  }
  function bindFavs() {
    $('#fav-grid').addEventListener('click', (e) => {
      const o = e.target.closest('[data-fopen]'), r = e.target.closest('[data-frm]'), list = favs();
      if (o) { const f = list[+o.dataset.fopen]; Object.assign(S, DEF); setFrom(Object.fromEntries(new URLSearchParams(f.q))); friendsUi(); change(); window.scrollTo({ top: 0, behavior: 'smooth' }); status('Opened ' + f.name); }
      if (r) { list.splice(+r.dataset.frm, 1); saveFavs(list); paintFavs(); status('Removed'); }
    });
    $('#fav-size').addEventListener('change', paintFavs);
  }

  // ---- randomise
  const pick = (a) => a[(Math.random() * a.length) | 0];
  function randomise() {
    const keepFriends = [S.f1, S.f2];
    Object.assign(S, DEF);
    S.bg = pick(BGS).id; S.m = pick(MASCOTS).name;
    S.body = Math.random() < 0.65 ? 'white' : pick(BODY)[0];
    S.eye = pick(['ink', 'ink', 'black', 'auto', 'plum', 'cocoa', 'forest', 'berry', 'blue']);
    if (S.body == 'own') S.eye = 'white';
    S.ol = pick([0, 1, 1, 1, 2, 2, 3]); S.olk = pick(['round', 'round', 'square']);
    S.oc = pick(['sky', 'sky', 'behind', 'ink', 'white', 'coral', 'lilac', 'teal']);
    S.ol2 = S.ol && Math.random() < 0.25 ? 1 : 0;
    S.glow = Math.random() < 0.3 ? pick([1, 2, 3]) : 0; S.gc = pick(GC)[0];
    S.sh = pick(['ground', 'ground', 'drop', 'none']); S.shd = pick(['se', 's', 'sw', 'e']); S.shl = pick([1, 2, 3, 4]);
    const ep = pick(['auto', 'auto', 'auto', 'tall', 'wide', 'dots', 'happy', 'sleepy']);
    S.clear = Math.random() < 0.3 ? 1 : 0;
    if (Math.random() < 0.2) S.hue = pick([-30, -15, 15, 30]);
    if (Math.random() < 0.15) S.vig = 40;
    S.size = fitSize(S.m);
    eyePreset(ep, true);
    S.f1 = keepFriends[0]; S.f2 = keepFriends[1];
    friendsUi(); change(); status('Randomised. Press R again for another.');
  }
  function eyePreset(name, quiet) {
    S.eyes = name;
    if (name == 'auto' || name == 'custom') { if (!quiet) change(); return; }
    const be = baseEyes(S.m, lattice(S.size).M), u = Math.max(1, be.w);
    const P = {
      tall: { ew: u, eh: Math.max(2, R(be.h * 1.5)), eg: be.gap, ep: 'rect', er: 1 },
      wide: { ew: Math.max(2, R(u * 1.7)), eh: Math.max(1, R(be.h * 0.55)), eg: Math.max(1, be.gap - 1), ep: 'rect', er: 0 },
      dots: { ew: Math.max(1, R(u * 0.75)), eh: Math.max(1, R(u * 0.75)), eg: be.gap + 1, ep: 'rect', er: 1 },
      happy: { ew: Math.max(3, u + 1), eh: Math.max(2, R(be.h * 0.6)), eg: Math.max(1, be.gap - 1), ep: 'happy', er: 0 },
      sleepy: { ew: Math.max(2, u + 1), eh: 1, eg: Math.max(1, be.gap - 1), ep: 'sleepy', er: 0 },
    }[name];
    Object.assign(S, P, { eo: name == 'sleepy' ? 1 : 0 });
    if (!quiet) change();
  }

  // ---- keys
  function bindKeys() {
    addEventListener('keydown', (e) => {
      const t = e.target, typing = t.matches && t.matches('input:not([type=checkbox]):not([type=radio]), select, textarea, [contenteditable]');
      const k = e.key, mod = e.metaKey || e.ctrlKey;
      if (mod && k.toLowerCase() == 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (typing || mod || e.altKey || $('#keys-dlg').open) return;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
      if (d && (t === stage || t === document.body)) { e.preventDefault(); nudge(d[0], d[1], e.shiftKey ? 4 : 1); return; }
      if (d) return;
      const step = (arr, cur, dir) => arr[(arr.indexOf(cur) + dir + arr.length) % arr.length];
      const K = k.toLowerCase();
      const act = {
        r: randomise, f: addFav, c: centre, g: () => { showGrid = !showGrid; paintStage(); syncUi(); },
        b: () => { S.bg = step(BGS.map((b) => b.id), S.bg, e.shiftKey ? -1 : 1); change(); },
        m: () => { S.m = step(MASCOTS.map((m) => m.name), S.m, e.shiftKey ? -1 : 1); if (S.fit) S.size = fitSize(S.m); change(); },
        e: () => eyePreset(step(EYES.slice(0, 6), S.eyes == 'custom' ? 'auto' : S.eyes, 1)),
        t: () => { S.rot = (S.rot + 90) % 360; change(); },
        x: () => { S.mflip = S.mflip ? 0 : 1; change(); },
        z: () => (e.shiftKey ? redo() : undo()),
        '[': () => setSize(S.size - (e.shiftKey ? 10 : 2)), ']': () => setSize(S.size + (e.shiftKey ? 10 : 2)),
        '{': () => setSize(S.size - 10), '}': () => setSize(S.size + 10),
        '?': () => $('#keys-dlg').showModal(),
      }[K];
      if (act) { e.preventDefault(); act(); }
    });
  }
  function setSize(v) { S.size = clamp(R(v), 5, 120); S.fit = 0; change(); }
  function centre() { S.lock = 1; S.cx = 50; S.cy = 50; change(); status('Centred'); }

  function init() {
    if (!BGS.length || !MASCOTS.length) { status('The studio files did not load. Reload the page.', true); return; }
    buildBgPick(); buildMascotPick();
    chips($('#body-pick'), 'body', BODY, { own: 'its colour' });
    chips($('#eye-pick'), 'eye', EYEC, { auto: 'auto' });
    chips($('#oc-pick'), 'oc', OC, { sky: 'auto sky', behind: 'auto behind' });
    chips($('#oc2-pick'), 'oc2', OC2, { sky: 'auto sky' });
    chips($('#gc-pick'), 'gc', GC);
    chips($('#tint-pick'), 'tint', TINT, { none: 'none' });
    chips($('#tc-pick'), 'tc', TC, { auto: 'auto' });
    chips($('#fc-pick'), 'fc', FC, { auto: 'auto' });
    segs($('#grid-pick'), 'grid', GRIDS, (v) => (v == 64 ? '64 original' : v));
    segs($('#mgrid-pick'), 'mg', MGRIDS, (v) => (v ? v : 'match scene'));
    segs($('#post-pick'), 'post', POSTS, (v) => (v ? v : 'all'));
    segs($('#ol-pick'), 'ol', [0, 1, 2, 3, 4], (v) => (v ? v + ' px' : 'none'));
    segs($('#glow-pick'), 'glow', [0, 1, 2, 3, 4], (v) => (v ? v + ' px' : 'none'));
    segs($('#eye-style'), 'eyes', EYES, (v) => v);
    const dirs = $('#shd-pick');
    for (const d of ['nw', 'n', 'ne', 'w', '', 'e', 'sw', 's', 'se']) dirs.insertAdjacentHTML('beforeend', d ? `<label title="${d}"><input type="radio" name="shd" value="${d}" aria-label="shadow towards ${d}"><span aria-hidden="true">${DIRSYM[d]}</span></label>` : '<label class="mid" aria-hidden="true"></label>');
    const radio = { ol: 1, olk: 0, sh: 0, grid: 1, mg: 1, post: 1, shape: 0, vigc: 0, glow: 1, tf: 0, frame: 0, shd: 0 };
    document.addEventListener('change', (e) => {
      const n = e.target.name;
      if (e.target.type == 'radio' && n in radio) { S[n] = radio[n] ? +e.target.value : e.target.value; if (n == 'mg' && S.fit) S.size = fitSize(S.m); change(); }
      if (e.target.type == 'radio' && n == 'eyes') eyePreset(e.target.value);
    });
    const bindRange = (id, key, after) => $('#' + id).addEventListener('input', (e) => { S[key] = +e.target.value; if (after) after(); change(); });
    bindRange('size', 'size', () => (S.fit = 0));
    $('#size-n').addEventListener('change', (e) => setSize(+e.target.value || S.size));
    bindRange('px', 'cx', () => { if (S.lock) { S.lock = 0; S.cy = 50; } });
    bindRange('py', 'cy', () => { if (S.lock) { S.lock = 0; S.cx = 50; } });
    for (const [id, key] of [['ew', 'ew'], ['eh', 'eh'], ['eg', 'eg'], ['eo', 'eo']]) bindRange(id, key, () => {
      if (S.eyes == 'auto') { const be = baseEyes(S.m, info.M); for (const [k, v] of [['ew', be.w], ['eh', be.h], ['eg', be.gap], ['eo', 0]]) if (k != key) S[k] = v; S.ep = 'rect'; }
      S.eyes = 'custom';
    });
    for (const k of ['shl', 'shs', 'zoom', 'panx', 'pany', 'hue', 'sat', 'lum', 'vig', 'tinta', 'ty', 'tsz', 'fw']) bindRange(k, k);
    const bindCheck = (id, key, after) => $('#' + id).addEventListener('change', (e) => { S[key] = e.target.checked ? 1 : 0; if (after) after(); change(); });
    bindCheck('lock', 'lock', () => { if (S.lock) { S.cx = 50; S.cy = 50; } });
    bindCheck('fit', 'fit', () => { if (S.fit) S.size = fitSize(S.m); });
    bindCheck('eround', 'er', () => { if (S.eyes == 'auto') { const be = baseEyes(S.m, info.M); Object.assign(S, { ew: be.w, eh: be.h, eg: be.gap, eo: 0, ep: 'rect' }); } S.eyes = 'custom'; });
    for (const [id, key] of [['ol2', 'ol2'], ['flip', 'flip'], ['tol', 'tol'], ['clear', 'clear']]) bindCheck(id, key);
    $('#txt').addEventListener('input', (e) => { S.txt = e.target.value.slice(0, 24); change(); });
    $$('[data-nudge]').forEach((b) => b.addEventListener('click', () => { const [dx, dy] = b.dataset.nudge.split(',').map(Number); nudge(dx, dy); }));
    $('#rot').addEventListener('click', () => { S.rot = (S.rot + 90) % 360; change(); });
    $('#mflip').addEventListener('click', () => { S.mflip = S.mflip ? 0 : 1; change(); });
    $('#look-reset').addEventListener('click', () => { for (const k of SCENE_KEYS) if (k != 'bg' && k != 'clear') S[k] = DEF[k]; change(); status('Scene look reset'); });
    $$('[data-export]').forEach((b) => b.addEventListener('click', () => exportPng(+b.dataset.export).catch((e) => status(e.message, true))));
    $('#exp-fav').addEventListener('click', () => exportFavicons().catch((e) => status(e.message, true)));
    $('#exp-head').addEventListener('click', () => exportHeader().catch((e) => status(e.message, true)));
    $('#copy-link').addEventListener('click', () => copy(shareUrl(), 'Link copied. It opens this exact logo.'));
    $('#copy-set').addEventListener('click', () => copy(settingsText(), 'Settings copied, with the link at the end.'));
    $('#reset').addEventListener('click', () => { Object.assign(S, DEF); S.size = fitSize(S.m); friendsUi(); change(); status('Started over'); });
    $('#undo').addEventListener('click', undo); $('#redo').addEventListener('click', redo);
    $('#rand').addEventListener('click', randomise);
    $('#centre').addEventListener('click', centre);
    $('#fav').addEventListener('click', addFav);
    $('#gridbtn').addEventListener('click', () => { showGrid = !showGrid; paintStage(); syncUi(); });
    $('#keys').addEventListener('click', () => $('#keys-dlg').showModal());
    $('#open-all').addEventListener('click', () => $$('details.panel').forEach((d) => (d.open = true)));
    $('#close-all').addEventListener('click', () => $$('details.panel').forEach((d) => (d.open = false)));
    $('#controls').addEventListener('submit', (e) => e.preventDefault());
    bindStage(); bindFriends(); bindFavs(); bindKeys();
    const p = Object.fromEntries(new URLSearchParams(location.hash.slice(1)));
    if (p.bg) setFrom(p); else S.size = fitSize(S.m);
    friendsUi(); paintFavs();
    lastSnap = JSON.stringify(S); syncHistBtns();
    addEventListener('hashchange', () => { if (location.hash.slice(1) != query()) { Object.assign(S, DEF); setFrom(Object.fromEntries(new URLSearchParams(location.hash.slice(1)))); friendsUi(); schedule(); } });
    window.__studio = { S, render, query, info: () => info, ready: () => ready, fitSize };
    writeHash(true);
    render();
  }
  init();
})();
