// eyes v2 (pure white, tall, vector) and pixel v2. every shape here is our own drawing
window.V2 = (() => {
  const n = (v) => Math.round(v * 100) / 100;
  const WHITE = '#fff';

  // shapes centred on 0 0
  function rrect(w, h, rt, rb) {
    const x = w / 2, y = h / 2;
    return `M${n(-x)} ${n(-y + rt)}A${n(rt)} ${n(rt)} 0 0 1 ${n(-x + rt)} ${n(-y)}H${n(x - rt)}A${n(rt)} ${n(rt)} 0 0 1 ${n(x)} ${n(-y + rt)}` +
      `V${n(y - rb)}A${n(rb)} ${n(rb)} 0 0 1 ${n(x - rb)} ${n(y)}H${n(-x + rb)}A${n(rb)} ${n(rb)} 0 0 1 ${n(-x)} ${n(y - rb)}Z`;
  }
  const capsule = (w, h) => rrect(w, h, w / 2, w / 2);
  function taper(w, h) {
    const t = w / 2, b = w * 0.3, r = w / 2, y = h / 2;
    return `M${n(-t)} ${n(-y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(t)} ${n(-y + r)}C${n(t)} ${n(y * 0.25)} ${n(b + 0.6)} ${n(y)} 0 ${n(y)}C${n(-b - 0.6)} ${n(y)} ${n(-t)} ${n(y * 0.25)} ${n(-t)} ${n(-y + r)}Z`;
  }
  function drop(w, h) {
    const r = w / 2, y = h / 2;
    return `M${n(-r)} ${n(-y + r)}A${n(r)} ${n(r)} 0 0 1 ${n(r)} ${n(-y + r)}C${n(r)} ${n(h * 0.12)} ${n(w * 0.2)} ${n(h * 0.3)} 1 ${n(y - 0.7)}Q0 ${n(y + 0.2)} -1 ${n(y - 0.7)}C${n(-w * 0.2)} ${n(h * 0.3)} ${n(-r)} ${n(h * 0.12)} ${n(-r)} ${n(-y + r)}Z`;
  }

  // n, name, note, width, height (or [left, right]), half gap, tilt, path
  const EYES = [
    [1, 'capsule', 'the plain tall capsule pair. the baseline everything else is measured against.', 9, 19, 10.5, 0, capsule],
    [2, 'wide gap', 'slimmer capsules set further apart. calmer, a bit more grown up.', 7, 18, 14, 0, capsule],
    [3, 'lean in', 'capsules with the tops tipped toward each other. reads focused and a little mischievous.', 8.5, 18, 11, 9, capsule],
    [4, 'lean out', 'tops tipped apart. soft, gentle, slightly sleepy by default.', 8.5, 18, 11, -9, capsule],
    [5, 'tic tac', 'rounded rectangles with small corners. the most graphic, holds up at icon size.', 10, 16, 11, 0, (w, h) => rrect(w, h, 3, 3)],
    [6, 'taper', 'wide round top narrowing to the bottom. alert and friendly.', 11, 18, 11, 0, taper],
    [7, 'drop', 'a teardrop pointing down. cute, almost puppy-like.', 10, 18, 11, 0, drop],
    [8, 'odd pair', 'one eye taller than the other, bottoms level. curious, a bit goofy.', 8.5, [15, 19], 11, 0, capsule],
    [9, 'flat base', 'round top, flat bottom. looks like it is resting on a lower lid.', 9.5, 17, 11, 0, (w, h) => rrect(w, h, w / 2, 1.6)],
    [10, 'close set', 'long capsules almost touching. intense, very readable from far away.', 8, 19, 7.5, 0, capsule],
    [11, 'slits', 'very long thin lines. minimal and cool, but the least emotional at rest.', 4.4, 19, 10, 0, capsule],
    [12, 'square top', 'flat-ish top, round bottom. a determined, slightly stern look.', 9.5, 18, 11, 0, (w, h) => rrect(w, h, 2.2, w / 2)],
  ].map(([num, name, note, w, h, dx, tilt, path]) => ({ num, name, note, w, h: Array.isArray(h) ? h : [h, h], dx, tilt, path }));
  const byNum = Object.fromEntries(EYES.map((e) => [e.num, e]));
  const MOODS = ['idle', 'blink', 'look left', 'look right', 'happy', 'sleepy', 'surprised', 'thinking', 'sad'];
  const key = (m) => m.replace(' ', '-');

  const geo = (d, side) => {
    const w = d.w, h = d.h[side === 'l' ? 0 : 1], hm = Math.max(...d.h);
    const cw = Math.min(w / 2 + Math.max(2.4, w * 0.42), d.dx - 0.6), ch = h * 0.62 + 1.5;
    return { w, h, cw, ch, oy: (hm - h) / 2 };
  };

  let uid = 0;
  // one eye: clip box, gaze group, shape group, a flat top lid and a round bottom lid in the body colour
  function eye(d, side, x, y, color) {
    const { w, h, cw, ch, oy } = geo(d, side), id = `v${++uid}${side}`, tilt = side === 'l' ? d.tilt : -d.tilt;
    return `<g class="e${side}" transform="translate(${n(x)} ${n(y + oy)})${tilt ? ` rotate(${tilt})` : ''}">` +
      `<clipPath id="${id}"><rect x="${n(-cw)}" y="${n(-ch)}" width="${n(2 * cw)}" height="${n(2 * ch)}"/></clipPath><g clip-path="url(#${id})">` +
      `<g class="gz"><g class="sh"><path d="${d.path(w, h)}" fill="${WHITE}"/></g></g>` +
      `<rect class="lt" x="${n(-cw - 3)}" y="${n(-2 * ch - 3)}" width="${n(2 * cw + 6)}" height="${n(2 * ch + 3)}" fill="${color}"/>` +
      `<ellipse class="lb" rx="${n(w * 0.8)}" ry="${n(h * 0.5)}" fill="${color}"/></g></g>`;
  }
  function eyes(num, fx, fy, color) {
    const d = byNum[num];
    return eye(d, 'l', fx - d.dx, fy, color) + eye(d, 'r', fx + d.dx, fy, color);
  }

  // mood transforms, generated per design so every value is in that design's units
  function css() {
    let s = '.e2 .sh,.e2 .lt,.e2 .lb{transition:transform 220ms cubic-bezier(.23,1,.32,1)}.e2 .gz{transition:transform 160ms cubic-bezier(.23,1,.32,1)}.e2.blink .sh{transition-duration:70ms}';
    for (const d of EYES) for (const side of ['l', 'r']) {
      const { w, h, cw, ch } = geo(d, side), room = cw - w / 2 - 0.3, sel = (m) => `.e2.d${d.num}[data-mood=${m}] .e${side}`;
      const hideT = `translateY(${n(-ch)}px)`, hideB = `translateY(${n(h * 0.5 + ch)}px)`;
      s += `.e2.d${d.num} .e${side} .lt{transform:${hideT}}.e2.d${d.num} .e${side} .lb{transform:${hideB}}`;
      s += `${sel('blink')} .sh,.e2.d${d.num}.blink .e${side} .sh{transform:scale(1.06,.1)}`;
      s += `${sel('look-left')} .sh{transform:translateX(${n(-room)}px) scaleX(${side === 'l' ? 0.7 : 0.92})}`;
      s += `${sel('look-right')} .sh{transform:translateX(${n(room)}px) scaleX(${side === 'r' ? 0.7 : 0.92})}`;
      s += `${sel('happy')} .lb{transform:translateY(${n(h * 0.45)}px)}`;
      s += `${sel('sleepy')} .lt{transform:translateY(0)}`;
      s += `${sel('surprised')} .sh{transform:scale(1.06,1.16)}`;
      s += `${sel('thinking')} .sh{transform:translate(${n(room * 0.5)}px,${n(-(ch - h / 2) * 0.85)}px) scaleY(.94)}`;
      s += `${sel('sad')} .lt{transform:rotate(${side === 'l' ? 20 : -20}deg) translateY(${n(-h * 0.2)}px)}${sel('sad')} .sh{transform:translateY(1px)}`;
    }
    return s;
  }

  // pointer look for idle bots: eyes slide, the eye on the pointer side narrows
  function look(svg, nx, ny) {
    const num = +svg.dataset.eye, d = byNum[num];
    for (const side of ['l', 'r']) {
      const g = svg.querySelector(`.e${side} .gz`); if (!g) continue;
      const { w, h, cw } = geo(d, side), room = cw - w / 2 - 0.3, near = side === 'l' ? -nx : nx;
      g.style.transform = svg.dataset.mood === 'idle' ? `translate(${n(nx * room)}px, ${n(ny * h * 0.1)}px) scaleX(${n(1 - 0.24 * Math.max(0, near))})` : '';
    }
  }

  // pixel v2: bodies are our own signed tests on a -1..1 square, rasterised per cell
  const BODIES = {
    blob: (u, v) => (u / 0.9) ** 2 + ((v - 0.08) / 0.84) ** 2 < 1,
    squircle: (u, v) => (Math.abs(u) / 0.88) ** 4 + (Math.abs(v - 0.06) / 0.84) ** 4 < 1,
    cat: (u, v) => {
      const a = Math.abs(u);
      if ((a / 0.88) ** 4 + (Math.abs(v - 0.16) / 0.74) ** 4 < 1) return true;
      return v > -0.92 && v < -0.4 && a <= 0.86 && a >= 0.78 - ((v + 0.92) / 0.52) * 0.5;
    },
    bunny: (u, v) => {
      const a = Math.abs(u);
      if ((a / 0.86) ** 2 + ((v - 0.32) / 0.6) ** 2 < 1) return true;
      if (v < -0.8) return a > 0.27 && a < 0.47 && v > -0.94;
      return a > 0.22 && a < 0.52 && v >= -0.8 && v < -0.1;
    },
    ghost: (u, v) => {
      const a = Math.abs(u);
      if (v < -0.1) return (u / 0.84) ** 2 + ((v + 0.1) / 0.8) ** 2 < 1;
      if (a > 0.84 || v > 0.88) return false;
      return !(v > 0.66 && Math.cos((u + 0.84) * Math.PI * 2.4) < -0.25);
    },
    bean: (u, v) => {
      const a = -0.3, y0 = v - 0.08, x = u * Math.cos(a) - y0 * Math.sin(a), y = u * Math.sin(a) + y0 * Math.cos(a);
      return (x / 0.9) ** 2 + (y / 0.76) ** 2 < 1;
    },
    chick: (u, v) => (u / 0.86) ** 2 + ((v - 0.14) / 0.78) ** 2 < 1 || (v > -0.94 && v < -0.6 && Math.abs(u - 0.04 - (v + 0.6) * 0.35) < 0.1),
    cloud: (u, v) => {
      const c = (cx, cy, r) => (u - cx) ** 2 + (v - cy) ** 2 < r * r;
      return c(-0.5, 0.36, 0.4) || c(0.02, 0.02, 0.56) || c(0.52, 0.38, 0.38) || (Math.abs(u) < 0.56 && v > 0.3 && v < 0.78);
    },
  };
  // n, name, grid, body, eye [w, h, rounded], inner gap, eye top as share of grid, edge
  const PIX = [
    [1, 'blob', 16, 'blob', [2, 4], 4, 0.34, 'hard'],
    [2, 'squircle', 16, 'squircle', [2, 3], 4, 0.38, 'hard'],
    [3, 'slim cat', 16, 'cat', [1, 3], 4, 0.44, 'hard'],
    [4, 'bunny', 20, 'bunny', [2, 4], 4, 0.52, 'hard'],
    [5, 'ghost', 20, 'ghost', [2, 4], 4, 0.3, 'hard'],
    [6, 'low bean', 16, 'bean', [2, 3], 2, 0.46, 'hard'],
    [7, 'chick', 20, 'chick', [2, 4], 4, 0.42, 'hard'],
    [8, 'cloud', 24, 'cloud', [3, 5, true], 4, 0.4, 'hard'],
    [9, 'tiny', 12, 'blob', [1, 2], 2, 0.38, 'hard'],
    [10, 'big squircle', 24, 'squircle', [3, 6, true], 6, 0.3, 'hard'],
    [11, 'close cat', 20, 'cat', [2, 5], 2, 0.42, 'hard'],
    [12, 'long bean', 24, 'bean', [2, 6], 4, 0.34, 'hard'],
  ].map(([num, name, N, body, eye, gap, ey, edge]) => ({ num, name, N, body, ew: eye[0], eh: eye[1], round: !!eye[2], gap, ey, edge }));
  const PX_STATES = ['idle', 'blink', 'look left', 'look right', 'happy', 'sleepy', 'surprised'];

  const hex2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => '#' + hex2(a).map((v, i) => Math.round(v + (hex2(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
  function grid(p) {
    const g = [];
    for (let y = 0; y < p.N; y++) { g.push([]); for (let x = 0; x < p.N; x++) g[y].push(BODIES[p.body](((x + 0.5) / p.N) * 2 - 1, ((y + 0.5) / p.N) * 2 - 1)); }
    return g;
  }
  function bodyRects(p, color) {
    const g = grid(p), N = p.N, at = (x, y) => x >= 0 && y >= 0 && x < N && y < N && g[y][x];
    const cell = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (at(x, y)) {
        const edge = !at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1);
        cell.push([x, y, p.edge === 'rim' && edge ? mix(color, '#0b0d14', 0.3) : color]);
      } else if (p.edge === 'soft') {
        const k = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].filter(Boolean).length;
        // corner fill is the body colour at half opacity, never a white blend, so it reads clean on any background
        if (k >= 2) cell.push([x, y, color, 0.5]);
      }
    }
    // merge runs per row
    let out = '';
    for (let i = 0; i < cell.length; i++) {
      let [x, y, f, o] = cell[i], w = 1;
      while (cell[i + 1] && cell[i + 1][1] === y && cell[i + 1][0] === x + w && cell[i + 1][2] === f && cell[i + 1][3] === o) { w++; i++; }
      out += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${f}"${o ? ` fill-opacity="${o}"` : ''}/>`;
    }
    return out;
  }
  function eyeRects(p, state) {
    const { N, ew: w, eh: h, gap } = p, t = Math.round(N * p.ey), cols = { l: N / 2 - gap / 2 - w, r: N / 2 + gap / 2 };
    let out = '';
    const px = (x, y) => { out += `<rect x="${x}" y="${y}" width="1" height="1" fill="${WHITE}"/>`; };
    const box = (x, y, bw, bh, round) => {
      for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
        if (round && (i === 0 || i === bw - 1) && (j === 0 || j === bh - 1)) continue;
        px(x + i, y + j);
      }
    };
    for (const side of ['l', 'r']) {
      const c = cols[side];
      if (state === 'blink') { const lw = Math.max(w, 2); box(w === 1 && side === 'l' ? c - 1 : c, t + Math.floor(h * 0.6), lw, 1); }
      else if (state === 'look left' || state === 'look right') {
        const dir = state === 'look left' ? -1 : 1, near = (side === 'l') === (dir < 0);
        if (near && w > 1) box(dir < 0 ? c - 1 : c + 2, t, w - 1, h, false);
        else if (near) box(c + dir, t + 1, 1, h - 1);
        else box(c + dir, t, w, h, p.round);
      } else if (state === 'happy') {
        const r = t + Math.floor(h / 2) - 1;
        box(c, r, w, 1); px(c - 1, r + 1); px(c + w, r + 1);
        if (h >= 5) { px(c - 1, r + 2); px(c + w, r + 2); }
      } else if (state === 'sleepy') { const k = Math.ceil(h / 2); box(c, t + k, w, h - k); }
      else if (state === 'surprised') box(c, t - 1, w, h + 1, p.round);
      else box(c, t, w, h, p.round);
    }
    return out;
  }
  function pixel(num, color, state, opt = {}) {
    const p = PIX.find((x) => x.num === num), label = opt.label ? `role="img" aria-label="${opt.label}"` : 'aria-hidden="true"';
    return `<svg class="px2" viewBox="0 0 ${p.N} ${p.N}" ${label} data-px="${num}"${opt.w ? ` width="${opt.w}" height="${opt.w}"` : ''}><g class="bob">${bodyRects(p, color)}<g class="pe">${eyeRects(p, state)}</g></g></svg>`;
  }
  return { EYES, byNum, MOODS, key, eyes, css, look, PIX, PX_STATES, pixel, eyeRects };
})();
