(() => {
  const PAL = window.PALETTES, ICONS = window.ICONS;
  const $ = (s, r = document) => r.querySelector(s);
  const n = (v) => Math.round(v * 100) / 100;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  

  // geometry: every shape lives in a 100 box and stands on y 88
  const circle = (cx, cy, r) => `M${n(cx - r)} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  function soft(pts, r) {
    const rs = Array.isArray(r) ? r : pts.map(() => r);
    let d = '';
    pts.forEach(([x, y], i) => {
      const [px, py] = pts[(i + pts.length - 1) % pts.length], [nx, ny] = pts[(i + 1) % pts.length];
      const lp = Math.hypot(px - x, py - y), ln = Math.hypot(nx - x, ny - y), c = Math.min(rs[i], lp / 2, ln / 2);
      const a = [x + ((px - x) / lp) * c, y + ((py - y) / lp) * c], b = [x + ((nx - x) / ln) * c, y + ((ny - y) / ln) * c];
      d += `${i ? 'L' : 'M'}${n(a[0])} ${n(a[1])}Q${x} ${y} ${n(b[0])} ${n(b[1])}`;
    });
    return d + 'Z';
  }
  const rect = (x1, y1, x2, y2, r) => soft([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], r);
  const ring = (cx, cy, k, rad, start) => Array.from({ length: k }, (_, i) => {
    const a = ((start + (360 / k) * i) * Math.PI) / 180, r = typeof rad === 'function' ? rad(i) : rad;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });

  // name, path, face centre
  const SHAPES = [
    ['circle', circle(50, 55, 33), [50, 52]],
    ['loaf', rect(16, 26, 84, 88, 24), [50, 54]],
    ['cat', soft([[18, 36], [21, 12], [41, 29], [59, 29], [79, 12], [82, 36], [84, 88], [16, 88]], [8, 6, 9, 9, 6, 8, 22, 22]), [50, 58]],
    ['bean', 'M24 32C33 15 64 11 78 25C91 38 90 65 76 79C62 93 33 91 21 76C12 63 16 44 24 32Z', [53, 50]],
    ['ghost', 'M18 54A32 32 0 0 1 82 54V80Q82 90 73 85Q66 81 59 86Q50 92 41 86Q34 81 27 85Q18 90 18 80Z', [50, 52]],
    ['bunny', rect(20, 42, 80, 88, 26) + rect(28, 8, 42, 52, 7) + rect(58, 8, 72, 52, 7), [50, 64]],
    ['drop', 'M46 16Q50 9 54 16C64 30 82 44 82 60C82 78 68 88 50 88C32 88 18 78 18 60C18 44 36 30 46 16Z', [50, 61]],
    ['bear', circle(50, 57, 31) + circle(25, 32, 11) + circle(75, 32, 11), [50, 56]],
    ['cloud', circle(33, 64, 19) + circle(52, 52, 24) + circle(70, 64, 17) + rect(14, 62, 86, 88, 18), [50, 62]],
    ['chick', circle(50, 58, 30) + 'M47 31C41 23 42 15 48 11C51 18 55 23 53 31Z' + 'M53 31C54 25 58 20 64 20C62 26 59 30 55 32Z', [50, 57]],
    ['pill', rect(22, 16, 78, 88, 28), [50, 44]],
    ['slime', 'M50 30C66 30 76 42 78 56C86 60 90 68 90 77C90 84 86 88 80 88H20C14 88 10 84 10 77C10 68 14 60 22 56C24 42 34 30 50 30Z', [50, 60]],
    ['frog', rect(12, 46, 88, 88, 22) + circle(39.5, 43, 13) + circle(60.5, 43, 13), [50, 43]],
    ['heart', 'M46 86C20 70 12 54 14 42C16 28 30 22 40 26C45 28 48 32 50 35C52 32 55 28 60 26C70 22 84 28 86 42C88 54 80 70 54 86Q50 89 46 86Z', [50, 48]],
    ['star', soft(ring(50, 56, 10, (i) => (i % 2 ? 22 : 40), -90), 7), [50, 57]],
    ['hex', soft(ring(50, 55, 6, 34, -90), 10), [50, 54]],
    ['sprout', circle(50, 58, 30) + 'M48 31V22C48 14 56 9 66 10C65 18 59 23 52 23V31Z', [50, 57]],
    ['mochi', soft([[10, 40], [90, 40], [90, 88], [10, 88]], [36, 36, 22, 22]), [50, 62]],
  ];
  const SHAPE = Object.fromEntries(SHAPES.map(([k, d, f]) => [k, { d, f }]));
  const ROW12 = ['circle', 'loaf', 'cat', 'bean', 'ghost', 'bunny', 'drop', 'bear', 'cloud', 'chick', 'pill', 'slime'];


  const css = new CSSStyleSheet();
  css.replaceSync(V2.css());
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, css];

  function mascot(shape, color, eyeNum, opt = {}) {
    const s = SHAPE[shape], [fx, fy] = s.f;
    const label = opt.label ? `role="img" aria-label="${opt.label}"` : 'aria-hidden="true"';
    return `<svg class="m e2 d${eyeNum}" viewBox="0 0 100 100" ${label} data-eye="${eyeNum}" data-mood="${opt.mood || 'idle'}"${opt.gaze ? ' data-gaze' : ''}${opt.w ? ` width="${opt.w}" height="${opt.w}"` : ''}>` +
      s.d.split(/(?=M)/).map((d) => `<path d="${d}" fill="${color}"/>`).join('') + V2.eyes(eyeNum, fx, fy, color) + '</svg>';
  }

  // state
  let eyeNum = 1, palIdx = 0;
  const cols = () => PAL[palIdx].colors;
  const pad = (k) => String(k).padStart(2, '0');

  function radios(host, name, items, current, onPick) {
    host.insertAdjacentHTML('beforeend', items.map(([v, l, t]) =>
      `<label${t ? ` title="${t}"` : ''}><input type="radio" name="${name}" value="${v}"${v === current ? ' checked' : ''}${t ? ` aria-label="${l} ${t}"` : ''}><span>${l}</span></label>`).join(''));
    host.addEventListener('change', (e) => onPick(e.target.value));
  }
  radios($('#eye-pick'), 'eye', V2.EYES.map((e) => [String(e.num), String(e.num), e.name]), '1', (v) => { eyeNum = +v; renderPalettes(); renderFamily(); observe(); });
  radios($('#pal-pick'), 'pal', PAL.map((p, i) => [String(i), p.name]), '0', (v) => { palIdx = +v; renderAll(); });

  // 1. eyes v2
  const BODY5 = ['circle', 'loaf', 'cat', 'ghost', 'bunny'], COL5 = [0, 3, 4, 6, 9];
  function renderEyes() {
    const c = cols();
    $('#e2-grid').innerHTML = V2.EYES.map((d) => `<article class="e2card" id="eye-${d.num}"><header><span class="num">${pad(d.num)}</span><h3>${d.name}</h3></header><p>${d.note}</p>` +
      `<div class="e2row">${BODY5.map((b, i) => mascot(b, c[COL5[i]].hex, d.num, { label: `${b} with eyes ${d.num}` })).join('')}</div>` +
      `<div class="e2moods">${V2.MOODS.map((m) => `<figure>${mascot('circle', c[0].hex, d.num, { mood: V2.key(m), label: `eyes ${d.num} ${m}` })}<figcaption>${m}</figcaption></figure>`).join('')}</div>` +
      `<div class="e2row e2dark">${BODY5.map((b, i) => mascot(b, c[COL5[i]].dark, d.num, { label: `${b} with eyes ${d.num} on dark` })).join('')}</div></article>`).join('');
  }
  const PICKS = [1, 6, 9];
  const CYCLE = ['idle', 'look-left', 'look-right', 'happy', 'thinking', 'surprised', 'sad', 'sleepy'];
  const timers = [];
  function renderLive() {
    timers.forEach(clearInterval); timers.length = 0;
    const c = cols();
    $('#e2-live').innerHTML = PICKS.map((k) => `<div class="stage2"><header><span class="num">${pad(k)}</span><h3>${V2.byNum[k].name}</h3><span class="mood" aria-live="polite">idle</span></header>` +
      `<div class="stage2-bots">${mascot('bean', c[0].hex, k, { gaze: 1, label: 'bean bot' })}${mascot('cat', c[4].hex, k, { gaze: 1, label: 'cat bot' })}${mascot('ghost', c[3].hex, k, { gaze: 1, label: 'ghost bot' })}</div>` +
      `<button type="button" class="btn ghost" aria-pressed="${!reduce}">${reduce ? 'play moods' : 'pause moods'}</button></div>`).join('');
    $('#e2-live').querySelectorAll('.stage2').forEach((st) => {
      let i = 0, on = !reduce, t = 0;
      const set = (m) => { st.querySelectorAll('svg.m').forEach((s) => { s.dataset.mood = m; V2.look(s, 0, 0); }); st.querySelector('.mood').textContent = m.replace('-', ' '); };
      const tick = () => { if (!on) return; t++; if (CYCLE[i] === 'idle' && t < 3) return; t = 0; i = (i + 1) % CYCLE.length; set(CYCLE[i]); };
      timers.push(setInterval(tick, 1300));
      const b = st.querySelector('button');
      b.addEventListener('click', () => { on = !on; b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'pause moods' : 'play moods'; if (!on) { i = 0; set('idle'); } });
    });
  }

  // 2. pixel v2
  const PX_PICKS = [1, 4, 10];
  function renderPixel2() {
    const c = cols();
    $('#p2-grid').innerHTML = V2.PIX.map((p, i) => {
      const col = c[(i * 5) % 12].hex;
      return `<article class="p2card"><header><span class="num">${pad(p.num)}</span><h3>${p.name}</h3></header>` +
        `<p class="spec">${p.N}×${p.N} · eyes ${p.ew}×${p.eh}${p.round ? ' rounded' : ''} · gap ${p.gap} · ${p.edge} edge</p>` +
        `<div class="p2big">${V2.pixel(p.num, col, 'idle', { label: `pixel ${p.num} ${p.name}` })}</div>` +
        `<div class="p2states">${V2.PX_STATES.map((s) => `<figure>${V2.pixel(p.num, col, s, { label: `${p.name} ${s}` })}<figcaption>${s}</figcaption></figure>`).join('')}</div></article>`;
    }).join('');
    $('#p2-dark').innerHTML = V2.PIX.map((p, i) => V2.pixel(p.num, c[(i * 5) % 12].hex, 'idle', { w: 48, label: `pixel ${p.num} on dark` })).join('');
    $('#p2-live').innerHTML = PX_PICKS.map((k, i) => `<figure class="p2stage"><div>${V2.pixel(k, c[[0, 4, 9][i]].hex, 'idle', { label: `pixel ${k} live` })}</div><figcaption><span class="num">${pad(k)}</span> ${V2.PIX.find((p) => p.num === k).name}</figcaption></figure>`).join('');
  }
  // live pixel: blink now and then, glance left and right, the 1px bob is css
  if (!reduce) {
    let beat = 0;
    setInterval(() => {
      beat++;
      document.querySelectorAll('#p2-live svg.px2').forEach((s, i) => {
        const p = V2.PIX.find((x) => x.num === +s.dataset.px), e = s.querySelector('.pe');
        const ph = (beat + i * 2) % 12;
        const st = ph === 3 ? 'blink' : ph === 6 || ph === 7 ? 'look left' : ph === 9 || ph === 10 ? 'look right' : 'idle';
        e.innerHTML = V2.eyeRects(p, st);
        if (st === 'blink') setTimeout(() => { e.innerHTML = V2.eyeRects(p, 'idle'); }, 140);
      });
    }, 450);
  }

  // 3. palettes
  const ROW12b = ROW12;
  function renderPalettes() {
    $('#pal-list').innerHTML = PAL.map((p, pi) => `<article class="pal"><div class="pal-meta"><h3>${p.name}${pi === 0 ? ' <span class="tag">pick</span>' : ''}</h3>` +
      `<div class="refs">from ${p.refs.map((r) => `<span>${r}</span>`).join('')}</div></div>` +
      `<div class="sw">${p.colors.map((c) => `<div><div class="chip"><i data-c="${c.hex}"></i></div><b>${c.n}</b><small>${c.hex}<br>eyes ${c.eyes}:1</small></div>`).join('')}</div>` +
      `<div class="row">${p.colors.map((c, i) => mascot(ROW12b[i], c.hex, eyeNum, { label: `${c.n} ${ROW12b[i]}` })).join('')}</div>` +
      `<div class="row on-dark slim">${p.colors.map((c, i) => mascot(ROW12b[i], c.dark, eyeNum, { label: `${c.n} ${ROW12b[i]} on dark` })).join('')}</div></article>`).join('');
    $('#pal-list').querySelectorAll('[data-c]').forEach((el) => { el.style.background = el.dataset.c; });
  }

  // 4. family
  function renderFamily() {
    const c = cols();
    $('#fam-light').innerHTML = SHAPES.map(([k], i) => `<figure>${mascot(k, c[i % 12].hex, eyeNum, { gaze: 1, label: `${k} bot` })}<figcaption>${k}</figcaption></figure>`).join('');
    $('#fam-dark').innerHTML = SHAPES.map(([k], i) => `<figure>${mascot(k, c[(i + 5) % 12].dark, eyeNum, { label: `${k} bot on dark` })}<figcaption>${k}</figcaption></figure>`).join('');
    $('#sizes').innerHTML = [128, 64, 40, 24, 16].map((w) => `<figure>${mascot('cat', c[0].hex, eyeNum, { w, label: `cat at ${w} px` })}<figcaption>${w} px</figcaption></figure>`).join('');
  }

  // 5. icons
  const COLS = [
    ['gravity', 'gravity ui', 'mit · 809 icons · 16 grid', true],
    ['phosphor', 'phosphor', 'mit · 1,500 × 6 weights'],
    ['tabler', 'tabler', 'mit · 5,900 icons'],
    ['lucide', 'lucide (now)', 'isc · 1,700 icons'],
    ['anim', 'lucide-animated', 'mit · react + motion; css port here'],
  ];
  const DRAW = new Set(['check', 'x']);
  function iconSvg(set, role, motion) {
    const src = ICONS.sets[set === 'anim' ? 'lucide' : set][role];
    let inner = src.inner;
    if (set === 'anim' && DRAW.has(motion)) inner = inner.replace(/<path /g, '<path pathLength="1" ');
    return `<span class="ic mo-${motion}${set === 'anim' && DRAW.has(motion) ? ' draw' : ''}"><svg viewBox="${src.vb}" ${src.attrs} aria-hidden="true">${inner}</svg></span>`;
  }
  function renderIcons() {
    const avg = (k) => { const b = ICONS.bytes[k === 'anim' ? 'lucide' : k]; return `${Math.round(b[0] / 22)} b, ${Math.round(b[1] / 22)} b gz each`; };
    const head = `<thead><tr><th scope="col">role</th>${COLS.map(([k, t, s, rec]) => `<th scope="col"${rec ? ' class="rec"' : ''}>${t}${rec ? ' <span class="tag">pick</span>' : ''}<small>${s}<br>${k === 'anim' ? 'paths draw on check, x' : avg(k)}</small></th>`).join('')}</tr></thead>`;
    const body = `<tbody>${ICONS.roles.map(({ role, motion }) => `<tr><th scope="row">${role}</th>${COLS.map(([k, , , rec]) => `<td${rec ? ' class="rec"' : ''}>${iconSvg(k, role, motion)}<small class="n">${ICONS.sets[k === 'anim' ? 'lucide' : k][role].name}</small></td>`).join('')}</tr>`).join('')}</tbody>`;
    $('#icon-table').insertAdjacentHTML('beforeend', head + body);
    $('#icon-dark').innerHTML = COLS.slice(0, 4).map(([k, t]) => `<div class="line"><b>${t}</b>${ICONS.roles.map(({ role, motion }) => iconSvg(k, role, motion)).join('')}</div>`).join('');
    $('#play-all').addEventListener('click', () => {
      const t = $('#icon-table');
      t.classList.remove('play'); void t.offsetWidth; t.classList.add('play');
      setTimeout(() => t.classList.remove('play'), 700);
    });
  }

  function renderAll() { renderEyes(); renderLive(); renderPixel2(); renderPalettes(); renderFamily(); observe(); }

  // idle bots marked data-gaze follow the pointer while on screen
  const seen = new Set();
  const io = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target))));
  function observe() { seen.clear(); io.disconnect(); document.querySelectorAll('svg.m[data-gaze]').forEach((s) => io.observe(s)); }
  let px = 0, py = 0, raf = 0;
  if (!reduce) {
    addEventListener('pointermove', (e) => {
      px = e.clientX; py = e.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        seen.forEach((s) => {
          const r = s.getBoundingClientRect(), dx = px - (r.left + r.width / 2), dy = py - (r.top + r.height * 0.45);
          const d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
          V2.look(s, (dx / d) * k, (dy / d) * k);
        });
      });
    }, { passive: true });
    setInterval(() => {
      document.querySelectorAll('#e2-live svg.m, #fam-light svg.m').forEach((s) => {
        if (s.dataset.mood !== 'idle' || Math.random() > 0.25) return;
        s.classList.add('blink');
        setTimeout(() => s.classList.remove('blink'), 130);
      });
    }, 1300);
  }

  renderIcons();
  renderAll();
})();
