// marks the page as scripted before first paint, so start states never flash
document.documentElement.classList.add('js');

(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  // a pill that slides to the active button. it is a full-size layer cut down with clip-path, so nothing but paint moves
  function indicator(group, active) {
    const ind = $('[data-ind]', group);
    const place = (animate) => {
      const b = active();
      if (!ind || !b) return;
      const cut = `inset(${b.offsetTop}px ${group.clientWidth - b.offsetLeft - b.offsetWidth}px ${group.clientHeight - b.offsetTop - b.offsetHeight}px ${b.offsetLeft}px round 999px)`;
      if (animate) { ind.style.clipPath = cut; return; }
      ind.style.transition = 'none'; ind.style.clipPath = cut; void ind.offsetWidth; ind.style.transition = '';
    };
    place(false);
    new ResizeObserver(() => place(false)).observe(group);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => place(false));
    return place;
  }

  // a number that settles on its new value like a weight on a spring
  function settle(el, to) {
    const s = el._spring || (el._spring = { v: Number(el.textContent) || 0, vel: 0, raf: 0 });
    s.to = to;
    if (reduce.matches) { s.v = to; el.textContent = to; return; }
    if (s.raf) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(0.032, (now - last) / 1000); last = now;
      s.vel += (170 * (s.to - s.v) - 24 * s.vel) * dt;
      s.v += s.vel * dt;
      if (Math.abs(s.to - s.v) < 0.4 && Math.abs(s.vel) < 2) { s.v = s.to; s.vel = 0; s.raf = 0; el.textContent = s.to; return; }
      el.textContent = Math.max(0, Math.round(s.v));
      s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  }

  function hero() {
    const stage = $('[data-stage]');
    if (stage) requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.add('in')));
  }

  // the still stays until someone asks for the live app
  function demo() {
    const fig = $('[data-demo]');
    if (!fig) return;
    const btn = $('[data-try]', fig), label = $('[data-try-label]', fig), frame = $('[data-frame]', fig);
    let iframe = null, state = 'still';
    const show = (next) => {
      state = next;
      const note = next === 'loading' ? 'still' : next;
      $$('[data-note]', fig).forEach((n) => { n.hidden = n.dataset.note !== note; });
      btn.setAttribute('aria-pressed', String(next === 'live'));
      if (next === 'loading') btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy');
      label.textContent = next === 'live' ? 'back to the picture' : next === 'loading' ? 'loading' : 'try it live';
    };
    const fit = () => { if (iframe) iframe.style.transform = `scale(${frame.clientWidth / 1180})`; };
    new ResizeObserver(fit).observe(frame);
    btn.addEventListener('click', async () => {
      if (state === 'loading') return;
      if (state === 'live') { iframe.classList.remove('on'); show('still'); return; }
      if (iframe) { iframe.classList.add('on'); show('live'); return; }
      show('loading');
      let there = true;
      try { there = (await fetch('/demo/', { credentials: 'same-origin' })).ok; } catch (e) { there = true; }
      if (!there) { show('missing'); return; }
      iframe = document.createElement('iframe');
      iframe.title = 'the dusk bot app, running on sample data';
      iframe.width = 1180; iframe.height = 680;
      iframe.addEventListener('load', () => { iframe.classList.add('on'); show('live'); }, { once: true });
      iframe.src = '/demo/';
      frame.appendChild(iframe);
      fit();
    });
  }

  function jobs() {
    const root = $('[data-jobs]');
    if (!root) return;
    const list = $('[role="tablist"]', root), tabs = $$('[role="tab"]', list);
    const place = indicator(list, () => tabs.find((t) => t.getAttribute('aria-selected') === 'true'));
    const select = (tab, animate, focus) => {
      tabs.forEach((t) => {
        const on = t === tab, id = t.id.slice(3);
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        $('#jp-' + id, root).classList.toggle('on', on);
        $(`[data-line="${id}"]`, root).classList.toggle('on', on);
      });
      place(animate);
      if (focus) tab.focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(t, true));
      t.addEventListener('keydown', (e) => {
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        select(tabs[(i + d + tabs.length) % tabs.length], true, true);
      });
    });
    select(tabs[0], false);
  }

  // a row of buttons where exactly one is pressed
  function segment(group, onPick) {
    const buttons = $$('button', group);
    const place = indicator(group, () => buttons.find((b) => b.getAttribute('aria-pressed') === 'true'));
    buttons.forEach((b) => b.addEventListener('click', () => {
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      place(true);
      onPick(b);
    }));
  }

  function cost() {
    const root = $('[data-cost]');
    if (!root) return;
    const total = $('[data-total]', root), val = $('[data-val]', root), fill = $('[data-fill]', root), sub = $('[data-sub]', root), cap = $('[data-cap]', root);
    segment($('[data-seg]', root), (b) => {
      const price = Number(b.dataset.price);
      settle(total, price); settle(val, price);
      fill.style.transform = `scaleX(${Math.max(0.006, price / 50)})`;
      sub.textContent = b.dataset.sub; cap.textContent = b.dataset.cap;
    });
  }

  function pricing() {
    const root = $('[data-pricing]');
    if (!root) return;
    segment($('[data-seg]', root), (b) => {
      const key = b.dataset.bill === 'year' ? 'y' : 'm';
      $$('.amt [data-m]', root).forEach((n) => settle(n, Number(n.dataset[key])));
      $$('[data-per]', root).forEach((n) => { n.textContent = n.dataset[key]; });
    });
  }

  // small demonstrations inside the snippets. each rests in its finished state and plays once when it scrolls into view
  function moveTo(ptr, el, dx = 0, dy = 0) {
    const box = ptr.offsetParent.getBoundingClientRect(), r = el.getBoundingClientRect();
    ptr.style.transform = `translate(${r.left - box.left + r.width / 2 - 4 + dx}px, ${r.top - box.top + r.height / 2 - 3 + dy}px)`;
  }
  const plays = {
    ask: {
      rest(fig) { moveTo($('[data-ptr]', fig), $('[data-yes]', fig), 14, 12); },
      pre(fig) {
        const ptr = $('[data-ptr]', fig);
        fig.classList.add('pre');
        ptr.style.transition = 'none'; ptr.style.opacity = '0'; moveTo(ptr, $('[data-no]', fig), 70, 96);
      },
      async run(fig) {
        const ptr = $('[data-ptr]', fig), yes = $('[data-yes]', fig);
        await wait(450);
        ptr.style.transition = 'transform 900ms cubic-bezier(0.77, 0, 0.175, 1), opacity 240ms ease';
        ptr.style.opacity = '1'; moveTo(ptr, yes, 6, 4);
        await wait(1000);
        yes.style.transform = 'scale(0.92)';
        await wait(150);
        yes.style.transform = '';
        fig.classList.remove('pre');
        await wait(520);
        ptr.style.transition = 'transform 700ms cubic-bezier(0.23, 1, 0.32, 1)';
        moveTo(ptr, yes, 14, 12);
      },
    },
    browse: {
      rest(fig) { moveTo($('[data-ptr]', fig), $('[data-row] em', fig), -26, 4); },
      pre(fig) {
        const ptr = $('[data-ptr]', fig), rows = $$('[data-row]', fig);
        rows.forEach((r) => r.classList.remove('hot'));
        ptr.style.transition = 'none'; ptr.style.opacity = '0'; moveTo(ptr, $('em', rows[2]), 10, 86);
      },
      async run(fig) {
        const ptr = $('[data-ptr]', fig), rows = $$('[data-row]', fig);
        const hot = (row) => rows.forEach((r) => r.classList.toggle('hot', r === row));
        await wait(350);
        ptr.style.transition = 'transform 620ms cubic-bezier(0.77, 0, 0.175, 1), opacity 240ms ease';
        ptr.style.opacity = '1';
        for (const row of [rows[2], rows[1], rows[0]]) {
          moveTo(ptr, $('em', row), -26, 4);
          await wait(430); hot(row); await wait(330);
        }
      },
    },
    routine: {
      pre(fig) { $('[data-toggle]', fig).classList.remove('on'); },
      async run(fig) { await wait(650); $('[data-toggle]', fig).classList.add('on'); },
    },
    note: {
      pre(fig) { const t = $('[data-type]', fig); t.dataset.text = t.textContent; t.textContent = ''; fig.classList.add('pre'); },
      async run(fig) {
        const t = $('[data-type]', fig), text = t.dataset.text;
        await wait(400);
        for (let i = 1; i <= text.length; i++) { t.textContent = text.slice(0, i); await wait(42); }
        await wait(260);
        fig.classList.remove('pre');
      },
    },
    wake: {
      pre(fig) { fig.classList.add('pre'); },
      async run(fig) { await wait(900); fig.classList.remove('pre'); },
    },
  };
  function play() {
    const figs = $$('[data-play]');
    if (reduce.matches || !('IntersectionObserver' in window)) return;
    const seen = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        seen.unobserve(e.target);
        plays[e.target.dataset.play].run(e.target);
      }
    }, { threshold: 0.55 });
    for (const fig of figs) {
      const p = plays[fig.dataset.play];
      if (fig.getBoundingClientRect().top < innerHeight * 0.9) { if (p.rest) p.rest(fig); continue; }
      p.pre(fig);
      seen.observe(fig);
    }
    // pointers are placed by measuring, so put resting ones back after a resize
    let t = 0;
    addEventListener('resize', () => {
      clearTimeout(t);
      t = setTimeout(() => figs.forEach((fig) => {
        const p = plays[fig.dataset.play], ptr = $('[data-ptr]', fig);
        if (!p.rest || !ptr || fig.classList.contains('pre') || ptr.style.opacity === '0') return;
        ptr.style.transition = 'none'; p.rest(fig);
      }), 160);
    });
  }

  // bots look at the pointer
  function eyes() {
    if (!fine.matches || reduce.matches) return;
    const bots = $$('.peek, .mate-face, [data-eyes] .bot').map((el) => ({ el, eyes: $('.eyes', el) }));
    let x = 0, y = 0, raf = 0;
    const tick = () => {
      raf = 0;
      for (const b of bots) {
        const r = b.el.getBoundingClientRect();
        if (r.bottom < -100 || r.top > innerHeight + 100) continue;
        const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 240) * 5.5;
        b.eyes.style.transform = `translate(${(dx / d * k).toFixed(2)}px, ${(dy / d * k).toFixed(2)}px)`;
      }
    };
    addEventListener('pointermove', (e) => { x = e.clientX; y = e.clientY; if (!raf) raf = requestAnimationFrame(tick); }, { passive: true });
  }

  function copy() {
    $$('[data-copy]').forEach((b) => {
      const label = $('[data-copy-label]', b);
      let t = 0;
      b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.dataset.copy); label.textContent = 'copied'; }
        catch (e) {
          const range = document.createRange(), sel = getSelection();
          range.selectNodeContents($('code', b.parentElement)); sel.removeAllRanges(); sel.addRange(range);
          label.textContent = 'selected';
        }
        clearTimeout(t);
        t = setTimeout(() => { label.textContent = 'copy'; }, 1800);
      });
    });
  }

  const start = () => { hero(); demo(); jobs(); cost(); pricing(); play(); eyes(); copy(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
