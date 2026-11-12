// the share cards for everything outside the seo pages: the core pages (drawn by hand here), every docs page (from its
// front matter) and the seo hubs (their own hand-set cards, used by build-seo). writeCards() lays them out for
// seo/art/render.py in seo/art/cards.json; the pictures land in public/landing/art/og/<id>.jpg, and <id>-sq.jpg for
// the ones with a square version. card.mjs is the system they all share.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cardSpec, cardHtml, cardAlt, kitSizes, cardSignature, INK } from './card.mjs';
import { PROPS } from './scene.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const dusk = path.resolve(here, '..', '..');

// the integrations hub: the app marks float around the bot
const floatTiles = (logos) => ({ floor, square, kitDir, stageL, stageR }) => {
  const size = square ? 120 : 84, spots = square
    ? [[120, 150], [300, 70], [820, 60], [990, 170], [80, 420], [1010, 420]]
    : [[stageL - 10, 70], [stageL + 120, 20], [stageR - 210, 26], [stageR - 96, 120], [stageL - 30, 260], [stageR - 70, 300]];
  return logos.map((l, i) => { const [x, y] = spots[i]; return `<div class="tile" style="left:${x}px;top:${y}px;width:${size}px;height:${size}px;transform:rotate(${[-6, 4, -3, 7, 5, -5][i]}deg)"><img src="${kitDir}/logos/${l}" alt=""></div>`; }).join('');
};
// the brand card: the palette as pixel chips on the ground
const swatches = (colours) => ({ floor, square, stageL }) => {
  const size = square ? 74 : 54;
  return colours.map((c, i) => `<div class="tile" style="left:${(square ? 80 : stageL - 10) + i * (size + 12)}px;top:${square ? 64 : 34}px;width:${size}px;height:${size}px;border-radius:14px;background:${c};box-shadow:0 6px 0 rgba(27,27,31,0.1)"></div>`).join('');
};
// competitor name tiles on the alternatives hub, leaning on each other
const nameTiles = (names) => ({ square, stageL, stageR }) => {
  const spots = square ? [[110, 110], [880, 90], [960, 330]] : [[stageL - 30, 48], [stageR - 150, 30], [stageR - 120, 200]];
  return names.map((n, i) => `<div class="tile" style="left:${spots[i][0]}px;top:${spots[i][1]}px;width:${square ? 150 : 112}px;height:${square ? 150 : 112}px;transform:rotate(${[-7, 6, -4][i]}deg)"><span class="${n.length <= 4 ? 'l2' : 'l3'}">${n}</span></div>`).join('');
};

// the core pages. id is the og name build-pages.mjs asks for; square: also draw the 1200 by 1200 crop
export const CORE = [
  { id: 'home', square: true, at: '/', family: 'home', title: 'meet dusk bot', line: 'your own team of ai bots, in a chat app.', bubble: 'hi! meet your new team.', label_chip: 'dusk bot',
    crowd: [['kit', 'violet', 'happy'], ['pip', 'blue', 'wink'], ['mochi', 'pink', 'heart'], ['loaf', 'tangerine', 'big'], ['starry', 'sun', 'happy']] },
  { id: 'waitlist', square: true, at: '/', family: 'home', title: 'join the waitlist', line: 'text the ai you already pay for, like a teammate.', bubble: 'save me a spot!', label_chip: 'early access',
    crowd: [['boxo', 'tangerine', 'big'], ['kit', 'violet', 'happy'], ['hop', 'blue', 'look'], ['goo', 'mint', 'open']] },
  { id: 'pricing', square: true, at: '/pricing', family: 'tool', field: '#fff3a0', ground: 'meadow', label_chip: 'pricing', title: 'free on your computer', line: 'dusk cloud keeps your bots on when your laptop is off, from $20 a month.', bubble: 'the app is $0', props: ['s-coins'], bot: 'loaf tangerine', pose: 'happy' },
  { id: 'download', square: true, at: '/download', family: 'guide', label_chip: 'download', title: 'download dusk bot', line: 'for mac, windows and linux, with the phone app for iphone and android.', bubble: 'ready when you are', props: ['s-computer'], bot: 'pip blue', pose: 'big' },
  { id: 'docs', square: true, at: '/docs', family: 'docs', title: 'the docs', line: 'everything dusk bot does, in plain words.', bubble: 'start with getting started', props: ['s-books'], bot: 'hoot violet', pose: 'focus' },
  { id: 'about', square: true, at: '/about', family: 'usecase', label_chip: 'about', title: 'about dusk bot', line: 'a team of ai bots you text like teammates.', bubble: 'we did most of it.',
    crowd: [['hearty', 'pink', 'heart'], ['pip', 'blue', 'happy'], ['boxo', 'cyan', 'wink'], ['sprout', 'emerald', 'happy']], field: '#d0cefb', ground: 'meadow' },
  { id: 'changelog', square: true, at: '/changelog', family: 'routine', label_chip: "what's new", title: "what's new", line: 'every release of dusk bot, newest first.', bubble: 'something new!', props: ['s-parcel'], bot: 'cheep sun', pose: 'big', field: '#c2ecfc' },
  { id: 'contact', square: true, at: '/contact', family: 'usecase', label_chip: 'contact', title: 'say hi', line: 'a person reads every message.', bubble: 'hello@dusk.bot', props: ['s-mailbox'], bot: 'drip blue', pose: 'happy' },
  { id: 'brand', square: true, at: '/brand', family: 'docs', field: '#d0cefb', ground: 'meadow', label_chip: 'brand', title: 'brand', line: 'the mark, the bots and the colours.', bubble: 'use me!', logo: 'file:mark', label: 'dusk bot', bot: 'kit white', pose: 'wink',
    extra: swatches(['#c2ecfc', '#c9f63f', '#fff3a0', '#ffc4dd', '#d0cefb', INK]) },
  { id: 'terms', square: true, at: '/terms', family: 'glossary', field: '#d0cefb', ground: 'lemon', label_chip: 'legal', title: 'terms of service', line: 'the deal between you and dusk bot.', props: ['p-newspaper'], bot: 'tofu violet', pose: 'focus' },
  { id: 'privacy', at: '/privacy', family: 'glossary', field: '#d0cefb', ground: 'lemon', label_chip: 'legal', title: 'privacy policy', line: 'what we keep, and what we never see.', props: ['p-shield'], bot: 'egg mint', pose: 'wink' },
  { id: 'license', at: '/license', family: 'glossary', field: '#d0cefb', ground: 'lemon', label_chip: 'legal', title: 'license', line: 'what you may do with the app.', props: ['s-key'], bot: 'bruin emerald', pose: 'look' },
  { id: 'security', at: '/security', family: 'glossary', field: '#d0cefb', ground: 'lemon', label_chip: 'security', title: 'security', line: 'how to report a problem, and how we keep your bots safe.', props: ['p-shield'], bot: 'boxo cyan', pose: 'big' },
  { id: '404', square: true, at: '/404', family: 'night', label_chip: '404', title: 'this page wandered off', line: 'the bots looked everywhere.', bubble: 'hello?', props: ['p-binoculars'], bot: 'boo indigo', pose: 'dizzy' },
  { id: 'dashboard', square: true, at: '/dashboard', family: 'night', label_chip: 'dashboard', title: 'your bots, at a glance', line: 'sign in to see your rooms, routines and cloud.', bubble: 'welcome back', props: ['s-computer'], bot: 'kit violet', pose: 'happy' },
];

// the seo hubs, by their address
export const HUB_CARDS = {
  '/guides': { family: 'guide', label_chip: 'guides', title: 'guides', line: 'plain-words guides to bots that do real work.', bubble: 'where do i start?', props: ['s-map'], bot: 'pip blue', pose: 'look' },
  '/alternatives': { family: 'compare', label_chip: 'compare', title: 'alternatives, side by side', line: 'checked and dated, with a source on every claim.', props: ['s-signpost'], bot: 'tofu violet', pose: 'look', field: '#d0cefb', extra: nameTiles(['Manus', 'n8n', 'Lindy']) },
  '/integrations': { family: 'integration', label_chip: 'integrations', title: 'your apps, your bots', line: 'what a bot can really do inside each one.', bot: 'mochi pink', pose: 'heart', extra: floatTiles(['gmail.png', 'slack.png', 'notion.png', 'github.svg', 'calendar.png', 'linear.png']) },
  '/use-cases': { family: 'usecase', label_chip: 'use cases', title: 'jobs to hand to a bot', line: 'by task and by role, each with the message to send.', bubble: 'give me a job', props: ['p-briefcase'], bot: 'loaf tangerine', pose: 'happy' },
  '/routines': { family: 'routine', label_chip: 'routines', title: 'routines to copy', line: 'jobs a bot does on a schedule, while you sleep.', bubble: 'see you at 8', props: ['s-clock'], bot: 'puff cyan', pose: 'sleepy' },
  '/glossary': { family: 'glossary', label_chip: 'glossary', title: 'ai agent words, in plain english', bubble: 'what does that mean?', props: ['s-books'], bot: 'hoot violet', pose: 'focus' },
  '/tools': { family: 'tool', label_chip: 'free tools', title: 'free tools', line: 'small helpers that run in your browser.', bubble: "let's do the maths", props: ['p-chart'], bot: 'boxo cyan', pose: 'focus' },
};

// the docs pages, from their front matter (title, description, art)
export function docCards() {
  const dir = path.join(dusk, 'pages', 'docs');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const m = fs.readFileSync(path.join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/);
    const meta = Object.fromEntries(m[1].split('\n').map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map(([, k, v]) => [k, v.trim()]));
    const name = f.slice(0, -3);
    return { id: `docs--${name}`, at: `/docs/${name}`, family: 'docs', title: meta.title, line: meta.description, props: meta.art ? [meta.art] : ['s-notebook'] };
  });
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
export function cardOptions(site) {
  const kitDir = path.join(site, 'art'), url = (f) => 'file://' + f;
  return { kitDir: url(kitDir), font: url(path.join(site, 'fonts', 'general-sans.woff2')), mark: url(path.join(kitDir, 'mark-320.webp')), sizes: kitSizes(kitDir, Object.keys(PROPS)) };
}

// lays a page out as a card (and its square), unique within seen
export function layCard(page, opts, seen = new Map()) {
  let s, salt = '';
  for (let n = 0; n < 50; n++) { s = cardSpec(page, salt); if (!seen.has(cardSignature(s) + s.title)) break; salt = `#${n + 1}`; }
  seen.set(cardSignature(s) + s.title, page.at);
  if (s.tile?.logo === 'file:mark') s.tile.logo = opts.mark;
  return { spec: s, alt: cardAlt(s, PROPS), wide: cardHtml(s, opts), square: page.square ? cardHtml(s, { ...opts, square: true }) : null };
}

// every core and docs card into seo/art/cards.json; returns { id: alt } for the meta tags
export function writeCards(site) {
  const opts = cardOptions(site), seen = new Map(), out = [], alts = {};
  for (const page of [...CORE, ...docCards()]) {
    const c = layCard(page, opts, seen);
    alts[page.id] = c.alt;
    out.push({ id: page.id, dir: 'og', alt: c.alt, hash: hash(c.wide + (c.square || '')), wide: c.wide, square: c.square });
  }
  fs.writeFileSync(path.join(here, 'cards.json'), JSON.stringify(out));
  return { alts, squares: new Set(out.filter((c) => c.square).map((c) => c.id)), ids: out.map((c) => c.id) };
}
