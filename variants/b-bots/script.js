(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hover = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hasIO = 'IntersectionObserver' in window;
  const root = document.documentElement;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const moving = !still && hasIO;
  if (moving) root.classList.add('motion');

  // runs fn once when el comes into view; elements already on screen at load run it straight away
  const onceSeen = (el, fn, opts = { threshold: 0.3 }) => {
    if (!el) return;
    if (!hasIO) return fn(el);
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect(); fn(el);
    }, opts);
    io.observe(el);
  };

  /* blocks arrive once */
  for (const el of $$('[data-reveal]')) {
    if (!moving || el.getBoundingClientRect().top < innerHeight) el.classList.add('in');
    else onceSeen(el, () => el.classList.add('in'), { threshold: 0.12 });
  }

  /* every bot looks at the pointer, or at whoever is talking */
  const bots = $$('.bot');
  let seen = new Set(bots), frame = 0, px = innerWidth / 2, py = innerHeight / 3, gaze = null;
  if (hasIO) {
    seen = new Set();
    const io = new IntersectionObserver((entries) => { for (const e of entries) e.isIntersecting ? seen.add(e.target) : seen.delete(e.target); });
    bots.forEach((b) => io.observe(b));
  }
  function look() {
    frame = 0;
    for (const b of seen) {
      const r = b.getBoundingClientRect();
      if (!r.width) continue;
      const g = gaze && gaze.set.has(b) ? gaze : null;
      const dx = (g ? g.x : px) - (r.left + r.width / 2), dy = (g ? g.y : py) - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, d / 240) * 5.5;
      b.querySelector('.eyes').style.transform = `translate(${(dx / d * reach).toFixed(2)}px, ${(dy / d * reach * 0.8).toFixed(2)}px)`;
    }
  }
  const glance = () => { frame ||= requestAnimationFrame(look); };
  if (!still) {
    addEventListener('pointermove', (e) => { px = e.clientX; py = e.clientY; glance(); }, { passive: true });
    bots.forEach((b) => b.style.setProperty('--blink', `${(-Math.random() * 5.6).toFixed(2)}s`));
  }
  // a set of bots turns to one spot for a moment
  function turnTo(set, target, ms = 2600) {
    if (still) return;
    const r = target.getBoundingClientRect();
    const mine = gaze = { set: new Set(set), x: r.left + r.width / 2, y: r.top + r.height / 2 };
    glance();
    setTimeout(() => { if (gaze === mine) { gaze = null; glance(); } }, ms);
  }

  function hop(b) {
    if (still || !b) return;
    b.classList.remove('hop'); void b.getBoundingClientRect(); b.classList.add('hop');
  }
  function pop(el) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }

  // a small bubble that floats over anything poked outside the hero
  function quip(el, text) {
    const r = el.getBoundingClientRect(), q = document.createElement('span');
    q.className = 'quip'; q.textContent = text;
    q.style.left = `${Math.min(Math.max(r.left + r.width / 2, 90), innerWidth - 90) + scrollX}px`;
    q.style.top = `${Math.max(r.top, 44) + scrollY}px`;
    document.body.append(q);
    setTimeout(() => q.classList.add('out'), 1500); setTimeout(() => q.remove(), 1800);
  }
  const quips = ['hi', 'busy', 'on it', 'five more minutes', 'ok ok', 'that tickles', 'did you need something?', 'working, promise', 'not the face', 'hire me', 'i was told there would be snacks'];
  const purrs = ['mrrp', 'zzz', 'five more minutes', 'still not a bot'];
  let said = 0;

  /* the hero: six bots, their status lines, and one message you can send */
  const team = $('#team');
  if (team) {
    const mates = Object.fromEntries($$('.mate', team).map((m) => [m.dataset.bot, m]));
    const teamBots = $$('.mate .bot', team);
    const live = $('#said'), form = $('#composer'), input = $('#msg');
    let turn = 0, busy = 0;

    function speak(name, text, typing = 0) {
      const m = mates[name], mine = ++busy;
      for (const b of $$('.bubble', team)) if (b.parentElement !== m) b.textContent = '';
      const bubble = $('.bubble', m);
      turnTo(teamBots.filter((b) => !m.contains(b)), $('.bot', m));
      hop($('.bot', m));
      const land = () => { if (mine !== busy) return; bubble.textContent = text; pop(bubble); live.textContent = `${name}: ${text}`; };
      if (!typing || still) return land();
      bubble.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>'; pop(bubble);
      setTimeout(land, typing);
    }

    const routes = [
      [/flight|lisbon|fare|trip|travel|hotel|book|train|plane/, 'quill', 'found one. tuesday 9:40, €84. want me to hold it?'],
      [/mail|inbox|overnight|reply|came in|message|calendar|meeting/, 'juno', '41 emails. 3 need you. i filed the rest.'],
      [/bug|fix|code|issue|deploy|sign-?in|pull request|test|ship/, 'rivet', 'fixed. pull request 212 is waiting for your review.'],
      [/budget|money|receipt|invoice|spend|cost|tax|book ?keep|paid|expens/, 'tally', "you’re 12% under. also, you paid for figma twice."],
      [/post|tweet|social|launch|announce|write|draft|blog/, 'echo', "drafted. i won’t post until you say so."],
      [/research|find|compare|which|best|look up|read|why|what|how|who/, 'nova', 'give me ten minutes and 40 tabs.'],
    ];
    const shrugs = [['nova', "on it. i’ll come back with sources."], ['juno', "noted. it’s at the top of your list."], ['echo', 'i can make that sound good. give me a minute.'], ['rivet', 'on it. tests first.']];
    function ask(text) {
      const t = text.trim().toLowerCase();
      if (!t) return speak('nova', 'type a job, any job.');
      if (/^(hi|hey|hello|yo|sup|gm|good morning)\b/.test(t)) {
        teamBots.forEach((b, i) => setTimeout(() => hop(b), i * 80));
        return speak('nova', 'hi. give one of us a job.', 500);
      }
      const hit = routes.find(([re]) => re.test(t)) || [0, ...shrugs[turn++ % shrugs.length]];
      speak(hit[1], hit[2], 850);
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); ask(input.value); input.value = ''; });
    for (const b of $$('.tries button')) b.addEventListener('click', () => {
      input.value = b.dataset.ask;
      setTimeout(() => { ask(b.dataset.ask); input.value = ''; }, still ? 0 : 320);
    });
    team.addEventListener('click', (e) => {
      const p = e.target.closest('.poke');
      if (p) speak(p.closest('.mate').dataset.bot, quips[said++ % quips.length]);
    });
    if (hover) team.addEventListener('pointerover', (e) => {
      const p = e.target.closest('.poke');
      if (p && !p.contains(e.relatedTarget)) hop($('.bot', p));
    });

    // each status line moves on in turn, so the row never changes all at once
    if (!still) {
      const lines = $$('[data-cycle]', team).map((el) => ({ el, list: el.dataset.cycle.split('|'), i: 0 }));
      let n = 0;
      setInterval(() => {
        if (document.hidden) return;
        const l = lines[n++ % lines.length];
        l.el.classList.add('swap');
        setTimeout(() => { l.el.textContent = l.list[++l.i % l.list.length]; l.el.classList.remove('swap'); }, 260);
      }, 1900);
    }
  }

  /* the sample chat types itself out once */
  const chat = $('.chat');
  let finishChat = () => {};
  if (chat && moving && chat.getBoundingClientRect().top > innerHeight) {
    const lines = $$('li', chat); let done = false;
    finishChat = () => { done = true; chat.classList.add('played'); };
    onceSeen(chat, async () => {
      for (const li of lines) {
        if (done) return;
        li.style.opacity = 1; pop(li);
        await wait(li.classList.contains('me') ? 520 : 760);
      }
      finishChat(); lines.forEach((li) => li.style.removeProperty('opacity'));
    }, { threshold: 0.5 });
  } else if (chat) chat.classList.add('played');

  /* the hand-off: dotted wires between the bots, and a parcel that travels them */
  const relay = $('#relay');
  let finishRelay = () => {};
  if (relay) {
    const stops = $$('.stop', relay), ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'wires'); svg.setAttribute('aria-hidden', 'true');
    relay.prepend(svg);
    let tracks = [];
    function wire() {
      const box = relay.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
      svg.replaceChildren();
      const pts = stops.map((s) => { const r = $('.node', s).getBoundingClientRect(); return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, r: r.width / 2 + (r.width < 80 ? 5 : 10) }; });
      tracks = pts.slice(1).map((b, i) => {
        const a = pts[i], dx = b.x - a.x, dy = b.y - a.y, flat = Math.abs(dx) > Math.abs(dy);
        const full = document.createElementNS(ns, 'path');
        full.setAttribute('d', flat ? `M${a.x} ${a.y}C${a.x + dx * 0.5} ${a.y} ${b.x - dx * 0.5} ${b.y} ${b.x} ${b.y}` : `M${a.x} ${a.y}L${b.x} ${b.y}`);
        svg.append(full);
        const len = full.getTotalLength(), steps = Math.max(2, Math.round((len - a.r - b.r) / 8)), dots = [];
        for (let k = 0; k <= steps; k++) { const p = full.getPointAtLength(a.r + ((len - a.r - b.r) * k) / steps); dots.push([p.x, p.y]); }
        full.setAttribute('d', 'M' + dots.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L'));
        return dots;
      });
    }
    wire();
    if ('ResizeObserver' in window) new ResizeObserver(wire).observe(relay);
    document.fonts?.ready.then(wire);

    if (moving && relay.getBoundingClientRect().top > innerHeight * 0.6) {
      const parcel = document.createElement('i'); parcel.className = 'parcel'; relay.append(parcel);
      let done = false;
      relay.classList.add('armed');
      finishRelay = () => { done = true; relay.classList.remove('armed'); parcel.remove(); };
      onceSeen(relay, async () => {
        await wait(350);
        for (let i = 0; i < tracks.length && !done; i++) {
          const dots = tracks[i];
          const run = parcel.animate(dots.map(([x, y], k) => ({ transform: `translate(${x}px, ${y}px) rotate(${k * 9}deg)`, opacity: k === 0 || k === dots.length - 1 ? 0 : 1 })), { duration: 620, easing: 'cubic-bezier(0.45, 0, 0.3, 1)' });
          await run.finished.catch(() => {});
          if (done) return;
          const s = stops[i + 1];
          s.classList.add('told'); pop($('.note', s)); hop($('.bot', s));
          await wait(420);
        }
        finishRelay();
      }, { threshold: 0.45 });
    }
  }

  /* allow or deny: the bot answers either way */
  for (const b of $$('[data-answer]')) b.addEventListener('click', () => {
    const box = b.closest('.note, .confirm'), line = $('[data-line]', box);
    line.textContent = b.dataset.answer;
    b.parentElement.remove();
    pop(box); hop($('.bot', box.closest('.stop, .pic')));
  });
  for (const s of $$('.switch')) s.addEventListener('click', () => {
    const on = s.getAttribute('aria-checked') !== 'true';
    s.setAttribute('aria-checked', on);
    s.previousElementSibling.querySelector('small').textContent = on ? s.dataset.when : 'paused';
    hop($('.bot', s.closest('.pic')));
  });
  for (const s of $$('.switch')) s.dataset.when = s.previousElementSibling.querySelector('small').textContent;

  /* give each bot a job: pick a row, the stage changes colour and bot */
  const jobs = $('[data-jobs]');
  if (jobs) {
    const tabs = $$('[role="tab"]', jobs);
    function pick(tab, focus) {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
        $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
        jobs.classList.toggle(`c-${t.dataset.colour}`, on);
      }
      hop($(`#${tab.getAttribute('aria-controls')} .bot`));
      if (focus) tab.focus();
    }
    for (const t of tabs) {
      t.addEventListener('click', () => pick(t));
      t.addEventListener('keydown', (e) => {
        const i = tabs.indexOf(t), step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) : step ? tabs[(i + step + tabs.length) % tabs.length] : null;
        if (next) { e.preventDefault(); pick(next, true); }
      });
    }
  }

  /* the picture of the app becomes the real app only when asked */
  const tryBtn = $('[data-try]'), shot = $('[data-frame]');
  if (tryBtn && shot) {
    let live = null;
    const fit = () => { if (live) live.style.transform = `scale(${(shot.clientWidth / 1180).toFixed(4)})`; };
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(shot);
    tryBtn.addEventListener('click', () => {
      if (live) { live.remove(); live = null; $('img', shot).hidden = false; $('span', tryBtn).textContent = 'try the real app'; return; }
      live = document.createElement('iframe');
      live.src = '/demo/'; live.width = 1180; live.height = 680; live.title = 'the dusk bot app, running on sample data';
      shot.append(live); fit();
      $('span', tryBtn).textContent = 'back to the picture';
    });
  }

  /* pick each bot’s brain: a tap swaps the model, the bot stays the same */
  const models = ['claude', 'chatgpt', 'gemini', 'grok', 'cursor', 'copilot', 'deepseek', 'kimi', 'qwen', 'opencode', 'cline'];
  const kept = ['same chats, same files, same memory.', 'it still remembers the aisle seat.', 'nothing to move.', 'that took one tap.'];
  const brainLine = $('#brain-line');
  let swaps = 0;
  const label = (t) => t.setAttribute('aria-label', `${t.dataset.bot} thinks with ${t.dataset.model}. swap its brain`);
  for (const t of $$('.thinker')) {
    label(t);
    t.addEventListener('click', () => {
      const next = models[(models.indexOf(t.dataset.model) + 1) % models.length];
      t.dataset.model = next; label(t);
      const img = $('.thought img', t), probe = new Image();
      probe.onload = () => { img.src = probe.src; };
      probe.src = img.getAttribute('src').replace(/[\w-]+\.(svg|png)$/, `${next}.svg`);
      $('.thought span', t).textContent = next;
      pop($('.thought', t)); hop($('.bot', t));
      brainLine.textContent = `${t.dataset.bot} now thinks with ${next}. ${kept[swaps++ % kept.length]}`;
    });
    if (hover) t.addEventListener('pointerenter', () => hop($('.bot', t)));
  }

  /* copy the one-line install */
  for (const b of $$('[data-copy]')) {
    const idle = b.innerHTML, name = b.getAttribute('aria-label');
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); } catch { return; }
      b.innerHTML = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M13.488 3.43a.75.75 0 0 1 .081 1.058l-6 7a.75.75 0 0 1-1.1.042l-3.5-3.5A.75.75 0 0 1 4.03 6.97l2.928 2.927 5.473-6.385a.75.75 0 0 1 1.057-.081" clip-rule="evenodd"/></svg>';
      b.setAttribute('aria-label', 'copied');
      hop($('.bot', b.closest('.home')));
      setTimeout(() => { b.innerHTML = idle; b.setAttribute('aria-label', name); }, 1600);
    });
  }

  /* monthly or yearly */
  const bill = $('.bill');
  if (bill) bill.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    for (const o of $$('button', bill)) o.setAttribute('aria-pressed', o === b);
    for (const el of $$('.plans [data-month]')) el.textContent = el.dataset[b.dataset.bill];
    if (b.dataset.bill === 'year') $$('.plan.pick .crew .bot').forEach((x, i) => setTimeout(() => hop(x), i * 90));
  });

  /* the bots standing around hop when the pointer reaches them, and say something when poked */
  const loose = '.hill .poke, .listener, .sitter, .actor, .peeker, .zero-wrap .bot, .crew .bot, .face, .room-bots .bot, .stop .bot';
  if (hover) document.addEventListener('pointerover', (e) => {
    const b = e.target.closest?.(loose);
    if (b && !b.contains(e.relatedTarget) && !b.classList.contains('face')) hop(b.matches('.bot') ? b : $('.bot', b));
  });
  document.addEventListener('click', (e) => {
    const cat = e.target.closest?.('.cat-btn');
    if (cat) return quip(cat, purrs[said++ % purrs.length]);
    const b = e.target.closest?.('.hill .poke, .listener');
    if (!b) return;
    hop($('.bot', b)); quip(b, quips[said++ % quips.length]);
  });
  onceSeen($('.hill'), (row) => [...row.children].forEach((b, i) => setTimeout(() => hop($('.bot', b)), 200 + i * 110)), { threshold: 0.6 });
  onceSeen($('.zero-wrap'), (z) => $$('.bot', z).forEach((b, i) => setTimeout(() => hop(b), 500 + i * 140)), { threshold: 0.6 });
  const listener = $('.listener .bot');
  for (const q of $$('.qs details')) q.addEventListener('toggle', () => { if (q.open) hop(listener); });

  // a jump of more than a screen (an anchor, a capture tool) finishes anything still playing
  let lastY = scrollY;
  addEventListener('scroll', () => {
    if (Math.abs(scrollY - lastY) > innerHeight * 1.5) { finishChat(); finishRelay(); for (const el of $$('[data-reveal]:not(.in)')) if (el.getBoundingClientRect().top < innerHeight) el.classList.add('in'); }
    lastY = scrollY;
  }, { passive: true });

  const title = document.title;
  document.addEventListener('visibilitychange', () => { document.title = document.hidden ? 'the bots miss you' : title; });
})();
