// the og6 share cards: fifteen hand-set cards in the home card's style (the waitlist page's pixel sky, white words centred,
// the crew on the meadow), each with its own scene. node cards.mjs <dir> writes one page per card into <dir> and
// seo/art/og6.json (which page each card is for, and its alt text); render.py photographs them into public/landing/art/og6.
// core pages name their card by page name (core), seo pages by address (seo); pages without one keep their original card
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { worldSvg, botSvg } from './world.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), D = path.resolve(here, '..', '..'), A = 'file://' + D + '/public/landing/art';
const OUT = process.argv[2], W = 1200, H = 630, M = 64;

// pieces
const bot = (shape, colour, pose, size, cx, foot, { flip = false, rot = 0 } = {}) => {
  const b = botSvg(shape, colour, pose, { grid: size > 200 ? 26 : 22, flip });
  const t = [flip ? 'scaleX(-1)' : '', rot ? `rotate(${rot}deg)` : ''].join(' ');
  return `<div class="bot" style="left:${Math.round(cx - size / 2 - size * b.px / b.G)}px;top:${Math.round(foot - size * (b.pt + b.G) / b.G)}px;${t.trim() ? `transform:${t};transform-origin:50% 100%` : ''}">${b.svg(size)}</div>`;
};
const img = (file, h, cx, foot, w0 = 420, h0 = 420) => { const w = Math.round(w0 * h / h0); return `<img class="px" src="${A}/${file}" style="left:${Math.round(cx - w / 2)}px;top:${foot - h}px;width:${w}px;height:${h}px" alt="">`; };
const tile = (inner, size, x, y, rot = 0) => `<div class="tile" style="left:${x}px;top:${y}px;width:${size}px;height:${size}px;transform:rotate(${rot}deg)">${inner}</div>`;
const bub = (who, text, side, tint, bottomY, x = M) => `<div class="bub ${side}" style="${side}:${x}px;bottom:${H - bottomY}px;--u:${tint}"><div class="in"><span>${who}</span>${text}</div><i></i></div>`;
const hill = (cx, half, rise) => [cx, half, rise];
const footOn = (G, hills) => (x) => { let y = G; for (const [cx, half, rise] of hills) { const d = Math.abs(x - cx) / half; if (d < 1) y = Math.min(y, G - rise * (1 - d * d) ** 0.7); } return y + 6; };

function page({ mood = 'sky', G = 530, hills = [], title, line, size = 112, top = 72, lineSize = 34, body = '', seed }) {
  return `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: "General Sans"; src: url("file://${D}/public/landing/fonts/general-sans.woff2"); font-weight: 200 700; }
@font-face { font-family: "Geist Mono"; src: url("file://${D}/public/landing/fonts/geist-mono.woff2"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
body { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; font-family: "General Sans"; color: #fff; -webkit-font-smoothing: antialiased; }
.world { position: absolute; left: 0; top: 0; }
.bot, .px, .tile, .bub, .fx { position: absolute; }
.bot svg { display: block; overflow: visible; filter: drop-shadow(0 6px 0 rgba(12,24,60,0.12)); }
.px { image-rendering: pixelated; }
.tile { display: grid; place-items: center; background: #fdfdfd; border-radius: 22%; box-shadow: 0 8px 0 rgba(12,24,60,0.14); }
.tile img { width: 72%; height: 72%; object-fit: contain; }
.bub { width: max-content; filter: drop-shadow(0 6px 0 rgba(12,24,60,0.12)); }
.bub .in { padding: 10px 18px 16px; background: #fdfdfd; color: #212121; font-size: 22px; font-weight: 500; line-height: 1.18; letter-spacing: -0.015em; box-shadow: inset 0 -5px 0 var(--u);
  clip-path: polygon(6px 0, calc(100% - 6px) 0, calc(100% - 6px) 6px, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 6px calc(100% - 6px), 0 calc(100% - 6px), 0 6px, 6px 6px); }
.bub span { display: block; margin-bottom: 3px; font-family: "Geist Mono"; font-size: 14px; color: #8a8a96; }
.bub i { position: absolute; bottom: -18px; left: 24px; width: 18px; height: 18px; background: linear-gradient(var(--u) 0 6px, #fdfdfd 6px); clip-path: polygon(0 0, 100% 0, 100% 33.3%, 66.6% 33.3%, 66.6% 66.6%, 33.3% 66.6%, 33.3% 100%, 0 100%); }
.text { position: absolute; left: ${M}px; top: ${top}px; width: ${W - 2 * M}px; text-align: center; }
h1 { font-weight: 600; line-height: 1.02; letter-spacing: -0.045em; text-wrap: balance; }
.text p { margin-top: 20px; font-size: 34px; font-weight: 550; line-height: 1.2; letter-spacing: -0.015em; }
.sign { position: absolute; display: grid; place-items: center; background: #fdfdfd; color: #212121; font-weight: 650; letter-spacing: -0.03em; box-shadow: inset 0 -7px 0 #fff3a0, 0 8px 0 rgba(12,24,60,0.14);
  clip-path: polygon(8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px), 0 8px, 8px 8px); }
.doc { position: absolute; background: #fdfdfd; box-shadow: inset 0 -8px 0 #d0cefb, 0 8px 0 rgba(12,24,60,0.14);
  clip-path: polygon(8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px), 0 8px, 8px 8px); }
.doc b { position: absolute; height: 12px; background: #dcdbe6; } .doc b.hi { background: #c9f63f; } .doc b.h { height: 18px; background: #212121; }
.pole { position: absolute; width: 12px; background: #b07a3c; }
</style>${worldSvg(mood, W, H, G, hills, seed, { clearTop: top - 40, clearBottom: top + 190, words: [M, top - 20, W - M, top + 200] })}${body}
<div class="text"><h1 style="font-size:${size}px">${title}</h1>${line ? `<p style="font-size:${lineSize}px">${line}</p>` : ''}</div>
<script>(async()=>{await document.fonts.ready;const h=document.querySelector('h1');let f=parseFloat(h.style.fontSize);while(h.scrollWidth>h.clientWidth+1||h.getBoundingClientRect().height>f*1.1){f-=2;h.style.fontSize=f+'px'}document.body.dataset.ready=1})()</script>`;
}


const S = {};
const crew = (list, f) => list.map(([s, c, p, z, x, o = {}]) => bot(s, c, p, z, x, f(x), o)).join('');
// 1 home: the liked og3 scene, untouched apart from no text shadow
{ const G = 530, hl = [hill(600, 560, 40)], f = footOn(G, hl);
  S.home = page({ G, hills: hl, seed: 'home', title: 'meet dusk bot', line: 'your own team of ai bots, in a chat app.', size: 120,
    body: crew([['pip', 'blue', 'wink', 104, 240], ['mochi', 'pink', 'heart', 104, 420], ['loaf', 'tangerine', 'big', 104, 780], ['starry', 'sun', 'happy', 104, 960], ['kit', 'violet', 'happy', 200, 600]], f) +
      bub('you', 'can you sort my inbox?', 'left', '#fff3a0', 368) + bub('kit', 'done. three need you.', 'right', '#ffc4dd', 368) }); }
// 2 pricing: the whole crew gathered round the sign
{ const G = 540, hl = [hill(600, 560, 44)], f = footOn(G, hl);
  S.pricing = page({ G, hills: hl, seed: 'pricing', title: 'a whole ai team, free on your laptop', line: 'they run on your computer. no meter ticking.', size: 96,
    body: `<div class="pole" style="left:594px;top:318px;height:${f(600) - 318}px"></div><div class="sign" style="left:480px;top:290px;width:240px;height:92px;font-size:42px">free. really.</div>` +
      crew([['egg', 'mint', 'happy', 96, 190], ['cheep', 'sun', 'wink', 100, 320], ['loaf', 'tangerine', 'happy', 130, 450], ['hearty', 'pink', 'heart', 130, 750], ['pip', 'blue', 'big', 110, 880], ['tofu', 'violet', 'happy', 96, 1010]], f) }); }
// 3 download: the crew popping up from the bottom edge
{ S.download = page({ G: H + 24, seed: 'download', title: 'your new coworkers are ready', line: 'for mac, windows, linux and your phone.', size: 108,
    body: [['boxo', 'tangerine', 'big', 200, 215, -4], ['hop', 'emerald', 'look', 220, 405, 6], ['pip', 'blue', 'happy', 280, 600, 0], ['mochi', 'pink', 'heart', 210, 800, -6], ['kit', 'violet', 'wink', 210, 990, 4]]
      .map(([s, c, p, z, x, r]) => bot(s, c, p, z, x, H + Math.round(z * 0.12), { rot: r })).join('') }); }
// 4 docs: a big open notebook on the hill with a bot reading over it, a friend sitting on a stack of books
{ const G = 540, hl = [hill(600, 520, 40)], f = footOn(G, hl);
  const nbH = 200, nbFoot = f(640) + 4, booksH = 96, booksFoot = f(400) + 4;
  S.docs = page({ G, hills: hl, seed: 'docs', title: 'everything your bots can do', line: 'in plain words, no jargon.', size: 100,
    body: bot('pip', 'blue', 'focus', 170, 640, nbFoot - 150) + img('s-notebook.webp', nbH, 640, nbFoot, 520, 378) +
      img('s-books.webp', booksH, 400, booksFoot, 420, 203) + bot('cheep', 'sun', 'happy', 104, 400, booksFoot - booksH + 10) +
      img('kit/p-magnifier.webp', 110, 860, f(860), 298, 419) }); }
// 5 about: the team photo on a cloud, with the one chat that explains it
{ S.about = page({ G: 610, seed: 'about', title: "who's behind the bots", line: 'a small team, and a lot of bots.', size: 108,
    body: `<img class="px" src="${A}/cloud-pink.png" style="left:270px;top:452px;width:660px;height:220px" alt="">` +
      [['hearty', 'pink', 'heart', 120, 420], ['pip', 'blue', 'happy', 120, 540], ['kit', 'violet', 'wink', 140, 670], ['sprout', 'emerald', 'happy', 120, 800]].map(([s, c, p, z, x]) => bot(s, c, p, z, x, 486)).join('') +
      bub('you', 'who made this?', 'left', '#fff3a0', 380) + bub('hearty', 'we did most of it.', 'right', '#ffc4dd', 380) }); }
// 6 changelog: the new trick: three bots balanced on each other's heads, the others cheering
{ const G = 540, hl = [hill(600, 520, 40)], f = footOn(G, hl);
  const base = f(600); let y = base, stack = '';
  for (const [s, c, p, z, k] of [['loaf', 'tangerine', 'big', 130, 0.72], ['pip', 'blue', 'happy', 104, 0.66], ['cheep', 'sun', 'wink', 84, 0]]) { stack += bot(s, c, p, z, 600, y); y -= Math.round(z * k); }
  S.changelog = page({ G, hills: hl, seed: 'changelog', title: 'the bots learned new tricks', line: "see what's new in every release.", size: 104,
    body: stack + crew([['mochi', 'pink', 'heart', 104, 330], ['goo', 'mint', 'happy', 96, 450], ['hoot', 'violet', 'big', 100, 760], ['starry', 'sun', 'happy', 100, 880, { rot: -8 }]], f) }); }
// 7 contact: a bot on the old pink desk phone, taking your call
{ const G = 540, hl = [hill(620, 360, 44)], f = footOn(G, hl);
  S.contact = page({ G, hills: hl, seed: 'contact', title: 'a human reads every message', line: 'write to hello@dusk.bot.', size: 100,
    body: img('s-phone.webp', 170, 700, f(700), 520, 387) + bot('drip', 'blue', 'happy', 150, 520, f(520)) + bub('you', 'hello? anyone there?', 'left', '#fff3a0', 410) + bub('dusk bot', 'yes. a real person.', 'right', '#d0cefb', 410) }); }
// 8 404: night, the moon, the crew asleep and one awake
{ const G = 540, hl = [hill(600, 520, 40)], f = footOn(G, hl);
  const moon = `<svg class="fx" style="left:1060px;top:262px" width="72" height="84" shape-rendering="crispEdges" fill="#fff3a0">${['..###.', '.##...', '##....', '##....', '##....', '.##...', '..###.'].map((row, y) => [...row].map((c, x) => c === '#' ? `<rect x="${x * 12}" y="${y * 12}" width="12" height="12"/>` : '').join('')).join('')}</svg>`;
  S['404'] = page({ mood: 'night', G, hills: hl, seed: '404x', title: "you found the bots' secret room", line: "the page isn't here. the bots are.", size: 100,
    body: moon + crew([['loaf', 'tangerine', 'sleepy', 110, 330], ['goo', 'mint', 'sleepy', 110, 470], ['boo', 'violet', 'big', 170, 620], ['tofu', 'sun', 'sleepy', 110, 780], ['mochi', 'pink', 'sleepy', 100, 910]], f) +
      `<div class="fx" style="left:700px;top:330px;font:600 30px/1 'Geist Mono';color:#fff3a0">z z</div>` }); }
// 9 integrations: app marks floating round one happy bot, on teal
{ const G = 540, hl = [hill(600, 360, 40)], f = footOn(G, hl);
  const logos = [['gmail.png', 300, 300, -8], ['slack.png', 420, 380, 6], ['notion.png', 330, 452, 4], ['github.svg', 800, 300, 8], ['calendar.png', 700, 380, -5], ['linear.png', 790, 452, -6]];
  S.integrations = page({ mood: 'teal', G, hills: hl, seed: 'integrations', title: 'your bots already know your apps', line: 'gmail, slack, notion, github and more.', size: 100,
    body: logos.map(([l, x, y, r]) => tile(`<img src="${A}/logos/${l}" alt="">`, 84, x, y, r)).join('') + bot('mochi', 'pink', 'heart', 180, 600, f(600)) }); }
// 10 alternatives hub: smaller words, more air; two bots back to back at the signpost
{ const G = 540, hl = [hill(600, 420, 42)], f = footOn(G, hl);
  S.alternatives = page({ G, hills: hl, seed: 'alternatives', title: 'before you pick an ai agent', line: 'honest side-by-sides, dated and sourced.', size: 80, top: 96, lineSize: 30,
    body: bot('tofu', 'tangerine', 'look', 140, 440, f(440), { flip: true }) + img('s-signpost.webp', 230, 600, f(600), 420, 545) + bot('pip', 'blue', 'look', 140, 760, f(760)) }); }
// 11 openclaw: a bot scouting with binoculars, the crew behind it
{ const G = 540, hl = [hill(640, 420, 44)], f = footOn(G, hl);
  S.openclaw = page({ G, hills: hl, seed: 'openclaw', title: 'tried openclaw? read this first', line: "for people who'd rather not run a server.", size: 96,
    body: crew([['mochi', 'pink', 'look', 90, 380], ['bruin', 'emerald', 'look', 90, 470]], f) + bot('starry', 'sun', 'wink', 170, 620, f(620)) + img('kit/p-binoculars.webp', 120, 780, f(780), 420, 406) }); }
// 12 guides hub: follow the leader: one bot with the map, the rest in a line behind
{ const G = 540, hl = [hill(600, 560, 36)], f = footOn(G, hl);
  S.guides = page({ G, hills: hl, seed: 'guides', title: 'ai agents, explained like a friend would', line: 'no hype. just how they really work.', size: 92,
    body: img('s-map.webp', 110, 860, f(860), 420, 277) + crew([['pip', 'blue', 'happy', 150, 700, { flip: true }], ['boxo', 'tangerine', 'look', 110, 540, { flip: true }], ['hearty', 'pink', 'look', 96, 420, { flip: true }], ['egg', 'mint', 'look', 84, 320, { flip: true }]], f) }); }
// 13 use-cases hub: a line of bots, each carrying its job
{ const G = 540, hl = [hill(600, 560, 36)], f = footOn(G, hl);
  const jobs = [['loaf', 'tangerine', 'happy', 's-mailbox.webp', 420, 506], ['pip', 'blue', 'focus', 'kit/p-chart.webp', 297, 419], ['mochi', 'pink', 'wink', 'kit/p-briefcase.webp', 420, 370], ['cheep', 'sun', 'happy', 's-clock.webp', 420, 405]];
  S['use-cases'] = page({ G, hills: hl, seed: 'use-cases', title: 'what would you hand off first?', line: 'the real jobs people give their bots.', size: 100,
    body: jobs.map(([s, c, p, file, w0, h0], i) => { const x = 230 + i * 245; return img(file, 112, x + 82, f(x + 82), w0, h0) + bot(s, c, p, 140, x, f(x)); }).join('') }); }
// 14 /run-claude-code-24-7: sunset; a closed laptop, one bot still at work beside it
{ const G = 540, hl = [hill(600, 460, 40)], f = footOn(G, hl);
  S['claude-code'] = page({ mood: 'dusk', G, hills: hl, seed: 'claude-code', title: 'claude code, even while you sleep', line: 'keep it working with your laptop shut.', size: 96,
    body: img('kit/p-laptop.webp', 150, 470, f(470), 420, 404) + bot('boxo', 'cyan', 'focus', 150, 690, f(690)) + bot('goo', 'mint', 'sleepy', 90, 850, f(850)) }); }
// 15 /integrations/gmail: a bot standing on top of a giant gmail tile, reporting in
{ const G = 540, hl = [hill(640, 400, 40)], f = footOn(G, hl), ts = 170, tx = 640 - ts / 2, ty = f(640) - ts - 6;
  S.gmail = page({ G, hills: hl, seed: 'gmail', title: 'your inbox, sorted before you wake up', line: 'a bot that files, flags and drafts in gmail.', size: 92,
    body: tile(`<img src="${A}/logos/gmail.png" alt="">`, ts, tx, ty, 0) + bot('kit', 'violet', 'happy', 120, 640, ty + 8) +
      bub('you', 'anything urgent?', 'left', '#fff3a0', 400) + bub('kit', 'two. drafts are ready.', 'right', '#ffc4dd', 400) }); }

// which pages each card is for, and what it shows
const META = {
  home: { core: ['home', 'waitlist'], alt: 'meet dusk bot: a big purple cat bot and four small pixel bots on a hill under a blue pixel sky, chatting "can you sort my inbox?" "done. three need you."' },
  pricing: { core: ['pricing'], alt: 'a whole ai team, free on your laptop: six pixel bots on a hill around a sign saying "free. really."' },
  download: { core: ['download'], alt: 'your new coworkers are ready: five pixel bots popping up from the bottom of a blue pixel sky' },
  docs: { core: ['docs'], alt: 'everything your bots can do: a blue pixel bot reading over a big open notebook, a yellow bot sitting on a stack of books, a magnifying glass' },
  about: { core: ['about'], alt: "who's behind the bots: four pixel bots sitting on a cloud, chatting \"who made this?\" \"we did most of it.\"" },
  changelog: { core: ['changelog'], alt: 'the bots learned new tricks: three pixel bots balanced on each other\'s heads while the others cheer' },
  contact: { core: ['contact'], alt: 'a human reads every message: a blue pixel bot beside a pink desk phone, chatting "hello? anyone there?" "yes. a real person."' },
  404: { core: ['404'], alt: "you found the bots' secret room: pixel bots asleep on a hill at night under the moon, one ghost bot wide awake" },
  integrations: { seo: '/integrations', alt: 'your bots already know your apps: the gmail, slack, notion, github, calendar and linear marks floating around a pink pixel bot with heart eyes' },
  alternatives: { seo: '/alternatives', alt: 'before you pick an ai agent: two pixel bots back to back at a signpost, looking different ways' },
  openclaw: { seo: '/alternatives/openclaw', alt: 'tried openclaw? read this first: a yellow star bot scouting with binoculars, two small bots behind it' },
  guides: { seo: '/guides', alt: 'ai agents, explained like a friend would: a blue pixel bot leading a line of bots towards a map' },
  'use-cases': { seo: '/use-cases', alt: 'what would you hand off first? four pixel bots, each beside its job: a mailbox, a chart, a briefcase and a clock' },
  'claude-code': { seo: '/run-claude-code-24-7', alt: 'claude code, even while you sleep: a closed laptop under the moon at sunset, one pixel bot still working beside it, one asleep' },
  gmail: { seo: '/integrations/gmail', alt: 'your inbox, sorted before you wake up: a purple cat bot standing on a big gmail tile, chatting "anything urgent?" "two. drafts are ready."' },
};
fs.mkdirSync(OUT, { recursive: true });
for (const [k, v] of Object.entries(S)) fs.writeFileSync(`${OUT}/${k}.html`, v);
fs.writeFileSync(path.join(D, 'seo', 'art', 'og6.json'), JSON.stringify(Object.keys(S).map((id) => ({ id, ...META[id] })), null, 1) + '\n');
console.log(`${Object.keys(S).length} cards`);
