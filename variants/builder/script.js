const PIECES = window.PIECES, byId = new Map(PIECES.map((p) => [p.id, p]));
const $ = (id) => document.getElementById(id);
const grid = $('grid'), page = $('page'), sheet = $('sheet'), canvas = $('canvas'), mark = $('mark');
const KEY = 'dusk-builder-v1', WIDTHS = { s: 460, m: 760, l: 1440 };
const SITES = [['all', 'all'], ['o', 'O original'], ['a', 'A poster'], ['b', 'B team'], ['c', 'C product'], ['d', 'D world'], ['e', 'E zine'], ['art', 'art']];
const KINDS = ['any', 'hero', 'explain', 'features', 'jobs', 'how', 'models', 'apps', 'where', 'free', 'pricing', 'faq', 'closing'];

let uid = 0, site = 'all', kind = 'any', drag = null;
let items = load();

// the address bar wins when it names a different page than the one saved here, so a pasted link opens as sent
function load() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(KEY) || '[]').filter((it) => byId.has(it.id)); } catch {}
  const linked = location.hash.slice(1).split(',').filter((id) => byId.has(id));
  const list = linked.length && linked.join() !== saved.map((it) => it.id).join() ? linked.map((id) => ({ id })) : saved;
  return list.map((it) => ({ uid: ++uid, id: it.id, note: it.note || '' }));
}
function keep() {
  try { localStorage.setItem(KEY, JSON.stringify(items.map(({ id, note }) => ({ id, note })))); } catch {}
  history.replaceState(null, '', items.length ? `#${items.map((it) => it.id).join()}` : location.pathname);
}

function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function badge(p) { return el('span', `badge s-${p.site}`, p.code); }

function chips(box, list, get, set) {
  box.textContent = '';
  for (const [value, label] of list) {
    const b = el('button', '', label); b.type = 'button'; b.setAttribute('aria-pressed', String(get() === value));
    b.addEventListener('click', () => { set(value); drawLib(); });
    box.append(b);
  }
}
function drawLib() {
  chips($('sites'), SITES, () => site, (v) => { site = v; });
  chips($('kinds'), KINDS.map((k) => [k, k]), () => kind, (v) => { kind = v; });
  $('kinds').hidden = site === 'art';
  const used = new Set(items.map((it) => it.id));
  grid.textContent = '';
  for (const p of PIECES) {
    if (site !== 'all' && p.site !== site) continue;
    if (site !== 'art' && kind !== 'any' && p.kind !== kind) continue;
    const li = el('li', `card${used.has(p.id) ? ' used' : ''}`); li.draggable = true; li.dataset.id = p.id; li.title = 'drag onto the page, or click to add';
    const img = el('img'); img.src = `pieces/t/${p.id}.webp`; img.alt = ''; img.loading = 'lazy'; img.width = 360; img.height = Math.round((p.h * 360) / p.w);
    const cap = el('p'); cap.append(badge(p), p.name);
    li.append(img, cap); grid.append(li);
  }
}

function drawPage() {
  page.textContent = '';
  for (const it of items) {
    const p = byId.get(it.id), li = el('li', `piece${it.note ? ' noted' : ''}`); li.draggable = true; li.dataset.uid = it.uid;
    const img = el('img'); img.src = `pieces/${p.id}.webp`; img.alt = `${p.code} ${p.name}`; img.loading = 'lazy'; img.width = p.w; img.height = p.h;
    const meta = el('div', 'meta'), note = el('input', 'note');
    note.type = 'text'; note.placeholder = 'note: what to change'; note.value = it.note; note.setAttribute('aria-label', `note for ${p.code}`);
    meta.append(badge(p), el('span', 'name', p.name), note);
    for (const [act, glyph, label] of [['up', '↑', 'move up'], ['down', '↓', 'move down'], ['x', '✕', 'remove']]) {
      const b = el('button', '', glyph); b.type = 'button'; b.dataset.act = act; b.title = label; b.setAttribute('aria-label', label); meta.append(b);
    }
    li.append(img, meta); page.append(li);
  }
  $('empty').hidden = items.length > 0;
  const tall = items.reduce((n, it) => n + byId.get(it.id).h, 0);
  $('count').textContent = items.length ? `${items.length} ${items.length === 1 ? 'piece' : 'pieces'}, ${tall.toLocaleString()}px tall` : '';
}
function redraw() { keep(); drawPage(); drawLib(); }

function place(id, at = items.length) { items.splice(at, 0, { uid: ++uid, id, note: '' }); redraw(); }
function move(from, to) { if (to < 0 || to >= items.length) return; items.splice(to, 0, items.splice(from, 1)[0]); redraw(); }

grid.addEventListener('click', (e) => {
  const card = e.target.closest('.card'); if (!card) return;
  place(card.dataset.id); canvas.scrollTo({ top: canvas.scrollHeight, behavior: 'smooth' });
});
page.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const i = items.findIndex((it) => it.uid === Number(b.closest('.piece').dataset.uid));
  if (b.dataset.act === 'x') { items.splice(i, 1); redraw(); } else move(i, i + (b.dataset.act === 'up' ? -1 : 1));
});
page.addEventListener('input', (e) => {
  if (!e.target.classList.contains('note')) return;
  const li = e.target.closest('.piece'), it = items.find((x) => x.uid === Number(li.dataset.uid));
  it.note = e.target.value; li.classList.toggle('noted', !!it.note); keep();
});
// a piece cannot be dragged while its note is being typed, so text can be selected
page.addEventListener('focusin', (e) => { if (e.target.classList.contains('note')) e.target.closest('.piece').draggable = false; });
page.addEventListener('focusout', (e) => { if (e.target.classList.contains('note')) e.target.closest('.piece').draggable = true; });

grid.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.card'); if (!card) return;
  drag = { id: card.dataset.id }; e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', card.dataset.id);
});
page.addEventListener('dragstart', (e) => {
  const li = e.target.closest('.piece'); if (!li) return;
  drag = { uid: Number(li.dataset.uid) }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', li.dataset.uid);
  requestAnimationFrame(() => li.classList.add('dragging'));
});
function slot(y) {
  const els = [...page.children];
  for (let i = 0; i < els.length; i++) { const r = els[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return i; }
  return els.length;
}
canvas.addEventListener('dragover', (e) => {
  if (!drag) return;
  e.preventDefault(); e.dataTransfer.dropEffect = drag.id ? 'copy' : 'move';
  const i = slot(e.clientY), els = page.children;
  sheet.classList.toggle('over', !els.length); mark.hidden = !els.length;
  if (els.length) mark.style.top = `${i < els.length ? els[i].offsetTop : page.offsetHeight}px`;
});
canvas.addEventListener('drop', (e) => {
  if (!drag) return;
  e.preventDefault();
  const i = slot(e.clientY);
  if (drag.id) place(drag.id, i);
  else { const from = items.findIndex((it) => it.uid === drag.uid); move(from, i > from ? i - 1 : i); }
  done();
});
function done() { drag = null; mark.hidden = true; sheet.classList.remove('over'); page.querySelector('.dragging')?.classList.remove('dragging'); }
addEventListener('dragend', done);
canvas.addEventListener('dragleave', (e) => { if (!canvas.contains(e.relatedTarget)) { mark.hidden = true; sheet.classList.remove('over'); } });

let zoom = localStorage.getItem(`${KEY}-zoom`) || 'm';
function setZoom(z) {
  zoom = WIDTHS[z] ? z : 'm'; sheet.style.setProperty('--w', `${WIDTHS[zoom]}px`);
  for (const b of $('zoom').children) b.setAttribute('aria-pressed', String(b.dataset.z === zoom));
  try { localStorage.setItem(`${KEY}-zoom`, zoom); } catch {}
}
$('zoom').addEventListener('click', (e) => { if (e.target.dataset.z) setZoom(e.target.dataset.z); });

let toastTimer;
function toast(text) { const t = $('toast'); t.textContent = text; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200); }

$('copy').addEventListener('click', async () => {
  if (!items.length) return toast('nothing on the page yet');
  const text = `${items.map((it, i) => { const p = byId.get(it.id); return `${i + 1}. ${p.code === 'art' ? 'art:' : p.code} ${p.name}${it.note ? `: ${it.note}` : ''}`; }).join('\n')}\n${location.href}`;
  try { await navigator.clipboard.writeText(text); toast('copied. paste it to claude.'); }
  catch { const ta = el('textarea'); ta.value = text; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('copied. paste it to claude.'); }
});

// the whole page as one picture; a very tall page is scaled down to stay inside the canvas limit
$('save').addEventListener('click', async () => {
  if (!items.length) return toast('nothing on the page yet');
  toast('drawing the page');
  const ps = items.map((it) => byId.get(it.id)), tall = ps.reduce((n, p) => n + (p.h * 1440) / p.w, 0), k = Math.min(1, 16000 / tall);
  const c = el('canvas'); c.width = Math.round(1440 * k); c.height = Math.round(tall * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  let y = 0;
  for (const p of ps) {
    const im = new Image(); im.src = `pieces/${p.id}.webp`; await im.decode();
    const next = y + ((p.h * 1440) / p.w) * k; g.drawImage(im, 0, Math.round(y), c.width, Math.round(next) - Math.round(y)); y = next;
  }
  c.toBlob((blob) => {
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'dusk-page.jpg'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('saved dusk-page.jpg');
  }, 'image/jpeg', 0.9);
});

// clear asks once by changing its own label, so nothing is lost to a stray click
let sure = 0;
$('clear').addEventListener('click', (e) => {
  if (!items.length) return;
  if (Date.now() - sure < 3000) { items = []; sure = 0; e.target.textContent = 'clear'; redraw(); return; }
  sure = Date.now(); e.target.textContent = 'really clear?'; setTimeout(() => { e.target.textContent = 'clear'; }, 3000);
});

setZoom(zoom); drawPage(); drawLib();
