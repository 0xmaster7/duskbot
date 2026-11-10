/* motion kit v2: spring motion on Motion 13 (window.Motion). paste motion.min.js whole, then this file whole, each in a
   <script> right before </body>; motion-kit-v2.css goes in <head>. content is complete without either script: the kit only
   hides what it is about to reveal, and only when Motion and IntersectionObserver exist and motion is allowed.
   api: MK.scrollTo(y | element | '#id', {duration}), MK.count(el, text), MK.refresh(), MK.settle(), MK.destroy(), MK.init() */
(() => {
  'use strict';
  if (window.MK) return;
  const html = document.documentElement;
  const all = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ms = v => (v = String(v).trim()).endsWith('ms') ? parseFloat(v) : v.endsWith('s') ? parseFloat(v) * 1000 : parseFloat(v) || 0;
  const easeInOutCubic = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const mq = {
    reduce: matchMedia('(prefers-reduced-motion: reduce)'),
    fine: matchMedia('(hover: hover) and (pointer: fine)'),
    wide: matchMedia('(min-width: 760px)'),
  };
  const calm = () => mq.reduce.matches;
  const desk = () => mq.fine.matches && !calm();
  const view = { vh: innerHeight, max: 0, lastY: null };
  const seen = new WeakSet();
  const origText = new WeakMap();
  let S = null, M = null, intended = false, warned = false;

  /* ---------- springs: [visual duration in seconds, bounce]. reveals read theirs from css tokens ---------- */
  const SPRING = {
    press: [.12, 0], release: [.3, .35], lift: [.35, .25], magnet: [.25, 0], home: [.45, .25],
    ui: [.32, .18], thumb: [.3, .3], panel: [.4, .1], height: [.42, 0], number: [.45, 0], count: [.6, 0],
  };
  const pair = (v, d) => { const p = String(v || '').trim().split(/[\s,]+/).map(parseFloat).filter(Number.isFinite); return [p[0] ?? d[0], p[1] ?? d[1]]; };
  const tuned = (el, d) => el.hasAttribute('data-mk-spring') ? pair(el.getAttribute('data-mk-spring'), d) : d;
  // animateMini (waapi, compositor) needs the spring generator itself; animate (js, carries velocity) takes the string
  const wapi = ([d, b], extra = {}) => ({ type: M.spring, visualDuration: d, bounce: b, ...extra });
  const js = ([d, b], extra = {}) => ({ type: 'spring', visualDuration: d, bounce: b, ...extra });
  const numOf = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 1; };

  /* ---------- engine: cached geometry, one frame for every engine recipe (depth, scrub, theme, nav) ---------- */
  function makeEngine(on) {
    const items = [], jumpHooks = [], intentHooks = [];
    let raf = 0, mraf = 0, itimer = 0, dead = false;
    const instant = () => {
      html.classList.add('mk-instant');
      cancelAnimationFrame(itimer);
      itimer = requestAnimationFrame(() => { itimer = requestAnimationFrame(() => html.classList.remove('mk-instant')); });
    };
    // a move of most of a viewport in one frame is a teleport: settle instead of animating
    const tick = () => {
      if (dead) return;
      const y = scrollY, vh = view.vh;
      const jump = view.lastY !== null && Math.abs(y - view.lastY) > vh * .9;
      view.lastY = y;
      if (jump) { instant(); jumpHooks.forEach(f => f()); }
      for (const it of items) it.update?.(y, vh);
    };
    const request = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; tick(); }); };
    const measure = () => {
      mraf = 0;
      if (dead) return;
      view.vh = innerHeight;
      for (const it of items) it.measure?.();
      view.max = Math.max(0, html.scrollHeight - view.vh);
      tick();
    };
    const requestMeasure = () => { if (!mraf && !dead) mraf = requestAnimationFrame(measure); };
    // first sign the reader is about to scroll; reveals below the fold arm only then, so an untouched page is complete
    const intent = () => { if (intended) return; intended = true; intentHooks.splice(0).forEach(f => f()); };
    const onIntent = f => { if (intended) f(); else intentHooks.push(f); };
    on(window, 'scroll', () => { intent(); request(); }, { passive: true });
    // a resize (including a capture tool resizing the viewport) re-lays out the page: state changes it causes do not animate
    on(window, 'resize', () => { instant(); requestMeasure(); });
    on(window, 'load', requestMeasure);
    on(window, 'touchstart', intent, { passive: true });
    on(window, 'keydown', e => { if (SCROLL_KEYS.has(e.key) && !editable(e.target)) intent(); });
    const ro = new ResizeObserver(requestMeasure);
    ro.observe(document.body);
    document.fonts?.ready.then(requestMeasure);
    return {
      items, jumpHooks, onIntent, tick, request, measure, requestMeasure, intent, instant,
      destroy() { dead = true; cancelAnimationFrame(raf); cancelAnimationFrame(mraf); cancelAnimationFrame(itimer); ro.disconnect(); html.classList.remove('mk-instant'); intentHooks.length = 0; items.forEach(it => it.reset?.()); },
    };
  }
  const SCROLL_KEYS = new Set([' ', 'PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'End', 'Home']);
  const editable = el => el instanceof Element && !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  const trackOf = el => el.closest('[data-mk-track]') || el.closest('section') || el.parentElement;
  const geom = el => { const r = el.getBoundingClientRect(); return { top: r.top + scrollY, h: r.height }; };
  const rangeOf = (kind, g, vh) => {
    if (kind === 'enter') { const s = Math.max(0, g.top - vh); return [s, Math.max(s + 1, g.top - vh + Math.min(g.h, vh))]; }
    if (kind === 'exit') return [Math.max(0, g.top), g.top + g.h];
    return [Math.max(0, g.top - vh), g.top + g.h];
  };

  /* ---------- smooth wheel: lerps the native scroll position, so scrollbar, keys, anchors and scrollTo keep working ---------- */
  function makeSmooth(on, engine) {
    if (!html.hasAttribute('data-mk-smooth') || !desk()) return null;
    const k = parseFloat(html.getAttribute('data-mk-smooth')) || 9;
    let target = scrollY, cur = scrollY, written = scrollY, raf = 0, last = 0, tween = null;
    const write = y => { window.scrollTo(0, y); written = scrollY; };
    const sync = () => { target = cur = written = scrollY; };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; tween = null; sync(); };
    const loop = now => {
      raf = 0;
      if (Math.abs(scrollY - written) > 2) { tween = null; sync(); return; }
      const dt = last ? Math.min(.064, (now - last) / 1000) : 1 / 60;
      last = now;
      let done = null;
      if (tween) {
        const t = clamp((now - tween.t0) / tween.dur);
        cur = tween.from + (tween.to - tween.from) * easeInOutCubic(t);
        target = cur;
        if (t >= 1) { done = tween.done; tween = null; }
      } else {
        cur += (target - cur) * (1 - Math.exp(-k * dt));
        if (Math.abs(target - cur) < .4) cur = target;
      }
      write(cur);
      engine.tick();
      if (tween || cur !== target) raf = requestAnimationFrame(loop);
      done?.();
    };
    const start = () => { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } };
    const blocked = (node, dy) => {
      if (getComputedStyle(html).overflowY === 'hidden' || getComputedStyle(document.body).overflowY === 'hidden') return true;
      for (let el = node instanceof Element ? node : node?.parentElement; el && el !== document.body && el !== html; el = el.parentElement) {
        if (el.hasAttribute('data-mk-native') || el.matches('dialog[open], [aria-modal="true"]')) return true;
        if (el.scrollHeight > el.clientHeight + 1) {
          const oy = getComputedStyle(el).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0)) return true;
        }
      }
      return false;
    };
    on(window, 'wheel', e => {
      if (e.defaultPrevented || e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || blocked(e.target, e.deltaY)) return;
      const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.vh : 1);
      if (!raf) sync();
      if (tween) { tween = null; target = cur; }
      const max = view.max || Math.max(0, html.scrollHeight - innerHeight);
      const next = clamp(target + dy, 0, max);
      if (next === target && (dy > 0 ? scrollY >= max - 1 : scrollY <= 1)) return;
      e.preventDefault();
      engine.intent();
      target = next;
      start();
    }, { passive: false });
    on(window, 'scroll', () => { if (!raf) sync(); else if (Math.abs(scrollY - written) > 2) stop(); }, { passive: true });
    on(window, 'keydown', e => { if (raf && SCROLL_KEYS.has(e.key) && !editable(e.target)) stop(); });
    on(window, 'pointerdown', () => raf && stop());
    on(window, 'touchstart', () => raf && stop(), { passive: true });
    const go = (y, { duration, done } = {}) => {
      const to = clamp(y, 0, view.max || Math.max(0, html.scrollHeight - innerHeight));
      if (!raf) sync();
      engine.intent();
      tween = { from: scrollY, to, t0: performance.now(), dur: duration ?? clamp(Math.sqrt(Math.abs(to - scrollY)) * 18, 450, 1200), done };
      start();
    };
    return { go, destroy: () => { cancelAnimationFrame(raf); raf = 0; tween = null; } };
  }

  /* anchors: same-page links glide when the smooth wheel is on, otherwise the browser jumps natively */
  const destY = el => el.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0);
  const focusTarget = el => {
    if (!el.matches('a[href], button, input, select, textarea, [tabindex]')) {
      el.setAttribute('tabindex', '-1');
      el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
    }
    el.focus({ preventScroll: true });
  };
  function makeAnchors(on) {
    on(document, 'click', e => {
      const a = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
      if (!a || !S?.smooth || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const id = decodeURIComponent(a.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      if (id && !el && id !== 'top') return;
      e.preventDefault();
      if (a.hash && location.hash !== a.hash) history.pushState(null, '', a.hash);
      S.smooth.go(el ? destY(el) : 0, { done: () => el && focusTarget(el) });
    });
  }

  /* ---------- numbers: a final text that decides the width, and an aria-hidden run that springs to it ---------- */
  const NUM = /^([^\d-]*)(-?[\d,]*\.?\d+)([\s\S]*)$/;
  const parseNum = text => {
    const m = String(text).trim().match(NUM);
    if (!m) return null;
    const [, pre, num, post] = m, decimals = (num.split('.')[1] || '').length;
    const fmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: num.includes(',') });
    return { pre, post, value: parseFloat(num.replace(/,/g, '')), show: v => pre + fmt.format(v) + post };
  };
  const span = (cls, t) => { const s = document.createElement('span'); if (cls) s.className = cls; if (t != null) s.textContent = t; return s; };
  const countShell = (el, finalNodes) => {
    const wrap = span('mk-count'), final = span('mk-count-final'), run = span('mk-count-run');
    run.setAttribute('aria-hidden', 'true');
    final.append(...finalNodes);
    wrap.append(final, run);
    el.replaceChildren(wrap);
    return run;
  };
  // springs a number in place from what it shows now to `text`; ends as plain text. interruptible.
  function setNumber(el, text) {
    const tw = el._mkTw, to = parseNum(text);
    const fromV = tw ? tw.current : parseNum(el.textContent)?.value;
    tw?.anim.stop();
    if (!M || calm() || !to || fromV == null || fromV === to.value) { el._mkTw = null; el.classList.remove('mk-counting'); el.textContent = text; return; }
    const run = tw ? tw.run : countShell(el, []);
    run.parentElement.firstChild.textContent = text;
    el.classList.add('mk-counting');
    const state = { run, current: fromV };
    // spring a 0..1 progress so small and large changes settle in the same time
    state.anim = M.animate(0, 1, js(SPRING.number, { restDelta: .002, onUpdate: p => { state.current = fromV + (to.value - fromV) * p; run.textContent = to.show(state.current); } }));
    el._mkTw = state;
    state.anim.finished.then(() => { if (el._mkTw !== state) return; el._mkTw = null; el.classList.remove('mk-counting'); el.textContent = text; });
  }

  /* ---------- reveal: lines, words, blocks, sequences, image wipes, counts, rolls, all on springs ----------
     progressive enhancement: nothing is hidden by css alone. only with Motion, IntersectionObserver and motion allowed
     does the kit arm an element, and only one the reader is about to meet: the first viewport before first paint,
     everything below the fold at the first scroll intent. inView releases it once, then stops watching. no timers. */
  function makeReveal(on, engine) {
    const els = all('[data-mk-reveal]');
    if (!els.length || calm() || !M || !('IntersectionObserver' in window)) return null;
    const pending = new Set(), armed = new Set(), running = new Map(), stops = [];
    html.classList.add('mk-io');
    const type = el => el.getAttribute('data-mk-reveal') || 'up';

    const split = el => {
      const groups = [], words = [];
      const walk = node => {
        for (const c of [...node.childNodes]) {
          if (c.nodeType === 1) { if (!c.matches('svg, img, br')) walk(c); continue; }
          if (c.nodeType !== 3 || !c.textContent.trim()) continue;
          const frag = document.createDocumentFragment(), made = [];
          for (const t of c.textContent.split(/([ \t\n\r\f]+)/)) {
            if (!t) continue;
            if (/^[ \t\n\r\f]+$/.test(t)) { const s = document.createTextNode(t); frag.append(s); made.push(s); continue; }
            const w = span('mk-w'), i = span('mk-wi', t);
            w.append(i); frag.append(w); made.push(w); words.push(i);
          }
          groups.push({ original: c, made });
          c.replaceWith(frag);
        }
      };
      walk(el);
      el._mk = { kind: 'split', words, restore() { for (const g of groups) { g.made[0].before(g.original); g.made.forEach(n => n.remove()); } } };
    };

    const prepCount = el => {
      const n = parseNum(el.textContent);
      if (!n) return;
      const nodes = [...el.childNodes], from = parseFloat(el.getAttribute('data-mk-from') || '0');
      const run = countShell(el, nodes);
      run.textContent = n.show(from);
      el._mk = { kind: 'count', run, n, from, restore() { el.replaceChildren(...nodes); } };
    };

    const prepRoll = el => {
      const text = el.textContent, nodes = [...el.childNodes];
      const roll = span('mk-roll'), strips = [];
      roll.setAttribute('aria-hidden', 'true');
      for (const ch of text) {
        const digit = ch >= '0' && ch <= '9', letter = /\p{L}/u.test(ch);
        if (!digit && !letter) { roll.append(ch); continue; }
        const seq = digit
          ? Array.from({ length: 10 }, (_, n) => String((+ch + 1 + n) % 10))
          : [...Array.from({ length: 5 }, () => { const c = String.fromCharCode(97 + Math.floor(Math.random() * 26)); return ch === ch.toUpperCase() ? c.toUpperCase() : c; }), ch];
        const col = span('mk-rc'), strip = span('mk-rc-strip');
        seq.forEach(c => strip.append(span('', c)));
        col.append(span('mk-rc-size', ch), strip);
        roll.append(col);
        strips.push({ strip, n: seq.length });
      }
      el.replaceChildren(roll, span('mk-sr', text));
      el._mk = { kind: 'roll', strips, restore() { el.replaceChildren(...nodes); } };
    };

    // inline values the springs commit, recorded so finish() puts back exactly what the author had
    const keep = (el, node, props) => { el._mkInline ||= []; for (const p of props) el._mkInline.push([node, p, node.style.getPropertyValue(p)]); };
    const arm = el => {
      const t = type(el);
      if (t === 'lines' || t === 'words') split(el);
      else if (t === 'count') prepCount(el);
      else if (t === 'roll') prepRoll(el);
      if (el.hasAttribute('data-mk-stagger')) [...el.children].forEach(c => keep(el, c, ['opacity', 'translate']));
      else if (t === 'up' || t === 'fade') keep(el, el, ['opacity', 'translate']);
      else if (t === 'clip' || t === 'scale') {
        keep(el, el, ['opacity', 'scale', 'clip-path']);
        all('img', el).forEach(img => keep(el, img, ['scale']));
      }
      el.classList.add('mk-armed');
      armed.add(el);
    };

    const finish = el => {
      running.delete(el);
      const m = el._mk;
      if (m) { m.restore(); el._mk = null; }
      for (const [node, p, prev] of el._mkInline || []) prev ? node.style.setProperty(p, prev) : node.style.removeProperty(p);
      el._mkInline = null;
      el._mkLoad = false;
      el.classList.remove('mk-armed');
    };

    const start = j => {
      const { el } = j, t = type(el), m = el._mk, D = j.delay, anims = [];
      const go = (target, kf, spring, delay = D) => anims.push(M.animateMini(target, kf, wapi(spring, { delay })));
      if (el.hasAttribute('data-mk-stagger')) {
        [...el.children].forEach((c, i) => go(c, { opacity: [0, 1], translate: [`0 ${j.rise}`, '0 0'] }, j.spring, D + Math.min(i, 8) * j.gap));
      } else if (m?.kind === 'split') {
        const lines = new Map();
        m.words.forEach((w, i) => { const l = j.lines[i]; if (!lines.has(l)) lines.set(l, []); lines.get(l).push(w); });
        for (const [l, words] of lines) go(words, { translate: ['0 125%', '0 0'] }, j.spring, D + Math.min(l, 8) * j.gap);
      } else if (t === 'clip') {
        const from = { top: 'inset(0% 0% 100% 0%)', left: 'inset(0% 100% 0% 0%)', right: 'inset(0% 0% 0% 100%)', center: 'inset(18% 18% 18% 18%)' }[el.getAttribute('data-mk-from')] || 'inset(100% 0% 0% 0%)';
        go(el, { clipPath: [from, 'inset(0% 0% 0% 0%)'] }, j.wipe);
        all('img', el).forEach(img => go(img, { scale: [1.14, 1] }, j.wipe));
      } else if (t === 'scale') {
        go(el, { opacity: [0, 1], scale: [.92, 1] }, j.wipe);
        all('img', el).forEach(img => go(img, { scale: [1.12, 1] }, j.wipe));
      } else if (m?.kind === 'count') {
        anims.push(M.animate(0, 1, js(SPRING.count, { delay: D, restDelta: .002, onUpdate: p => { m.run.textContent = m.n.show(m.from + (m.n.value - m.from) * p); } })));
      } else if (m?.kind === 'roll') {
        m.strips.forEach(({ strip, n }, i) => go(strip, { translate: ['0 0', `0 ${(-100 * (n - 1) / n).toFixed(4)}%`] }, j.wipe, D + Math.min(i, 6) * .045));
      } else if (t === 'fade') {
        go(el, { opacity: [0, 1] }, j.spring);
      } else if (t !== 'count' && t !== 'roll') {
        go(el, { opacity: [0, 1], translate: [`0 ${j.rise}`, '0 0'] }, j.spring);
      }
      if (!anims.length) { finish(el); return; }
      running.set(el, anims);
      Promise.all(anims.map(a => a.finished)).then(() => { if (running.get(el) === anims) finish(el); });
    };

    const play = list => {
      const jobs = list.filter(j => armed.has(j.el));
      // read everything first, then write
      for (const j of jobs) {
        const cs = getComputedStyle(j.el), m = j.el._mk;
        j.delay = ms(cs.getPropertyValue('--mk-delay')) / 1000;
        j.gap = (parseFloat(j.el.getAttribute('data-mk-stagger')) || ms(cs.getPropertyValue('--mk-stagger')) || 70) / 1000;
        j.rise = cs.getPropertyValue('--mk-rise').trim() || '24px';
        // the first viewport plays while the page loads, so it uses the quicker load spring
        j.spring = tuned(j.el, j.el._mkLoad ? pair(cs.getPropertyValue('--mk-spring-load'), [.42, .06]) : pair(cs.getPropertyValue('--mk-spring-reveal'), [.55, .08]));
        j.wipe = tuned(j.el, pair(cs.getPropertyValue('--mk-spring-wipe'), [.7, 0]));
        if (m?.kind === 'split') {
          let line = 0, prev = null;
          j.lines = m.words.map((w, i) => {
            if (type(j.el) === 'words') return i;
            const top = w.getBoundingClientRect().top;
            if (prev !== null && top > prev + 2) line++;
            if (prev === null || top > prev + 2) prev = top;
            return line;
          });
        }
      }
      for (const j of jobs) {
        armed.delete(j.el);
        if (j.instant) { finish(j.el); continue; }
        try { start(j); } catch (err) { finish(j.el); console.warn('motion kit: reveal skipped', err); }
      }
    };

    // inView calls back once per element; collect one batch per task so line measuring stays read-then-write
    const queue = [];
    let queued = false;
    const enqueue = (el, entry) => {
      queue.push({ el, instant: entry.boundingClientRect.bottom < 0 });
      if (!queued) { queued = true; queueMicrotask(() => { queued = false; play(queue.splice(0)); }); }
    };
    // the huge top margin means "at or above the reveal line": an element jumped past still counts as seen
    const watch = list => { if (list.length) stops.push(M.inView(list, (el, entry) => { enqueue(el, entry); }, { margin: '100000px 0px -8% 0px' })); };

    const complete = () => { for (const anims of running.values()) anims.forEach(a => a.complete()); };
    const settle = () => { play([...armed].map(el => ({ el, instant: true }))); complete(); };
    on(window, 'beforeprint', settle);
    engine.jumpHooks.push(complete);

    // classify synchronously, before first paint. the first viewport arms for its load reveal (only if nothing has
    // painted yet, so it never flashes), anything below waits for the first scroll intent, anything above stays put
    let alive = true;
    const vh = innerHeight, first = [];
    const painted = (performance.getEntriesByType?.('paint') || []).length > 0;
    for (const el of els) {
      if (seen.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.top >= vh) { pending.add(el); continue; }
      seen.add(el);
      if (!painted && !intended && r.top < vh * .92 && r.bottom > 0) first.push(el);
    }
    first.forEach(el => { el._mkLoad = true; arm(el); });
    // release the first viewport once its fonts are in, so line breaks are final (capped at 800ms)
    const fonts = document.fonts ? Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 800))]) : Promise.resolve();
    fonts.then(() => { if (alive) watch(first.filter(el => armed.has(el))); });
    engine.onIntent(() => {
      if (!alive) return;
      const h = innerHeight, below = [];
      for (const el of pending) {
        if (el.getBoundingClientRect().top > h) below.push(el);
        seen.add(el);
      }
      pending.clear();
      below.forEach(arm);
      watch(below);
    });

    return {
      settle,
      destroy() {
        alive = false;
        stops.forEach(s => s());
        for (const [el, anims] of [...running]) { anims.forEach(a => a.cancel()); finish(el); }
        for (const el of [...armed]) finish(el);
        armed.clear(); pending.clear();
        html.classList.remove('mk-io');
      },
    };
  }

  /* ---------- press: a spring down to .97 and a livelier spring back (opacity under reduced motion) ----------
     pointer and Enter/Space start it; the kit's own listeners (not Motion's press(), whose focus listener cannot
     be removed) keep destroy() clean */
  function makePress(on, signal) {
    const els = all('[data-mk-press]');
    if (!M || !els.length) return null;
    html.classList.add('mk-press-on');
    const go = (el, prop, to, opts, clean) => {
      const box = el._mkGo ||= {};
      box[prop]?.stop();
      const cs = getComputedStyle(el), from = prop === 'opacity' ? numOf(cs.opacity) : numOf(cs.scale);
      const a = M.animateMini(el, { [prop]: [from, to] }, opts);
      box[prop] = a;
      a.finished.then(() => { if (box[prop] !== a) return; delete box[prop]; if (clean) el.style.removeProperty(prop); });
    };
    const down = el => {
      if (el._mkDown) return;
      el._mkDown = true;
      calm() ? go(el, 'opacity', .82, { duration: .1 }) : go(el, 'scale', .97, wapi(SPRING.press));
    };
    const up = el => {
      if (!el._mkDown) return;
      el._mkDown = false;
      calm() ? go(el, 'opacity', 1, { duration: .18 }, true) : go(el, 'scale', 1, wapi(tuned(el, SPRING.release)), true);
    };
    for (const el of els) {
      on(el, 'pointerdown', e => {
        if (!e.isPrimary || e.button !== 0) return;
        down(el);
        const once = new AbortController(), end = () => { once.abort(); up(el); };
        const opts = { capture: true, signal: AbortSignal.any([once.signal, signal]) };
        window.addEventListener('pointerup', end, opts);
        window.addEventListener('pointercancel', end, opts);
      });
      on(el, 'keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) down(el); });
      on(el, 'keyup', e => { if (e.key === 'Enter' || e.key === ' ') up(el); });
      on(el, 'blur', () => up(el));
    }
    return {
      destroy() {
        els.forEach(el => { el._mkDown = false; Object.values(el._mkGo || {}).forEach(a => a.cancel()); el._mkGo = null; el.style.removeProperty('scale'); el.style.removeProperty('opacity'); });
        html.classList.remove('mk-press-on');
      },
    };
  }

  /* ---------- hover lift for cards and buttons: fine pointers, also on keyboard focus ---------- */
  function makeLift(on) {
    const els = all('[data-mk-lift]');
    if (!M || !els.length || !desk()) return null;
    html.classList.add('mk-lift-on');
    const live = new Map();
    const to = (el, y) => {
      const a = M.animate(el, { translate: `0px ${y}px` }, js(tuned(el, SPRING.lift)));
      live.set(el, a);
      if (!y) a.finished.then(() => { if (live.get(el) === a) { live.delete(el); el.style.removeProperty('translate'); } });
    };
    const up = el => to(el, -(parseFloat(el.getAttribute('data-mk-lift')) || 4));
    const focused = el => el.matches(':focus-visible, :has(:focus-visible)');
    const stops = els.map(el => M.hover(el, () => { up(el); return () => { if (!focused(el)) to(el, 0); }; }));
    els.forEach(el => {
      on(el, 'focusin', () => { if (focused(el)) up(el); });
      on(el, 'focusout', e => { if (!el.contains(e.relatedTarget) && !el.matches(':hover')) to(el, 0); });
    });
    return {
      destroy() {
        stops.forEach(s => s());
        live.forEach(a => a.stop()); live.clear();
        els.forEach(el => el.style.removeProperty('translate'));
        html.classList.remove('mk-lift-on');
      },
    };
  }

  /* ---------- magnetic buttons: a quick spring toward the cursor, a softer one home (mouse only) ---------- */
  function makeMagnet(on) {
    if (!M || !desk()) return null;
    const list = all('[data-mk-magnet]').map(el => ({ el, k: parseFloat(el.getAttribute('data-mk-magnet')) || .3, rect: null, raf: 0, px: 0, py: 0, anim: null }));
    if (!list.length) return null;
    const pull = m => {
      m.raf = 0;
      m.rect ||= m.el.getBoundingClientRect();
      const r = m.rect, lim = Math.min(12, r.height * .25);
      const dx = clamp((m.px - (r.left + r.width / 2)) * m.k, -lim, lim), dy = clamp((m.py - (r.top + r.height / 2)) * m.k, -lim, lim);
      m.anim = M.animate(m.el, { translate: `${dx.toFixed(2)}px ${dy.toFixed(2)}px` }, js(SPRING.magnet));
    };
    const home = m => {
      cancelAnimationFrame(m.raf); m.raf = 0;
      m.el.classList.remove('mk-near');
      const a = m.anim = M.animate(m.el, { translate: '0px 0px' }, js(tuned(m.el, SPRING.home)));
      a.finished.then(() => { if (m.anim === a) { m.anim = null; m.el.style.removeProperty('translate'); } });
    };
    list.forEach(m => {
      // rect is read with the current pull included, so it is measured once per visit, not per move
      on(m.el, 'pointerenter', e => { if (e.pointerType !== 'mouse') return; m.rect = null; m.el.classList.add('mk-near'); });
      on(m.el, 'pointermove', e => { if (e.pointerType !== 'mouse') return; m.px = e.clientX; m.py = e.clientY; if (!m.raf) m.raf = requestAnimationFrame(() => pull(m)); });
      on(m.el, 'pointerleave', () => home(m));
    });
    on(window, 'scroll', () => list.forEach(m => { m.rect = null; }), { passive: true });
    return { destroy() { list.forEach(m => { cancelAnimationFrame(m.raf); m.anim?.stop(); m.anim = null; m.el.classList.remove('mk-near'); m.el.style.removeProperty('translate'); }); } };
  }

  /* ---------- indicator: one element that springs between the active options of its parent (layout-style flip) ----------
     the indicator keeps a fixed 100x100 layout box and is drawn with transform only; its corner radius is
     counter-scaled every frame so a pill stays a pill while it stretches between options of different widths */
  const ACTIVE = '[aria-selected="true"], [aria-current]:not([aria-current="false"]), [aria-pressed="true"], [aria-checked="true"], :has(> input:checked)';
  function makeIndicators(on) {
    const list = all('[data-mk-indicator]').map(ind => ({ ind, host: ind.parentElement, st: null, anim: null, raf: 0, radius: null }));
    if (!list.length) return null;
    const draw = it => {
      if (!it.st) return;
      const s = it.st, sx = Math.max(.001, s.w / 100), sy = Math.max(.001, s.h / 100);
      it.radius ??= parseFloat(getComputedStyle(it.ind).getPropertyValue('--mk-radius')) || 999;
      const r = Math.min(it.radius, s.w / 2, s.h / 2);
      it.ind.style.transform = `translate(${s.x.toFixed(2)}px, ${s.y.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
      it.ind.style.borderRadius = `${(r / sx).toFixed(2)}px / ${(r / sy).toFixed(2)}px`;
    };
    const targetOf = it => {
      const a = [...it.host.querySelectorAll(ACTIVE)].find(e => e !== it.ind && !it.ind.contains(e) && e.getClientRects().length);
      if (!a) return null;
      const hr = it.host.getBoundingClientRect(), r = a.getBoundingClientRect();
      // --mk-inset: "y x" px drawn inside the option, so a slim pill can sit within a 44px target
      it.inset ??= pair(getComputedStyle(it.ind).getPropertyValue('--mk-inset'), [0, NaN]);
      const iy = it.inset[0], ix = Number.isFinite(it.inset[1]) ? it.inset[1] : iy;
      return { x: r.left - hr.left - it.host.clientLeft + it.host.scrollLeft + ix, y: r.top - hr.top - it.host.clientTop + it.host.scrollTop + iy, w: Math.max(0, r.width - 2 * ix), h: Math.max(0, r.height - 2 * iy) };
    };
    const update = (it, slide) => {
      it.raf = 0;
      const to = targetOf(it);
      if (!to) { it.anim?.stop(); it.anim = null; it.st = null; it.ind.classList.remove('mk-placed'); return; }
      const shown = it.ind.classList.contains('mk-placed');
      if (!slide || !shown || !it.st || !M || calm() || html.classList.contains('mk-instant')) {
        it.anim?.stop(); it.anim = null;
        it.st = { ...to };
        draw(it);
        it.ind.classList.add('mk-placed');
        return;
      }
      it.draw ||= () => draw(it);
      it.anim = M.animate(it.st, to, js(tuned(it.ind, SPRING.ui), { onUpdate: () => M.frame.render(it.draw) }));
    };
    const schedule = it => { if (!it.raf) it.raf = requestAnimationFrame(() => update(it, true)); };
    const mos = [], ros = [];
    for (const it of list) {
      const mo = new MutationObserver(() => schedule(it));
      mo.observe(it.host, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current', 'aria-pressed', 'aria-checked'] });
      mos.push(mo);
      on(it.host, 'change', () => schedule(it));
      const ro = new ResizeObserver(() => update(it, false));
      ro.observe(it.host);
      ros.push(ro);
    }
    document.fonts?.ready.then(() => { if (S) list.forEach(it => update(it, false)); });
    return {
      destroy() {
        mos.forEach(o => o.disconnect()); ros.forEach(o => o.disconnect());
        list.forEach(it => { cancelAnimationFrame(it.raf); it.anim?.stop(); it.ind.classList.remove('mk-placed'); it.ind.style.removeProperty('transform'); it.ind.style.removeProperty('border-radius'); });
      },
    };
  }

  /* ---------- tabs: roving focus, arrow keys, one panel shown, the incoming panel springs in ---------- */
  function makeTabs(on) {
    const roots = all('[data-mk-tabs]');
    if (!roots.length) return null;
    const managed = new Set(), live = new Map();
    for (const root of roots) {
      const tabs = all('[role="tab"]', root);
      if (!tabs.length) continue;
      const panelOf = t => document.getElementById(t.getAttribute('aria-controls') || '');
      let cur = tabs.find(t => t.getAttribute('aria-selected') === 'true') || tabs[0];
      const sync = () => tabs.forEach(t => {
        const sel = t === cur, p = panelOf(t);
        t.setAttribute('aria-selected', String(sel));
        t.tabIndex = sel ? 0 : -1;
        if (p) { managed.add(p); p.hidden = !sel; }
      });
      sync();
      const select = (t, focus) => {
        if (focus) t.focus();
        if (t === cur) return;
        cur = t;
        sync();
        const p = panelOf(t);
        if (!p || !M) return;
        live.get(p)?.cancel();
        const a = calm()
          ? M.animateMini(p, { opacity: [0, 1] }, { duration: .16 })
          : M.animateMini(p, { opacity: [0, 1], translate: ['0 10px', '0 0'] }, wapi(tuned(root, SPRING.panel)));
        live.set(p, a);
        a.finished.then(() => { if (live.get(p) === a) { live.delete(p); p.style.removeProperty('opacity'); p.style.removeProperty('translate'); } });
      };
      tabs.forEach(t => on(t, 'click', () => select(t, false)));
      on(root, 'keydown', e => {
        const i = tabs.indexOf(e.target);
        if (i < 0) return;
        const n = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (n === undefined) return;
        e.preventDefault();
        select(tabs[(n + tabs.length) % tabs.length], true);
      });
    }
    return {
      destroy() {
        live.forEach(a => a.cancel()); live.clear();
        managed.forEach(p => { p.hidden = false; p.style.removeProperty('opacity'); p.style.removeProperty('translate'); });
      },
    };
  }

  /* ---------- accordion: native details; the height springs open and shut (instant under reduced motion) ---------- */
  function makeAccordion(on) {
    const list = all('details[data-mk-accordion]');
    if (!M || !list.length) return null;
    const anims = new Map();
    const summaryOf = d => d.querySelector(':scope > summary');
    const closedHeight = d => {
      const cs = getComputedStyle(d), s = summaryOf(d), ss = getComputedStyle(s);
      const edge = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((a, k) => a + (parseFloat(cs[k]) || 0), 0);
      return s.getBoundingClientRect().height + edge + (parseFloat(ss.marginTop) || 0) + (parseFloat(ss.marginBottom) || 0);
    };
    const clean = d => {
      ['height', 'overflow', 'box-sizing'].forEach(p => d.style.removeProperty(p));
      d._mkClosing = false;
      d.removeAttribute('data-mk-closing');
      if (d._mkName) { d.setAttribute('name', d._mkName); d._mkName = null; }
    };
    const run = (d, opening) => {
      const startH = d.getBoundingClientRect().height;
      anims.get(d)?.stop();
      if (opening && d.name) {
        // exclusive groups: shut the open sibling with a spring too, instead of letting the browser snap it
        for (const x of all(`details[name="${CSS.escape(d.name)}"]`)) {
          if (x === d || !x.open || x._mkClosing || !x.hasAttribute('data-mk-accordion')) continue;
          x._mkName = x.getAttribute('name');
          x.removeAttribute('name');
          run(x, false);
        }
      }
      Object.assign(d.style, { boxSizing: 'border-box', overflow: 'clip' });
      let endH;
      if (opening) { d.style.height = 'auto'; d.open = true; endH = d.getBoundingClientRect().height; }
      else endH = closedHeight(d);
      d.style.height = startH + 'px';
      d._mkClosing = !opening;
      // [open] stays on while it shuts, so style an icon with details[open]:not([data-mk-closing])
      d.toggleAttribute('data-mk-closing', !opening);
      const a = M.animate(d, { height: [startH + 'px', endH + 'px'] }, js(tuned(d, SPRING.height)));
      anims.set(d, a);
      a.finished.then(() => {
        if (anims.get(d) !== a) return;
        anims.delete(d);
        if (!opening) d.open = false;
        clean(d);
      });
    };
    for (const d of list) {
      const s = summaryOf(d);
      if (!s) continue;
      on(s, 'click', e => {
        if (calm()) return;
        e.preventDefault();
        run(d, !d.open || d._mkClosing);
      });
    }
    return {
      destroy() {
        anims.forEach((a, d) => { a.stop(); if (d._mkClosing) d.open = false; clean(d); });
        anims.clear();
      },
    };
  }

  /* ---------- switch: role=switch button, the thumb springs to its new place; controlled numbers spring too ---------- */
  function makeSwitch(on) {
    const list = all('[data-mk-switch]');
    if (!list.length) return null;
    const thumbs = [];
    for (const b of list) {
      const thumb = b.querySelector('[data-mk-thumb]');
      const box = b.getAttribute('aria-controls') ? document.getElementById(b.getAttribute('aria-controls')) : null;
      const nums = box ? all('[data-mk-alt]', box) : [];
      nums.forEach(n => { if (!origText.has(n)) origText.set(n, n.textContent.trim()); });
      if (thumb) thumbs.push(thumb);
      on(b, 'click', () => {
        const next = b.getAttribute('aria-checked') !== 'true';
        const before = thumb?.getBoundingClientRect();
        thumb?._mkAnim?.cancel();
        b.setAttribute('aria-checked', String(next));
        if (thumb && M && !calm()) {
          const after = thumb.getBoundingClientRect(), dx = before.left - after.left, dy = before.top - after.top;
          if (Math.abs(dx) + Math.abs(dy) > .5) {
            const a = thumb._mkAnim = M.animateMini(thumb, { transform: [`translate(${dx}px, ${dy}px)`, 'translate(0px, 0px)'] }, wapi(tuned(b, SPRING.thumb)));
            a.finished.then(() => { if (thumb._mkAnim === a) { thumb._mkAnim = null; thumb.style.removeProperty('transform'); } });
          }
        }
        nums.forEach(n => setNumber(n, next ? n.getAttribute('data-mk-alt') : origText.get(n)));
      });
    }
    return { destroy() { thumbs.forEach(t => { t._mkAnim?.cancel(); t._mkAnim = null; t.style.removeProperty('transform'); }); } };
  }

  /* ---------- scroll-linked through Motion scroll(): image parallax, reading progress, in-flow scenes ----------
     every callback takes two arguments, which keeps Motion on its event-driven scroll tracking: no frame loop
     while the page is still, and no scroll-timeline animations left "running" for a capture to freeze */
  function makeParallax() {
    if (!M || !desk()) return null;
    const list = all('[data-mk-parallax]').map(el => ({ el, k: clamp(parseFloat(el.getAttribute('data-mk-parallax')) || .1, -.3, .3), frame: el.parentElement, last: NaN }));
    if (!list.length) return null;
    const stops = [];
    for (const p of list) {
      p.el.style.setProperty('--mk-k', String(Math.abs(p.k)));
      p.el.classList.add('mk-on');
      // the oversized image is taken out of flow; a frame without its own height would collapse, so leave it alone
      if (p.frame.clientHeight < 2) { p.el.classList.remove('mk-on'); p.el.style.removeProperty('--mk-k'); continue; }
      p.live = true;
      stops.push(M.scroll((v, info) => {
        const t = Math.round((v - .5) * p.k * info.y.targetLength * 100) / 100;
        if (t !== p.last) { p.last = t; p.el.style.translate = `0 ${t}px`; }
      }, { target: p.frame, offset: ['start end', 'end start'] }));
    }
    return { destroy() { stops.forEach(s => s()); list.forEach(p => { p.el.classList.remove('mk-on'); p.el.style.removeProperty('--mk-k'); p.el.style.removeProperty('translate'); }); } };
  }

  function makeProgress() {
    const list = all('[data-mk-progress]');
    if (!M || !list.length) return null;
    const stops = list.map(el => {
      const sel = el.getAttribute('data-mk-progress'), target = sel ? document.querySelector(sel) : null;
      return M.scroll((v, info) => {
        const s = Math.round(v * 1000) / 1000;
        if (s !== el._mkP) { el._mkP = s; el.style.scale = `${s} 1`; }
      }, target ? { target, offset: ['start start', 'end end'] } : {});
    });
    return { destroy() { stops.forEach(s => s()); list.forEach(el => { el._mkP = null; el.style.removeProperty('scale'); }); } };
  }

  function makeScene() {
    const list = all('[data-mk-scene]').map(el => {
      const items = all('[data-mk-scene-step]', el);
      return { el, items, n: parseInt(el.getAttribute('data-mk-steps'), 10) || items.length || 1, step: -1, ps: all('[data-mk-scene-p]', el), lastP: NaN };
    });
    if (!M || !list.length) return null;
    const setStep = (s, step) => {
      if (step === s.step) return;
      s.step = step;
      s.el.setAttribute('data-mk-step', String(step));
      s.items.forEach((it, i) => i === step ? it.setAttribute('aria-current', 'step') : it.removeAttribute('aria-current'));
    };
    const stops = list.map(s => {
      setStep(s, 0);
      // progress runs across the steps themselves, so equal-height steps switch as each reaches the reading line
      const target = s.items[0]?.parentElement || s.el;
      return M.scroll((v, info) => {
        setStep(s, Math.min(s.n - 1, Math.floor(v * s.n)));
        if (!s.ps.length || !desk()) return;
        const p = Math.round(v * 10000) / 10000;
        if (p !== s.lastP) { s.lastP = p; s.ps.forEach(e => e.style.setProperty('--mk-p', String(p))); }
      }, { target, offset: ['start 55%', 'end 55%'] });
    });
    return {
      destroy() {
        stops.forEach(f => f());
        list.forEach(s => { s.el.removeAttribute('data-mk-step'); s.items.forEach(it => it.removeAttribute('aria-current')); s.ps.forEach(e => e.style.removeProperty('--mk-p')); });
      },
    };
  }

  /* ---------- depth: layers sit exactly where placed until their section's top reaches the anchor line
     (default: middle of the viewport), then drift k px per scrolled px. negative k lags behind. ---------- */
  function makeDepth(engine) {
    if (!desk()) return;
    const layers = all('[data-mk-depth]').map(el => ({
      el, k: parseFloat(el.getAttribute('data-mk-depth')) || 0, anchor: clamp(parseFloat(el.getAttribute('data-mk-anchor') ?? '.5')),
      track: trackOf(el), last: Infinity, g: null,
    }));
    if (!layers.length) return;
    engine.items.push({
      measure() { for (const L of layers) L.g = geom(L.track); },
      update(y, vh) {
        for (const L of layers) {
          if (!L.g) continue;
          const start = Math.max(0, L.g.top - vh * L.anchor), end = L.g.top + L.g.h;
          const d = -L.k * (clamp(y, start, end) - start);
          if (Math.abs(d - L.last) > .05) { L.last = d; L.el.style.translate = `0 ${d.toFixed(2)}px`; }
        }
      },
      reset() { layers.forEach(L => L.el.style.removeProperty('translate')); },
    });
  }

  /* ---------- scrub: writes --mk-p (0 to 1) on the element itself for any css you like ---------- */
  function makeScrub(engine) {
    if (!desk()) return;
    const list = all('[data-mk-scrub]').map(el => {
      const kind = el.getAttribute('data-mk-scrub') || 'cover';
      return { el, kind, track: trackOf(el), last: Infinity, g: null };
    }).filter(s => s.kind !== 'pin');
    if (!list.length) return;
    engine.items.push({
      measure() { for (const s of list) s.g = geom(s.track); },
      update(y, vh) {
        for (const s of list) {
          if (!s.g) continue;
          const [a, b] = rangeOf(s.kind, s.g, vh), p = clamp((y - a) / (b - a));
          if (Math.abs(p - s.last) > .0005) { s.last = p; s.el.style.setProperty('--mk-p', p.toFixed(4)); }
        }
      },
      reset() { list.forEach(s => s.el.style.removeProperty('--mk-p')); },
    });
  }

  /* ---------- theme shift and view-based nav state ---------- */
  function makeTheme(engine) {
    const secs = all('[data-mk-theme]').map(el => ({ el, name: el.getAttribute('data-mk-theme'), g: null }));
    const nav = document.querySelector('[data-mk-nav]');
    const links = nav ? all('a[href^="#"]', nav).map(a => ({ a, el: a.hash.length > 1 ? document.getElementById(decodeURIComponent(a.hash.slice(1))) : null, g: null })).filter(l => l.el) : [];
    if (!secs.length && !nav) return;
    let theme = null, under = null, active = null, scrolled = null, navH = 0;
    const themeAt = y => { for (const s of secs) if (s.g && y >= s.g.top && y < s.g.top + s.g.h) return s.name; return ''; };
    engine.items.push({
      measure() { secs.forEach(s => { s.g = geom(s.el); }); links.forEach(l => { l.g = geom(l.el); }); navH = nav ? nav.offsetHeight : 0; },
      update(y, vh) {
        const t = themeAt(y + vh / 2);
        if (t !== theme) { theme = t; t ? html.setAttribute('data-mk-theme-active', t) : html.removeAttribute('data-mk-theme-active'); }
        if (!nav) return;
        const u = themeAt(y + navH / 2);
        if (u !== under) { under = u; u ? nav.setAttribute('data-mk-on', u) : nav.removeAttribute('data-mk-on'); }
        const sc = y > 4;
        if (sc !== scrolled) { scrolled = sc; nav.toggleAttribute('data-mk-scrolled', sc); }
        const line = y + vh * .4;
        let next = null;
        for (const l of links) if (l.g && line >= l.g.top && line < l.g.top + l.g.h) next = l;
        if (next !== active) {
          active?.a.removeAttribute('aria-current');
          next?.a.setAttribute('aria-current', 'true');
          active = next;
        }
      },
    });
  }

  /* ---------- marquee: seamless loop, pause button, paused offscreen, static under reduced motion ---------- */
  function makeMarquee(on) {
    const list = all('[data-mk-marquee]').map(el => ({ el, track: el.querySelector('[data-mk-marquee-track]'), clones: [] })).filter(m => m.track?.firstElementChild);
    const toggles = all('[data-mk-marquee-toggle]');
    if (!list.length) return null;
    if (calm()) { toggles.forEach(b => { b.hidden = true; }); return { destroy() { toggles.forEach(b => { b.hidden = false; }); } }; }
    const fit = m => {
      const group = m.track.firstElementChild, gap = parseFloat(getComputedStyle(m.track).columnGap) || 0;
      const period = group.offsetWidth + gap, need = Math.max(1, Math.ceil(m.el.clientWidth / Math.max(1, period)));
      while (m.clones.length < need) {
        const c = group.cloneNode(true);
        c.setAttribute('aria-hidden', 'true');
        c.setAttribute('data-mk-clone', '');
        c.inert = true;
        m.track.append(c);
        m.clones.push(c);
      }
      const speed = parseFloat(m.el.getAttribute('data-mk-marquee')) || 40;
      m.track.style.setProperty('--mk-marquee-shift', `${-period}px`);
      m.track.style.setProperty('--mk-marquee-dur', `${(period / speed).toFixed(2)}s`);
    };
    const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('mk-offscreen', !e.isIntersecting))) : null;
    list.forEach(m => { fit(m); m.el.classList.add('mk-on'); io?.observe(m.el); });
    // refit when the group or window changes size (late font swaps change the loop period)
    const ro = new ResizeObserver(() => requestAnimationFrame(() => list.forEach(fit)));
    list.forEach(m => ro.observe(m.track.firstElementChild));
    on(window, 'resize', () => list.forEach(fit));
    const label = (b, paused) => {
      b.setAttribute('data-mk-state', paused ? 'paused' : 'playing');
      const slot = b.querySelector('[data-mk-label]') || b;
      slot.textContent = paused ? (b.getAttribute('data-mk-play') || 'Play') : (b.getAttribute('data-mk-pause') || 'Pause');
    };
    toggles.forEach(b => {
      const m = list.find(x => x.el.id && x.el.id === b.getAttribute('aria-controls'));
      if (!m) return;
      label(b, m.el.hasAttribute('data-mk-paused'));
      on(b, 'click', () => { const p = !m.el.hasAttribute('data-mk-paused'); m.el.toggleAttribute('data-mk-paused', p); label(b, p); });
    });
    return {
      destroy() {
        io?.disconnect();
        ro.disconnect();
        list.forEach(m => { m.clones.forEach(c => c.remove()); m.clones = []; m.el.classList.remove('mk-on', 'mk-offscreen'); m.track.style.removeProperty('--mk-marquee-shift'); m.track.style.removeProperty('--mk-marquee-dur'); });
      },
    };
  }

  /* ---------- hover preview following the cursor (fine pointers only) ---------- */
  function makePreview(on) {
    const host = document.querySelector('[data-mk-preview-host]');
    const items = all('[data-mk-preview]');
    if (!host || !items.length || !mq.fine.matches) return null;
    if (host.parentElement !== document.body) document.body.append(host);
    const imgs = [...host.querySelectorAll('img')];
    const follow = !calm();
    let x = 0, y = 0, tx = 0, ty = 0, raf = 0, visible = false, last = 0, W = 0, H = 0;
    const place = () => { host.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`; };
    const aim = (cx, cy) => {
      tx = clamp(cx + 28, 8, innerWidth - W - 8);
      ty = clamp(cy - H / 2, 8, innerHeight - H - 8);
    };
    const loop = now => {
      raf = 0;
      const dt = last ? Math.min(.064, (now - last) / 1000) : 1 / 60;
      last = now;
      const a = 1 - Math.exp(-14 * dt);
      x += (tx - x) * a; y += (ty - y) * a;
      place();
      if (Math.abs(tx - x) > .3 || Math.abs(ty - y) > .3) raf = requestAnimationFrame(loop);
    };
    const kick = () => { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } };
    const show = (i, cx, cy, snap) => {
      imgs.forEach((im, n) => im.classList.toggle('is-active', n === i));
      if (!visible) { W = host.offsetWidth; H = host.offsetHeight; }
      aim(cx, cy);
      if (!visible || snap || !follow) { x = tx; y = ty; place(); }
      visible = true;
      host.classList.add('is-on');
      if (follow) kick();
    };
    const hide = () => { visible = false; host.classList.remove('is-on'); };
    items.forEach(it => {
      const i = parseInt(it.getAttribute('data-mk-preview'), 10) || 0;
      const mouse = e => e.pointerType === 'mouse' || e.pointerType === 'pen';
      // rows scrolling under a resting cursor fire enter/leave too, so the picture simply follows the row under it
      on(it, 'pointerenter', e => { if (mouse(e)) show(i, e.clientX, e.clientY, false); });
      on(it, 'pointermove', e => { if (!mouse(e)) return; if (!visible) show(i, e.clientX, e.clientY, false); else if (follow) { aim(e.clientX, e.clientY); kick(); } });
      on(it, 'pointerleave', hide);
      on(it, 'focus', () => { if (!it.matches(':focus-visible')) return; const r = it.getBoundingClientRect(); show(i, Math.min(r.right, innerWidth * .6), r.top + r.height / 2, true); });
      on(it, 'blur', hide);
    });
    return { destroy() { cancelAnimationFrame(raf); hide(); host.style.removeProperty('translate'); } };
  }

  /* ---------- lifecycle ---------- */
  const resolveMotion = () => {
    const m = window.Motion;
    return m && ['animate', 'animateMini', 'inView', 'scroll', 'press', 'hover', 'spring', 'frame'].every(k => m[k]) ? m : null;
  };
  function init() {
    if (S) return;
    const ac = new AbortController();
    const on = (t, type, fn, opts = {}) => t.addEventListener(type, fn, { ...opts, signal: ac.signal });
    S = { ac, parts: [] };
    M = resolveMotion();
    if (!M && !warned) { warned = true; console.warn('motion kit v2: window.Motion not found, so springs, gestures and scroll recipes are off (content stays complete). paste motion.min.js before the kit.'); }
    try {
      const engine = makeEngine(on);
      S.engine = engine;
      S.smooth = makeSmooth(on, engine);
      makeAnchors(on);
      S.reveal = makeReveal(on, engine);
      S.parts.push(S.reveal);
      S.parts.push(makeTabs(on), makeIndicators(on), makeAccordion(on), makeSwitch(on));
      S.parts.push(makePress(on, ac.signal), makeLift(on), makeMagnet(on), makeMarquee(on), makePreview(on));
      S.parts.push(makeParallax(), makeProgress(), makeScene());
      makeDepth(engine); makeScrub(engine); makeTheme(engine);
      for (const q of Object.values(mq)) on(q, 'change', refresh);
      html.classList.add('mk-ready');
      if (M) html.classList.add('mk-motion');
      engine.measure();
    } catch (err) {
      // a broken kit must never leave content hidden
      console.warn('motion kit stopped:', err);
      destroy();
      all('.mk-armed').forEach(el => el.classList.remove('mk-armed'));
    }
  }
  function destroy() {
    if (!S) return;
    S.ac.abort();
    S.smooth?.destroy();
    S.parts.forEach(p => p?.destroy());
    S.engine?.destroy();
    html.classList.remove('mk-ready', 'mk-io', 'mk-motion');
    view.lastY = null;
    S = null;
  }
  function refresh() { destroy(); init(); }
  function scrollTo(dest, opts = {}) {
    const el = typeof dest === 'string' ? document.querySelector(dest) : dest instanceof Element ? dest : null;
    const y = el ? destY(el) : Number(dest) || 0;
    if (S?.smooth) return S.smooth.go(y, opts);
    window.scrollTo({ top: y, behavior: calm() ? 'auto' : 'smooth' });
  }
  window.MK = { version: 2, init, destroy, refresh, scrollTo, count: (el, text) => setNumber(el, String(text)), settle: () => S?.reveal?.settle(), measure: () => S?.engine?.requestMeasure() };
  init();
})();
