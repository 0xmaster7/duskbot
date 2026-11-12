// writes seo/art/scenes.json (every seo page's and hub's picture and share card, laid out) and seo/art/cards.json (the core
// and docs share cards) without building the site, so new pictures can be drawn first:
//   node seo/art/scenes.mjs && python3 seo/art/render.py
import path from 'node:path';
import { loadRecords, TYPES } from '../records.mjs';
import { writeScenes } from '../build-seo.mjs';
import { seoDir } from '../records.mjs';
import { writeCards } from './cards.mjs';

const site = path.join(seoDir, '..', 'public', 'landing');
const records = loadRecords();
const scenes = writeScenes(site, records);
const cards = writeCards(site);
console.log(`${scenes.length} scenes in seo/art/scenes.json (${Object.keys(TYPES).length} page types), ${cards.ids.length} cards in seo/art/cards.json`);
