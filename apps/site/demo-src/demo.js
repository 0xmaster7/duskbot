// the hero demo: the real app's markup (captured.json, drawn already as the first frame) brought to life. a click on a
// bot opens its chat, a suggestion is sent as the person's message and answered with the app's own working line, its
// timing and the reply rows the app drew for it. the panel opens and closes as the app's docked pane does, keeps its
// tab across bots and swaps its content in place; a model change only changes the label. nothing leaves the page.
import data from '@demo-data';
import { createPixel, stillFrame } from '../../../src/pixel/engine.ts';
import { BOTS, MODELS } from './content.mjs';

const host = document.querySelector('[data-ad-host]');
const root = host && host.shadowRoot;
if (root && !host.dataset.live) start();

function start() {
  host.dataset.live = '1';
  const $ = (s, el = root) => el.querySelector(s);
  const $$ = (s, el = root) => [...el.querySelectorAll(s)];
  // pieces kept as edits to dusk bot's (build.mjs diff): rebuilt once, on first use
  const first = data.bots[BOTS[0].key];
  const patch = (base, ops) => {
    const a = base.match(/<[^>]+>|[^<]+/g) ?? [];
    let i = 0, out = '';
    for (const op of ops) {
      if (typeof op === 'string') out += op;
      else if (op > 0) { out += a.slice(i, i + op).join(''); i += op; } else i -= op;
    }
    return out;
  };
  for (const b of BOTS.slice(1)) {
    const d = data.bots[b.key];
    for (const tab of Object.keys(d.panel)) if (d.panel[tab]?.d) d.panel[tab] = patch(first.panel[tab], d.panel[tab].d);
    for (const k of ['head', 'composer', 'composerBusy', 'rowSelected', 'row']) if (d[k]?.d) d[k] = patch(first[k], d[k].d);
  }
  const unpack = (s) => (s ? s.replace(/\uE000(\d+)\uE001/g, (_, i) => data.table[+i]).replace(/\uE002(\d+)\uE003/g, (_, i) => data.classes[+i]) : s);
  const html = (s) => { const t = document.createElement('template'); t.innerHTML = unpack(s); return t.content; };
  const el = (s) => html(s).firstElementChild;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const later = (ms, fn) => setTimeout(fn, ms);
  const between = (a, b) => a + Math.random() * (b - a);
  const phone = () => host.getBoundingClientRect().width < 760;
  const ids = Object.fromEntries(BOTS.map((b) => [b.key, b]));

  // ---------- the bots' mascots: the app's pixel engine ----------
  const live = new Map();
  function wake(scope) {
    for (const mark of $$('[data-dusk-mark]', scope)) {
      if (live.has(mark)) continue;
      const box = mark.firstElementChild;
      if (!box) continue;
      box.querySelector('.ad-still')?.remove();
      const size = parseFloat(getComputedStyle(box).width) || parseFloat(getComputedStyle(mark).width) || 24;
      const bot = createPixel(box, { body: mark.dataset.body, size, colour: mark.dataset.colour, eyes: mark.dataset.eyes, state: mark.dataset.pixelState || 'idle', follow: size >= 36 });
      live.set(mark, bot);
    }
  }
  function sweep() { for (const [mark, bot] of live) if (!mark.isConnected) { bot.destroy(); live.delete(mark); } }
  // where a body sits in its box, as the app's mascot-view.tsx fits it (bodyFit), in whole pixels
  const fits = new Map();
  function bodyFit(body) {
    if (fits.has(body)) return fits.get(body);
    const f = stillFrame(body, { scale: 1 });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, area = 0, sy = 0;
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
      if (!f.paint[y * f.W + x]) continue;
      area++; sy += y + 0.5;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    let fit = { scale: 1, x: 0, y: 0 };
    if (area) {
      const G = f.G, w = (x1 - x0 + 1) / G, h = (y1 - y0 + 1) / G, a = area / (G * G);
      const weight = 0.7 * Math.sqrt(a) + 0.3 * Math.sqrt(w * h);
      const scale = Math.min(0.716 / weight, 0.96 / Math.max(w, h));
      const cx = ((x0 + x1 + 1) / 2 - f.px) / G;
      const cy = (((y0 + y1 + 1) / 2 + sy / area) / 2 - f.pt) / G;
      fit = { scale, x: (0.5 - cx) * scale, y: (0.5 - cy) * scale };
    }
    fits.set(body, fit);
    return fit;
  }
  // a mark of `size` px for `body`, as the app's MausAvatar draws one
  function markBox(mark, body, size) {
    const fit = bodyFit(body);
    const drawn = Math.round(size * fit.scale);
    Object.assign(mark.style, { display: 'inline-block', position: 'relative', width: `${size}px`, height: `${size}px`, flexShrink: '0' });
    const inner = mark.firstElementChild;
    Object.assign(inner.style, { position: 'absolute', left: `${Math.round((size - drawn) / 2 + fit.x * size)}px`, top: `${Math.round((size - drawn) / 2 + fit.y * size)}px`, width: `${drawn}px`, height: `${drawn}px` });
  }
  const setMark = (mark, state) => { if (!mark) return; mark.dataset.pixelState = state; live.get(mark)?.setState(state); };

  // ---------- where things are ----------
  const sidebar = () => $('aside[data-sidebar-root]');
  const rowsBox = () => $('[data-sidebar-section-rows]');
  const scroller = () => $('main .glass-scroller');
  const log = () => $('[data-simple-rows]');
  const slot = () => $('[data-panel-slot]');
  const dock = () => $('[data-grok-inset]');
  const rowOf = (key) => $(`[data-ad-bot="${key}"]`);

  // ---------- state ----------
  const S = { bot: BOTS[0].key, panel: true, tab: 'details', drawer: false };
  const chat = {};
  for (const b of BOTS) chat[b.key] = { rows: data.bots[b.key].log.slice(), used: new Set(), busy: false, card: true, model: b.model, preview: null, unread: Boolean(b.unread), waiting: Boolean(b.waiting), routines: b.routines.map(() => null) };

  // ---------- the sidebar ----------
  const SEL = 'bg-ink/[0.08] [--row:color-mix(in_srgb,var(--color-panel),var(--color-ink)_8%)]';
  const UNSEL = 'bg-transparent [--row:var(--color-panel)] max-md:[--row:var(--color-app)] hover:bg-ink/[0.06] hover:[--row:color-mix(in_srgb,var(--color-panel),var(--color-ink)_6%)]';
  const dotFrom = (s) => { const m = /<span aria-hidden="true" data-row-dot=""[\s\S]*?<\/span><\/span><span aria-hidden="true" title="[^"]*" class="[^"]*"><\/span>/.exec(unpack(s)); return m ? m[0] : ''; };
  const unreadDot = dotFrom(data.bots.inbox.row);
  function rowHtml(key) {
    const c = chat[key], d = data.bots[key];
    const selected = key === S.bot;
    if (!selected && c.unread && key === 'inbox' && !c.preview) return d.row;
    if (c.waiting) return selected ? d.rowSelected : d.row;
    let s = unpack(d.rowSelected);
    if (!selected) s = s.replace(SEL, UNSEL).replace(' aria-current="page"', '').replace('tabindex="0"', 'tabindex="-1"');
    return s;
  }
  function paintRow(key) {
    const old = rowOf(key);
    const wrap = el(rowHtml(key));
    wrap.dataset.adBot = key;
    const row = $('[data-sidebar-bot-row]', wrap);
    const c = chat[key];
    if (c.preview != null) $('span.truncate[dir="auto"]', row).textContent = c.preview;
    if (c.unread && key !== S.bot && !$('[data-row-dot]', row)) {
      const line = $('.flex.items-baseline', row);
      line.className = 'flex items-baseline justify-between gap-2 pr-7';
      line.append(html(unreadDot));
      row.setAttribute('aria-label', `${ids[key].name}, Unread activity`);
    }
    if (!c.waiting && $('[data-testid="waiting-dot"]', row)) {
      // an answered question: the row reads as any other again
      $('[data-row-dot]', row)?.nextElementSibling?.remove();
      $('[data-row-dot]', row)?.remove();
      $('.flex.items-baseline', row).className = 'flex items-baseline justify-between gap-2 group-has-[:focus-visible]:pr-7 touch:pr-7';
      const pv = $('span.truncate[dir="auto"]', row).parentElement;
      pv.className = pv.className.replace('text-[#aa6300]', 'text-ink-secondary');
      $$('.sr-only', row).forEach((n) => n.remove());
      row.setAttribute('aria-label', ids[key].name);
    }
    const mark = $('[data-dusk-mark]', row);
    if (c.busy) setMarkAttr(mark, 'working');
    else if (!c.waiting) setMarkAttr(mark, key === S.bot ? 'idle' : 'idle');
    if (old) old.replaceWith(wrap); else rowsBox().append(wrap);
    wake(wrap);
    sweep();
  }
  const setMarkAttr = (mark, state) => { if (mark) mark.dataset.pixelState = state; };
  function paintSidebar() {
    const box = rowsBox();
    box.textContent = '';
    for (const b of BOTS) paintRow(b.key);
  }

  // ---------- the chat ----------
  function setDock() {
    const d = dock(), sc = scroller(), l = log();
    if (!d || !sc || !l) return;
    const h = Math.round(d.getBoundingClientRect().height / (parseFloat(getComputedStyle(host).scale) || 1));
    sc.style.setProperty('--composer-dock', `${h}px`);
    sc.style.scrollPaddingBottom = `calc(${h}px + 0.75rem)`;
    l.style.paddingBottom = `calc(${h}px + 0.75rem + 34px)`;
  }
  const toEnd = () => { const sc = scroller(); if (sc) sc.scrollTop = sc.scrollHeight; };
  function statusSlot() {
    let s = $('.turn-status-slot', log());
    if (!s) { s = document.createElement('div'); log().append(s); }
    const last = $$(':scope > [data-mid]', log()).at(-1);
    const lastBot = last && last.querySelector('[data-chat-bubble].chat-bubble-bot');
    s.className = `turn-status-slot h-9 shrink-0${lastBot && !chat[S.bot].busy ? ' -mt-3' : ''}`;
    log().append(s);
    return s;
  }
  function paintChat(first = false) {
    const key = S.bot, d = data.bots[key], c = chat[key];
    const head = $('[data-chathead-identity]');
    head.replaceWith(el(d.head));
    const l = log();
    for (const n of $$(':scope > [data-mid], :scope > [data-empty-chat], :scope > .contents:not([data-mid])', l)) n.remove();
    const frag = document.createDocumentFragment();
    for (const r of c.rows) frag.append(html(r));
    l.prepend(frag);
    l.setAttribute('aria-label', `Conversation with ${ids[key].name}`);
    const slotEl = statusSlot();
    slotEl.textContent = '';
    if (c.busy && c.line) slotEl.append(c.line);
    paintComposer();
    paintChips();
    wake($('main'));
    sweep();
    pillState();
    // the first frame is left where it is; any chat opened later starts at its end, as the app's do
    requestAnimationFrame(() => { setDock(); if (!first) toEnd(); });
  }
  function paintComposer() {
    const key = S.bot, d = data.bots[key];
    const row = el(d.composer);
    if (chat[key].busy) $('[data-composer-actions]', row).replaceWith(el(d.composerBusy));
    // the message box only shows what to ask; the suggestions are how this demo is spoken to
    const ta = $('textarea', row);
    if (ta) { ta.readOnly = true; ta.tabIndex = -1; ta.setAttribute('aria-hidden', 'true'); }
    $('[data-composer-row]').replaceWith(row);
  }
  function suggestions(key) {
    const b = ids[key], c = chat[key];
    // a question card waiting in the chat is answered on the card itself, as in the app
    if (b.answers && c.card) return [];
    return b.chips.map((ch, i) => ({ text: ch.u, kind: 'chip', i })).filter((s) => !c.used.has(s.i));
  }
  function paintChips() {
    const d = dock();
    let box = $('.ad-chips', d);
    if (!box) {
      box = document.createElement('div');
      box.className = 'ad-chips pointer-events-auto';
      box.setAttribute('role', 'group');
      box.setAttribute('aria-label', 'Suggestions');
      const composerWrap = $('[data-composer-row]', d).closest('.pointer-events-none.relative');
      composerWrap.before(box);
    }
    box.textContent = '';
    box.removeAttribute('data-leaving');
    const c = chat[S.bot];
    if (c.busy) { box.hidden = true; return; }
    const list = suggestions(S.bot);
    box.hidden = !list.length;
    for (const s of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-pill';
      b.textContent = s.text;
      b.addEventListener('click', () => (s.kind === 'answer' ? answer(S.bot, s.text) : ask(S.bot, s.i)));
      box.append(b);
    }
  }

  // a row arriving: inserted whole, rising 12px into place over 240ms, as the app's transcript does
  function arrive(nodes) {
    const sc = scroller(), clip = log().parentElement;
    toEnd();
    if (reduced.matches) return;
    let n = 0;
    for (const node of nodes) {
      if (!node.animate) continue;
      n++;
      clip.style.overflowY = 'clip';
      node.animate([{ transform: 'translateY(12px)' }, { transform: 'translateY(0px)' }], { duration: 240, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' })
        .finished.then(() => { if (--n === 0) clip.style.overflowY = ''; }, () => {});
    }
    if (sc) sc.scrollTop = sc.scrollHeight;
  }
  function addRows(key, rows) {
    const c = chat[key];
    c.rows.push(...rows);
    if (key !== S.bot) return;
    const l = log(), slotEl = statusSlot();
    const added = [];
    for (const r of rows) {
      const node = el(r);
      node.dataset.arrival = '';
      l.insertBefore(node, slotEl);
      added.push(node.firstElementChild || node);
    }
    wake(l);
    statusSlot();
    arrive(added);
  }

  // ---------- the working line ----------
  const label = (text) => `<span class="turn-label-in flex min-w-0 items-center [grid-area:1/1]" data-turn-now=""><span class="status-shimmer">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span></span>`;
  function workingLine(key) {
    const b = ids[key];
    const mark = $('[data-chathead-identity] [data-dusk-mark]') ;
    const colour = data.bots[key].head && /data-colour="([^"]+)"/.exec(unpack(data.bots[key].head))[1];
    const node = el(`<div class="turn-presence flex min-w-0 max-w-full flex-col items-start"><div class="flex h-9 min-w-0 max-w-full items-center gap-[8.5px] ps-2 turn-status-in"><span class="turn-status-mark relative top-px inline-flex shrink-0"><span class="inline-flex shrink-0"><span data-dusk-mark="" data-body="${/data-body="([^"]+)"/.exec(unpack(data.bots[key].head))[1]}" data-pixel-state="thinking" data-colour="${colour}" data-eyes="var(--color-app)" role="img" aria-label="${b.name}"><span></span></span></span></span><span class="turn-label-slot flex h-[22px] min-w-0 items-center gap-x-1.5 text-[14px] leading-[22px]" data-turn-status="true"><span class="grid min-w-0"></span></span></div></div>`);
    void mark;
    const m = $('[data-dusk-mark]', node);
    markBox(m, m.dataset.body, 28);
    return node;
  }
  function say(key, text) {
    const c = chat[key];
    if (!c.line) return;
    const grid = $('.grid', c.line);
    grid.textContent = '';
    grid.append(html(label(text)));
    c.line.firstElementChild.title = `Working · ${text}`;
    if (key !== S.bot || text === 'Typing…') return;
  }
  function sidebarPhrase(key, text) {
    chat[key].preview = text;
    const row = rowOf(key);
    if (row) $('span.truncate[dir="auto"]', row).textContent = text;
  }

  // ---------- a turn ----------
  const plain = (rowsHtml) => {
    const t = document.createElement('template');
    t.innerHTML = unpack(rowsHtml.join(''));
    for (const x of t.content.querySelectorAll('[data-message-actions], [data-testid="message-actions"], time, .sr-only')) x.remove();
    return t.content.textContent.replace(/\s+/g, ' ').trim();
  };
  function play(key, userRow, replyRows, steps) {
    const c = chat[key];
    c.busy = true;
    c.used ??= new Set();
    const chips = $('.ad-chips');
    if (chips && key === S.bot) { chips.dataset.leaving = ''; later(160, () => { if (S.bot === key) paintChips(); }); }
    addRows(key, [userRow]);
    if (key === S.bot) paintComposer();
    sidebarPhrase(key, 'Thinking');
    const rowMark = () => $('[data-dusk-mark]', rowOf(key));
    setMark(rowMark(), 'working');
    const seq = [];
    let t = between(550, 1000);
    seq.push([t, () => {
      c.line = workingLine(key);
      if (key === S.bot) { statusSlot().append(c.line); wake(c.line); }
      setMark($('[data-dusk-mark]', c.line), 'thinking');
    }]);
    t = between(1900, 2500);
    steps.forEach((step, i) => {
      seq.push([t, () => { say(key, step); setMark($('[data-dusk-mark]', c.line), i === 0 ? 'listening' : 'working'); sidebarPhrase(key, step); }]);
      t += between(1700, 2300);
    });
    seq.push([t, () => { say(key, 'Typing…'); setMark($('[data-dusk-mark]', c.line), 'working'); }]);
    t += between(900, 1300);
    seq.push([t, () => {
      const line = c.line;
      c.line = null;
      c.busy = false;
      if (line && line.isConnected) {
        const inner = line.firstElementChild;
        inner.classList.remove('turn-status-in');
        if (inner.animate && !reduced.matches) inner.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-out', fill: 'forwards' }).finished.then(() => line.remove(), () => line.remove());
        else line.remove();
      }
      addRows(key, replyRows);
      c.preview = plain(replyRows).slice(0, 200);
      if (key !== S.bot) c.unread = true;
      paintRow(key);
      if (key === S.bot) { paintComposer(); paintChips(); requestAnimationFrame(setDock); }
    }]);
    for (const [at, fn] of seq) later(at, fn);
  }
  function ask(key, i) {
    const c = chat[key];
    if (c.busy) return;
    c.used.add(i);
    const ex = data.bots[key].exchanges.find((e) => e.id === `x${i}`);
    play(key, ex.rows[0], ex.rows.slice(1), ids[key].chips[i].steps);
  }
  function answer(key, text) {
    const c = chat[key];
    if (c.busy || !c.card) return;
    const b = ids[key];
    const idx = Object.keys(b.answers).indexOf(text);
    const ex = data.bots[key].exchanges.find((e) => e.id === `a${idx}`);
    // the card goes, as the app takes an answered card out of the chat, and the choice is the person's message
    c.card = false;
    c.waiting = false;
    c.rows = c.rows.filter((r) => !/data-ask-card/.test(unpack(r)));
    const card = $('[data-ask-card]', log())?.closest('[data-mid]');
    card?.remove();
    paintRow(key);
    play(key, ex.rows[0], ex.rows.slice(1), b.answers[text].steps);
  }

  // ---------- switching bots ----------
  function select(key) {
    if (key === S.bot) { if (phone()) drawer(false); return; }
    const was = S.bot;
    S.bot = key;
    chat[key].unread = false;
    if (chat[key].preview === null && key === 'inbox') chat[key].preview = null;
    paintRow(was);
    paintRow(key);
    paintChat();
    if (S.panel) paintPanel();
    if (phone()) drawer(false);
  }

  // ---------- the panel ----------
  const PANEL_W = 320;
  function pillState() {
    const pill = $('[data-chathead-pill]');
    if (pill) pill.setAttribute('aria-expanded', String(S.panel && (!phone() || host.hasAttribute('data-phone-panel'))));
  }
  function panelHtml(key) {
    const p = el(data.bots[key].panel[S.tab]);
    // the screen: the page the bot has open, with its pointer on it
    if (S.tab === 'computer') {
      const inline = $('[data-inline-computer]', p);
      if (inline) {
        inline.dataset.stage = 'open';
        $('[data-panel-problem]', inline)?.remove();
        // the capture's own machine had no screen to reach: its problem note goes with it
        for (const n of $$('[data-sheet-row="problem-detail"]', p)) (n.closest('[data-panel-card], .rounded-xl, section') ?? n).remove();
        const frame = $('[data-panel-screen]', inline);
        frame.textContent = '';
        frame.append(screenFor(key));
      }
    }
    // the model the person picked
    const model = chat[key].model;
    if (model !== ids[key].model) {
      const btn = modelButton(p);
      const src = modelButtonHtml(model);
      if (btn && src) btn.innerHTML = src;
    }
    // routines switched on or off here
    $$('[role="switch"]', p).forEach((sw, i) => setSwitch(sw, chat[key].routines[i]));
    return p;
  }
  function paintPanel() {
    const old = $('#bot-panel');
    const next = panelHtml(S.bot);
    if (old) old.replaceWith(next); else $('[data-panel-slot] > div').append(next);
    wake(next);
    sweep();
    pillState();
  }
  function openPanel(on) {
    if (on === S.panel && !phone()) return;
    S.panel = on;
    const s = slot();
    if (phone()) {
      if (on) { paintPanel(); host.setAttribute('data-phone-panel', ''); const a = $('#bot-panel'); if (a.animate && !reduced.matches) a.animate([{ transform: 'translateX(100%)' }, { transform: 'translateX(0)' }], { duration: 300, easing: 'cubic-bezier(0.2, 0, 0, 1)' }); }
      else {
        const a = $('#bot-panel');
        const done = () => host.removeAttribute('data-phone-panel');
        if (a && a.animate && !reduced.matches) a.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(100%)' }], { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' }).finished.then(done, done);
        else done();
      }
      pillState();
      return;
    }
    // the app's docked pane: the column grows from 0 to 320 (and back) over 260ms while the chat beside it reflows
    if (on) { paintPanel(); s.dataset.panelSlot = 'open'; s.inert = false; s.style.width = '0px'; void s.offsetWidth; requestAnimationFrame(() => { s.style.width = `${PANEL_W}px`; }); }
    else { s.dataset.panelSlot = 'closing'; s.inert = true; s.style.width = `${s.getBoundingClientRect().width / (parseFloat(getComputedStyle(host).scale) || 1)}px`; void s.offsetWidth; requestAnimationFrame(() => { s.style.width = '0px'; }); }
    pillState();
  }

  // the switch's two looks, read from the panels the app drew (one routine on, one off); a toggle swaps the classes in
  // place so the app's own transitions move the knob and the colour
  const looks = {};
  {
    const t = document.createElement('template');
    for (const b of BOTS) {
      t.innerHTML = unpack(data.bots[b.key].panel.details);
      for (const sw of t.content.querySelectorAll('[role="switch"]')) {
        const on = sw.getAttribute('aria-checked') === 'true';
        looks[on] ??= { button: sw.className, knob: sw.firstElementChild?.className ?? '' };
      }
    }
  }
  function setSwitch(sw, on) {
    if (on === undefined || on === null) return;
    const look = looks[on];
    sw.setAttribute('aria-checked', String(on));
    if (look) { sw.className = look.button; if (sw.firstElementChild) sw.firstElementChild.className = look.knob; }
    const box = sw.closest('[data-panel-routine]');
    const name = $('[data-row-title]', box)?.textContent.trim() ?? '';
    const when = whenOf(name);
    const hint = $('[data-row-hint] span', box);
    if (hint) hint.textContent = on ? when : 'Paused';
    $('button[aria-haspopup]', box)?.setAttribute('aria-label', `${name}, ${on ? when : 'Paused'}`);
    sw.setAttribute('aria-label', `${on ? 'Pause' : 'Resume'} ${name}, ${when.charAt(0).toLowerCase()}${when.slice(1)}`);
  }
  function whenOf(name) {
    for (const b of BOTS) for (const r of b.routines) if (name === r.name) return schedule(r);
    return '';
  }
  function schedule(r) {
    const [h, m] = r.time.split(':').map(Number);
    const at = `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
    const days = r.weekdays.length === 7 ? 'Every day' : r.weekdays.join() === '1,2,3,4,5' ? 'Every weekday' : `Every ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][r.weekdays[0]]}`;
    return `${days} at ${at}`;
  }

  // ---------- the model picker ----------
  const modelOf = {};
  for (const b of BOTS) if (!modelOf[b.model]) modelOf[b.model] = b.key;
  const modelButton = (scope) => $$('button', scope).find((b) => b.getAttribute('aria-haspopup') && /Claude|GPT|Gemini|Grok/.test(b.textContent) && b.closest('[data-panel-row], [data-panel-card]'));
  function modelButtonHtml(model) {
    const t = document.createElement('template');
    t.innerHTML = unpack(data.bots[modelOf[model]].panel.details);
    return modelButton(t.content)?.innerHTML ?? null;
  }
  const LABEL = { sonnet: 'Claude Sonnet 5', opus: 'Claude Opus 5.5', gpt: 'GPT-6.1 Terra', gemini: 'Gemini 3.8 Flash', grok: 'Grok 4.7' };
  const SHORT = { sonnet: 'Sonnet 5', opus: 'Opus 5.5', gpt: 'GPT-6.1 Terra', gemini: 'Gemini 3.8 Flash', grok: 'Grok 4.7' };
  const PROVIDERS = [['Claude', ['sonnet', 'opus']], ['Codex', ['gpt']], ['Google Gemini', ['gemini']], ['Grok', ['grok']]];
  const markOf = (model) => { const t = document.createElement('template'); t.innerHTML = modelButtonHtml(model) ?? ''; return t.content.querySelector('[data-provider-mark]')?.outerHTML ?? ''; };
  let menu = null;
  function closeMenu() {
    if (!menu) return;
    const m = menu;
    menu = null;
    modelButton($('#bot-panel'))?.setAttribute('aria-expanded', 'false');
    m.remove();
  }
  // the app's model picker, from its captured parts: the bot's model on top, then each AI with its models
  function buildMenu() {
    const m = el(data.menu.html);
    const list = $('[data-simple-models] > div', m);
    const current = $('[data-current-model]', list).cloneNode(true);
    const group = $('[role="group"]', list).cloneNode(true);
    const sep = $('[role="separator"]', list).cloneNode(true);
    const item = $('[role="group"] .contents', list).cloneNode(true);
    const model = chat[S.bot].model;
    current.querySelector('[data-provider-mark]')?.closest('span.flex')?.replaceChildren(html(markOf(model)));
    $('[data-simple-model-text] .truncate', current).textContent = LABEL[model];
    current.title = LABEL[model];
    current.dataset.model = model;
    list.replaceChildren(current, sep);
    PROVIDERS.forEach(([name, models], gi) => {
      const g = group.cloneNode(false);
      if (gi) g.classList.add('mt-1');
      const head = $('[id]', group).cloneNode(true);
      head.removeAttribute('id');
      head.firstElementChild.replaceChildren(html(markOf(models[0])));
      head.lastElementChild.textContent = name;
      g.removeAttribute('aria-labelledby');
      g.setAttribute('aria-label', name);
      g.append(head);
      for (const mk of models) {
        const it = item.cloneNode(true);
        const btn = it.firstElementChild;
        btn.dataset.model = mk;
        btn.setAttribute('aria-label', LABEL[mk]);
        btn.title = LABEL[mk];
        btn.setAttribute('aria-pressed', String(mk === model));
        btn.tabIndex = 0;
        $('[data-simple-model-text] .truncate', btn).textContent = SHORT[mk];
        g.append(it);
      }
      list.append(g);
    });
    const search = $('input', m);
    if (search) { search.readOnly = true; search.tabIndex = -1; }
    return m;
  }
  function openMenu(btn) {
    if (menu) return closeMenu();
    const m = buildMenu();
    const box = $('.ad-root');
    const k = parseFloat(getComputedStyle(host).scale) || 1;
    const ar = box.getBoundingClientRect(), br = btn.getBoundingClientRect();
    const right = (ar.right - br.right) / k, bottom = (ar.bottom - br.top) / k + 6;
    Object.assign(m.style, { position: 'absolute', left: 'auto', top: 'auto', right: `${Math.max(8, right)}px`, bottom: `${bottom}px`, maxHeight: `${Math.min(390, ar.height / k - bottom - 8)}px`, width: `${Math.min(300, ar.width / k - 16)}px` });
    box.append(m);
    btn.setAttribute('aria-expanded', 'true');
    $('[data-current-model]', m)?.focus({ preventScroll: true });
    menu = m;
  }
  function pickModel(model) {
    chat[S.bot].model = model;
    // only the label changes: the panel stays as it is
    const btn = modelButton($('#bot-panel'));
    const src = modelButtonHtml(model);
    if (btn && src) { btn.innerHTML = src; btn.title = LABEL[model]; }
    closeMenu();
    btn?.focus({ preventScroll: true });
  }

  // ---------- a bot's screen ----------
  const SCREENS = {
    dusk: { url: 'calendar.google.com', title: 'Thursday, Nov 13', rows: [['9:00', 'Inbox replies'], ['9:30', 'Pitch deck, focus time'], ['12:00', 'Lunch'], ['2:00', 'Priya, moved from 11:30', 1], ['4:00', 'Review checkout fix']] },
    researcher: { url: 'hatch.app/pricing', title: 'Pricing', rows: [['Starter', '$12 / seat'], ['Team', '$20 / seat', 1], ['Business', '$34 / seat'], ['Gmail plugin', 'All plans'], ['Free trial', '14 days']] },
    writer: { url: 'docs.google.com', title: 'Thursday newsletter', rows: [['Same-day delivery is live.', ''], ['Order by 2 PM, it arrives tonight.', '', 1], ['Free over $40.', ''], ['Also new: gift wrap.', '']] },
    inbox: { url: 'mail.google.com', title: 'Inbox', rows: [['Priya S.', 'Can we move to 2?'], ['Daniel (landlord)', 'Lease renewal', 1], ['Sam', 'Final logo files'], ['Bank', 'Your new card shipped'], ['Weekly digest', '12 new posts']] },
    maya: { url: 'grocer.example/cart', title: 'Your cart, 23 items', rows: [['Chickpeas x2', '$2.40'], ['Halloumi', '$5.90', 1], ['Tortillas', '$3.20'], ['Lemons x4', '$2.00'], ['Pizza flour', '$4.50']] },
    books: { url: 'sheets.google.com', title: 'October close', rows: [['Revenue', '$18,420'], ['Costs', '$11,230'], ['Profit', '$7,190', 1], ['Receipts matched', '41 of 43'], ['Unused software', '$89 / mo']] },
    coder: { url: 'github.com/shop/checkout.js', mono: 1, rows: ['function startCheckout(cart) {', '  const expires = new Date(', "    cart.expires_at.replace(' ', 'T')", '  )', '  if (expires < Date.now()) return renew(cart)', '  button.disabled = false', '}'] },
    leo: { url: 'flights.example/lisbon', title: 'Dec 12 to 16, 1 adult', rows: [['Direct, 9:40 AM', '$612'], ['Via Madrid, 7:15 AM', '$488', 1], ['Via London, 8:20 AM', '$534'], ['Window seat', 'Available'], ['Price trend', 'Steady']] },
  };
  let pointerTimer = 0;
  function screenFor(key) {
    const sc = SCREENS[key];
    const box = document.createElement('div');
    box.className = 'ad-screen';
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', `${ids[key].name}'s screen: ${sc.title || sc.url}`);
    const colour = /data-colour="([^"]+)"/.exec(unpack(data.bots[key].head))[1];
    box.style.setProperty('--ad-hue', colour);
    const bar = document.createElement('div');
    bar.className = 'ad-screen-bar';
    bar.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    const url = document.createElement('span');
    url.className = 'ad-screen-url';
    url.textContent = sc.url;
    bar.append(url);
    const page = document.createElement('div');
    page.className = 'ad-screen-page';
    if (sc.mono) { page.dataset.mono = ''; page.textContent = sc.rows.join('\n'); }
    else {
      const h = document.createElement('h4');
      h.textContent = sc.title;
      page.append(h);
      for (const [a, b, hot] of sc.rows) {
        const r = document.createElement('div');
        r.className = 'ad-screen-row';
        if (hot) r.dataset.hot = '';
        const x = document.createElement('b'); x.textContent = a;
        const y = document.createElement('span'); y.textContent = b;
        r.append(x, y);
        page.append(r);
      }
    }
    const pointer = document.createElement('span');
    pointer.className = 'ad-screen-pointer';
    const body = /data-body="([^"]+)"/.exec(unpack(data.bots[key].head))[1];
    const holder = document.createElement('span');
    const mark = document.createElement('span');
    holder.append(mark);
    pointer.append(holder);
    markBox(holder, body, 22);
    box.append(bar, page, pointer);
    requestAnimationFrame(() => {
      if (!pointer.isConnected) return;
      live.set(pointer, createPixel(mark, { body, size: 22, colour, eyes: '#fff', state: 'working' }));
      const move = () => {
        if (!pointer.isConnected) return;
        const rows = $$('.ad-screen-row, h4', page);
        const target = rows[Math.floor(Math.random() * rows.length)] || page;
        const pr = box.getBoundingClientRect(), tr = target.getBoundingClientRect();
        const k = pr.width / box.offsetWidth || 1;
        pointer.style.transform = `translate(${(tr.left - pr.left) / k + Math.min(60, tr.width / k - 30)}px, ${(tr.top - pr.top) / k - 6}px)`;
        clearTimeout(pointerTimer);
        pointerTimer = later(between(1400, 2400), move);
      };
      move();
    });
    return box;
  }

  // ---------- the phone's list ----------
  function drawer(on) {
    S.drawer = on;
    const a = sidebar();
    if (!a) return;
    a.classList.toggle('max-md:-translate-x-full', !on);
    $('button[aria-label="Open bot list"]')?.setAttribute('aria-expanded', String(on));
  }

  // ---------- clicks ----------
  root.addEventListener('click', (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (menu && menu.contains(t)) { const r = t.closest('[data-menu-row][data-model]'); if (r) pickModel(r.dataset.model); return; }
    if (menu) { closeMenu(); if (t.closest('#bot-panel button[aria-haspopup]')) return; return; }
    const row = t.closest('[data-ad-bot]');
    if (row && !t.closest('[data-bot-actions]')) return select(row.dataset.adBot);
    if (t.closest('[data-chathead-pill]')) return openPanel(!(S.panel && (!phone() || host.hasAttribute('data-phone-panel'))));
    if (t.closest('#bot-panel button[aria-label="Close"]')) return openPanel(false);
    if (t.closest('button[aria-label="Open bot list"]')) return drawer(!S.drawer);
    const tab = t.closest('#bot-panel [data-panel-tab]');
    if (tab) {
      const order = ['details', 'computer', 'advanced'];
      const i = $$('#bot-panel [data-panel-tab]').indexOf(tab);
      if (order[i] && order[i] !== S.tab) { S.tab = order[i]; paintPanel(); }
      return;
    }
    const sw = t.closest('#bot-panel [role="switch"]');
    if (sw) {
      const list = $$('#bot-panel [role="switch"]');
      const i = list.indexOf(sw);
      chat[S.bot].routines[i] = sw.getAttribute('aria-checked') !== 'true';
      setSwitch(sw, chat[S.bot].routines[i]);
      return;
    }
    const mb = t.closest('#bot-panel button[aria-haspopup]');
    if (mb && mb === modelButton($('#bot-panel'))) return openMenu(mb);
    const opt = t.closest('[data-ask-card] button');
    if (opt) {
      const txt = opt.textContent.replace(/^[A-D]\s*/, '').trim();
      const b = ids[S.bot];
      const hit = b.answers && Object.keys(b.answers).find((a) => txt.includes(a) || a.includes(txt));
      if (hit) answer(S.bot, hit);
    }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu) { closeMenu(); return; }
    // the app's rows are buttons: enter and space open them
    if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof Element && e.target.matches('[data-sidebar-bot-row]')) {
      e.preventDefault();
      e.target.click();
    }
  });

  // ---------- go ----------
  const setup = () => {
    // the rows the app drew become the demo's, in the demo's order
    const wrapRows = $$('[data-bot-reorder-row]');
    wrapRows.forEach((r) => r.remove());
    paintSidebar();
    for (const r of $$('[data-sidebar-bot-row]')) r.tabIndex = r.closest('[data-ad-bot]').dataset.adBot === S.bot ? 0 : -1;
    paintChat(true);
    const s = slot();
    if (s) { s.style.width = `${PANEL_W}px`; }
    paintPanel();
    if (phone()) { S.panel = false; drawer(false); }
    wake(root);
    new ResizeObserver(() => setDock()).observe(dock());
  };
  if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(setup); else setup();
  void MODELS;
}
