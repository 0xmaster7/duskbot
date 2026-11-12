(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const P = window.DuskPixel, CROWD = window.CROWD;
  const small = matchMedia('(max-width: 640px)').matches;
  const NOTES = {
    idle: 'still. blinks, eyes follow a near pointer, a rare 1px settle', listening: 'tilts in, nods twice, waits', thinking: 'slow sway, eyes up and drifting', working: 'leans in, types in bursts, reads it back',
    searching: 'turns left and right, eyes lead', waiting: 'three little taps, then a pause', happy: 'hops, lands with a squash', done: 'one hop, then holds happy eyes',
    excited: 'double hop, then a wiggle', love: 'heart eyes, bouncy sway', surprised: 'stretches tall, little jump', confused: 'head tilts side to side',
    sad: 'droops and sinks, a sigh now and then', error: 'x eyes, shakes it off', sleeping: 'closed eyes, slow breathing', waking: 'blinks open, big stretch',
  };
  // one shots replay on a timer wherever a state is shown on a loop
  const ONCE = { done: 2600, surprised: 2400, waking: 3200 };
  const replay = (b, s) => { if (s == 'waking') { b.setState('sleeping'); b.later(500, () => b.setState('waking')); } else { b.setState('idle'); b.setState(s); } };
  const STATES = P.states;
  const label = (c) => `${c.name}, tap to poke`;

  function make(host, c, o = {}) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'bot'; b.setAttribute('aria-label', o.label || label(c));
    host.appendChild(b);
    return P.create(b, Object.assign({ body: c.name, colour: c.colour, seed: o.seed }, o));
  }
  const cellOf = (host) => { const d = document.createElement('div'); d.className = 'cell'; host.appendChild(d); return d; };

  // the crowd
  const scale = small ? 3 : 5;
  const crowd = CROWD.map((c, i) => make(cellOf($('#crowd-grid')), c, { scale: c.N == 20 ? scale - 1 : scale, seed: i * 7 + 3 }));
  $('#crowd-count').textContent = `${CROWD.length} bots. tap anyone.`;
  const dark = CROWD.map((c, i) => make(cellOf($('#dark-grid')), c, { scale: c.N == 20 ? 3 : 4, seed: i * 11 + 1, label: `${c.name} on dark, tap to poke` }));

  // state picker for everyone
  const pick = $('#state-pick');
  pick.insertAdjacentHTML('beforeend', STATES.map((s) => `<label><input type="radio" name="st" value="${s}"${s == 'idle' ? ' checked' : ''}><span>${s}</span></label>`).join(''));
  // everyone takes the state's eyes and stays still; one example bot per pick shows the motion
  let round = 0, loopT = 0;
  pick.addEventListener('change', (e) => {
    const s = e.target.value, n = crowd.length, off = round++ * 5;
    const stars = s == 'idle' ? [] : [0, 6, 11, 16].map((i) => crowd[(i + off) % n]);
    clearInterval(loopT);
    [...crowd, ...dark].forEach((b) => {
      b.timers.forEach(clearTimeout); b.timers = [];
      const k = stars.indexOf(b);
      b.o.calm = k < 0;
      b.setState('idle');
      if (k < 0) { if (s != 'waking') b.setState(s); else b.setState('sleeping'); }
      else b.later(k * 380, () => replay(b, s));
    });
    if (ONCE[s]) loopT = setInterval(() => stars.forEach((b, k) => b.later(k * 380, () => replay(b, s))), ONCE[s] + 1600);
    const names = stars.map((b) => b.def.name);
    $('#crowd-count').textContent = s == 'idle' ? `${CROWD.length} bots. tap anyone.` : `everyone shows ${s} with their eyes; ${names.slice(0, -1).join(', ')} and ${names.at(-1)} show the motion.`;
  });
  const toggle = (btn, f) => btn.addEventListener('click', () => { const on = btn.getAttribute('aria-pressed') != 'true'; btn.setAttribute('aria-pressed', String(on)); f(on); });
  toggle($('#do-follow'), (on) => P.bots.forEach((b) => { b.o.follow = on; }));
  toggle($('#do-pause'), (on) => { P.bots.forEach((b) => (on ? b.pause() : b.resume())); $('#do-pause').textContent = on ? 'resume' : 'pause'; });

  // playground
  const byName = Object.fromEntries(CROWD.map((c) => [c.name, c]));
  let hero;
  const log = $('#log'), floor = $('#play-stage .play-floor');
  const hook = (b, who) => b.on('tap', (n) => { log.textContent = `${who}: ${n}`; });
  function setHero(name) {
    hero && hero.destroy();
    const c = byName[name];
    $('#hero').setAttribute('aria-label', label(c));
    hero = P.create($('#hero'), { body: name, colour: c.colour, scale: small ? 6 : Math.max(6, Math.round(144 / c.N)), seed: 5, after: 'sleeping' });
    hook(hero, name); playState();
  }
  // the playground loops whatever state is picked
  let heroT = 0;
  function playState() {
    const s = $('#pick-state').value || 'idle';
    clearInterval(heroT); hero.o.after = s == 'waking' ? 'sleeping' : 'idle';
    replay(hero, s);
    if (ONCE[s]) heroT = setInterval(() => { if (!hero.rx) replay(hero, s); }, ONCE[s] + 1200);
  }
  $('#nb-l').remove(); $('#nb-r').remove();
  const nl = make(floor, byName.pip, { scale: small ? 3 : 5, seed: 21 }); floor.insertBefore(nl.el, $('#hero'));
  const nr = make(floor, byName.hoot, { scale: small ? 3 : 5, seed: 22 });
  hook(nl, 'pip'); hook(nr, 'hoot');
  $('#pick-body').innerHTML = CROWD.map((c) => `<option${c.name == 'kit' ? ' selected' : ''}>${c.name}</option>`).join('');
  $('#pick-state').innerHTML = STATES.map((s) => `<option>${s}</option>`).join('');
  $('#pick-body').addEventListener('change', (e) => setHero(e.target.value));
  $('#pick-state').addEventListener('change', playState);
  setHero('kit');
  const RX = ['poke', 'boing', 'wobble', 'squish', 'spin', 'heart', 'dizzy', 'nod'];
  $('#rx').innerHTML = RX.map((r) => `<button type="button" class="chip" data-rx="${r}">${r}</button>`).join('');
  $('#rx').addEventListener('click', (e) => { const r = e.target.dataset.rx; if (!r) return; hero.react(r, { social: 1 }); if (r != 'poke') log.textContent = `${hero.def.name}: ${r}`; });

  // every state on its own bot
  const sg = $('#state-grid');
  const sbots = STATES.map((s, i) => {
    const card = document.createElement('article'); card.className = 'scard';
    const cell = document.createElement('div'); cell.className = 'cell'; card.appendChild(cell);
    card.insertAdjacentHTML('beforeend', `<h3>${s}</h3><p>${NOTES[s] || ''}</p>`);
    sg.appendChild(card);
    const c = CROWD[(i * 3) % CROWD.length];
    const b = make(cell, c, { scale: c.N == 20 ? 4 : 5, state: s == 'waking' ? 'sleeping' : s, seed: 40 + i, after: 'sleeping', label: `${c.name} ${s}, tap to poke` });
    if (s == 'waking') b.later(600 + i * 40, () => b.setState('waking'));
    b.card = s;
    return b;
  });
  // every card loops: one shots replay on their own timer, staggered
  sbots.forEach((b, i) => {
    if (!ONCE[b.card]) return;
    b.timers.push(setTimeout(() => setInterval(() => { if (!b.paused && b.vis && !b.rx) replay(b, b.card); }, ONCE[b.card] + 1400), i * 300));
  });

  // small sizes: rows, and a sidebar where the eyes carry the state
  const SZ = [16, 24, 32, 48], rowBots = CROWD.slice(0, 12);
  $('#size-rows').innerHTML = SZ.map((s) => `<div class="srow"><b>${s} px</b><div class="line" data-s="${s}"></div></div>`).join('');
  document.querySelectorAll('.srow .line').forEach((line) => {
    const s = +line.dataset.s;
    rowBots.forEach((c, i) => make(line, c, { size: s, seed: i, label: `${c.name} at ${s} px, tap to poke` }));
  });
  const SIDE = [['deploy the landing page', 'working', 'kit'], ['why is the build red', 'error', 'boxo'], ['weekly report', 'happy', 'pip'], ['find the old invoice', 'working', 'hoot'], ['name ideas', 'thinking', 'sprout'], ['call notes', 'listening', 'bruin'], ['backup job', 'sleeping', 'boo']];
  const ul = $('#side-list');
  SIDE.forEach(([t, s, n], i) => {
    const li = document.createElement('li'); ul.appendChild(li);
    make(li, byName[n], { size: 24, state: s, seed: 90 + i, label: `${n}, ${s}` });
    li.insertAdjacentHTML('beforeend', `<span>${t}</span><small>${s}</small>`);
  });

  // in use: a sidebar session where most chats rest and a few get busy, then settle
  const USE = [
    ['deploy the landing page', 'kit'], ['why is the build red', 'boxo'], ['weekly report', 'pip'], ['find the old invoice', 'hoot'], ['name ideas', 'sprout'],
    ['call notes', 'bruin'], ['backup job', 'boo'], ['trip plan', 'mochi'], ['gym log', 'loaf'], ['grocery list', 'cheep'],
  ];
  // at most three chats busy at once; one falls asleep and wakes near the end
  const SESSION = [
    [0.5, 0, 'working'], [2, 3, 'searching'], [5.5, 3, 'done'], [6, 1, 'error'], [7.5, 3, 'idle'], [8, 6, 'sleeping'],
    [9.5, 1, 'working'], [11, 4, 'thinking'], [14, 0, 'done'], [16, 0, 'idle'], [16.5, 4, 'happy'], [18.5, 4, 'idle'],
    [19, 5, 'listening'], [21, 1, 'done'], [22, 7, 'waiting'], [23, 1, 'idle'], [24, 5, 'idle'], [25.5, 7, 'idle'], [26, 6, 'waking'], [28.5, 0, 'working'], [31, -1],
  ];
  const ul2 = $('#use-list'), useBots = USE.map(([t, n], i) => {
    const li = document.createElement('li'); ul2.appendChild(li);
    const b = make(li, byName[n], { size: 24, seed: 120 + i, label: `${n}, ${t}` });
    li.insertAdjacentHTML('beforeend', `<span>${t}</span><small>idle</small>`);
    b.on('state', (s) => { li.querySelector('small').textContent = s; if (i == 0) $('#use-status').textContent = s == 'idle' ? 'ready' : s; });
    return b;
  });
  const head = make($('#use-head'), byName.kit, { size: 48, seed: 140, label: 'kit, the open chat, tap to poke', follow: true });
  useBots[0].on('state', (s) => head.setState(s));
  let useT = [];
  function session() {
    useT.forEach(clearTimeout); useT = [];
    useBots.forEach((b) => { b.timers.forEach(clearTimeout); b.timers = []; b.setState('idle'); });
    SESSION.forEach(([at, i, s]) => useT.push(setTimeout(() => (i < 0 ? session() : useBots[i].setState(s)), at * 1000)));
  }
  session();

  // facts, measured live
  $('#sz-bots').textContent = `${CROWD.length} bodies, one colour each`;
  $('#sz-states').textContent = `${STATES.length}: ${STATES.join(', ')}`;
  $('#sz-rx').textContent = `taps pick from ${P.pokes.join(', ')}; five quick taps make it dizzy`;
  fetch('/explore/pixel/engine.js').then(async (r) => {
    const raw = await r.arrayBuffer();
    let gz = '';
    if ('CompressionStream' in window) {
      const s = new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
      gz = `, ${(new Uint8Array(await new Response(s).arrayBuffer()).length / 1024).toFixed(1)} kb gzip`;
    }
    $('#sz-engine').textContent = `${(raw.byteLength / 1024).toFixed(1)} kb raw${gz}, no dependencies`;
  }).catch(() => { $('#sz-engine').textContent = 'size unavailable'; });

  window.__pixel = { crowd, dark, sbots, useBots, head, session, get hero() { return hero; } };
})();
