// the share cards for everything outside the seo pages: the core pages (drawn by hand here), every docs page (from its
// front matter) and the seo hubs (their own hand-set cards, used by build-seo). writeCards() lays them out for
// seo/art/render.py in seo/art/cards.json; the pictures land in public/landing/art/og/<id>.jpg, and <id>-sq.jpg for
// the ones with a square version. card.mjs is the system they all share.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cardSpec, cardHtml, cardAlt, kitSizes, cardSignature } from './card.mjs';
import { PROPS } from './scene.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const dusk = path.resolve(here, '..', '..');

// the core pages. id is the og name build-pages.mjs asks for; square: also draw the 1200 by 1200 crop. home and the
// waitlist are the waitlist page's world (crowd and chat); the rest are calm cards: words, one bot, at most one line
export const CORE = [
  { id: 'home', square: true, at: '/', family: 'home', title: 'meet dusk bot', line: 'your own team of ai bots, in a chat app.',
    chat: [['you', 'can you sort my inbox?'], ['kit', 'done. three need you.']],
    crowd: [['kit', 'violet', 'happy'], ['pip', 'blue', 'wink'], ['mochi', 'pink', 'heart'], ['loaf', 'tangerine', 'big'], ['starry', 'sun', 'happy']] },
  { id: 'waitlist', square: true, at: '/', family: 'home', title: 'get dusk bot', line: 'text the ai you already pay for, like a teammate.',
    chat: [['you', 'save me a spot?'], ['pip', "you're in. see you soon."]],
    crowd: [['pip', 'blue', 'happy'], ['kit', 'violet', 'wink'], ['boxo', 'tangerine', 'big'], ['hearty', 'pink', 'heart'], ['goo', 'mint', 'open']] },
  { id: 'pricing', square: true, at: '/pricing', family: 'tool', title: 'free on your computer', line: 'dusk cloud keeps your bots on when your laptop is off, from $20 a month.', bot: 'loaf tangerine', pose: 'happy' },
  { id: 'download', square: true, at: '/download', family: 'guide', title: 'download dusk bot', line: 'for mac, windows and linux, and your phone.', bot: 'pip blue', pose: 'big' },
  { id: 'docs', square: true, at: '/docs', family: 'docs', title: 'the docs', line: 'everything dusk bot does, in plain words.', bot: 'hoot violet', pose: 'focus' },
  { id: 'about', square: true, at: '/about', family: 'compare', title: 'about dusk bot', line: 'a team of ai bots you text like teammates.', bot: 'hearty pink', pose: 'heart' },
  { id: 'changelog', square: true, at: '/changelog', family: 'guide', title: "what's new", line: 'every release of dusk bot, newest first.', bubble: 'something new!', bot: 'cheep sun', pose: 'big' },
  { id: 'contact', square: true, at: '/contact', family: 'usecase', title: 'say hi', line: 'a person reads every message.', bubble: 'hello@dusk.bot', bot: 'drip blue', pose: 'happy' },
  { id: 'brand', square: true, at: '/brand', family: 'compare', title: 'brand', line: 'the mark, the bots and the colours.', bot: 'kit white', pose: 'wink' },
  { id: 'terms', square: true, at: '/terms', family: 'glossary', title: 'terms of service', line: 'the deal between you and dusk bot.', bot: 'tofu violet', pose: 'focus' },
  { id: 'privacy', at: '/privacy', family: 'glossary', title: 'privacy policy', line: 'what we keep, and what we never see.', bot: 'egg mint', pose: 'wink' },
  { id: 'license', at: '/license', family: 'glossary', title: 'license', line: 'what you may do with the app.', bot: 'bruin emerald', pose: 'look' },
  { id: 'security', at: '/security', family: 'glossary', title: 'security', line: 'how to report a problem, and how we keep your bots safe.', bot: 'boxo cyan', pose: 'big' },
  { id: '404', square: true, at: '/404', family: 'night', title: 'this page wandered off', line: 'the bots looked everywhere.', bubble: 'hello?', bot: 'boo violet', pose: 'dizzy' },
  { id: 'dashboard', square: true, at: '/dashboard', family: 'night', title: 'your bots, at a glance', line: 'sign in to see your rooms, routines and cloud.', bot: 'kit violet', pose: 'happy' },
];

// the seo hubs, by their address
export const HUB_CARDS = {
  '/guides': { family: 'guide', title: 'guides', line: 'plain-words guides to bots that do real work.', bot: 'pip blue', pose: 'look' },
  '/alternatives': { family: 'compare', title: 'alternatives, side by side', line: 'checked and dated, with a source on every claim.', bot: 'tofu violet', pose: 'look' },
  '/integrations': { family: 'integration', title: 'your apps, your bots', line: 'what a bot can really do inside each one.', bot: 'mochi pink', pose: 'heart' },
  '/use-cases': { family: 'usecase', title: 'jobs to hand to a bot', line: 'by task and by role, each with the message to send.', bot: 'loaf tangerine', pose: 'happy' },
  '/routines': { family: 'routine', title: 'routines to copy', line: 'jobs a bot does on a schedule, while you sleep.', bot: 'puff cyan', pose: 'sleepy' },
  '/glossary': { family: 'glossary', title: 'ai agent words, in plain english', bot: 'hoot violet', pose: 'focus' },
  '/tools': { family: 'tool', title: 'free tools', line: 'small helpers that run in your browser.', bot: 'boxo cyan', pose: 'focus' },
};

// the docs pages, from their front matter (title, description, art)
export function docCards() {
  const dir = path.join(dusk, 'pages', 'docs');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const m = fs.readFileSync(path.join(dir, f), 'utf8').match(/^---\n([\s\S]*?)\n---/);
    const meta = Object.fromEntries(m[1].split('\n').map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map(([, k, v]) => [k, v.trim()]));
    const name = f.slice(0, -3);
    return { id: `docs--${name}`, at: `/docs/${name}`, family: 'docs', title: meta.title, line: meta.description };
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
    return { spec: s, alt: cardAlt(s), wide: cardHtml(s, opts), square: page.square ? cardHtml(s, { ...opts, square: true }) : null };
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
