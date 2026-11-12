// writes seo/art/scenes.json (every page's and hub's picture, laid out) without building the site, so new pictures can be
// drawn first:  node seo/art/scenes.mjs && python3 seo/art/render.py
import path from 'node:path';
import { loadRecords, TYPES } from '../records.mjs';
import { writeScenes } from '../build-seo.mjs';
import { seoDir } from '../records.mjs';

const records = loadRecords();
const scenes = writeScenes(path.join(seoDir, '..', 'public', 'landing'), records);
console.log(`${scenes.length} scenes in seo/art/scenes.json (${Object.keys(TYPES).length} page types)`);
