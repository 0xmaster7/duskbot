// bundles the home page's bots into public/landing/mascot.js (one minified file, no runtime deps).
//   node mascot-src/build.mjs          builds from the copies in mascot-src/app
//   node mascot-src/build.mjs --sync [path to the Dusk Bot checkout]   first refreshes those copies, unchanged, from
//   the app's src/components
// app/ is the app's own mascot code as is: the engine (clips, springs, gaze, blinks, body geometry, svg), the mark
// controller, personality, click reactions, our clips, pointer attention, the shared clock and its frame maths.
// site.js is the only site code: it finds the bots on the page and tells them what is happening around them.
// build-pages.mjs also imports app/mascot-motion-engine.js to draw each bot's rest pose into the html.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['mascot-motion-engine.js', 'mascot-motion-mark.ts', 'mascot-personality.ts', 'mascot-click.ts', 'mascot-clips.ts',
  'mascot-attention.ts', 'mascot-clock.ts', 'mascot-motion.ts', 'cursor-face-data.ts'];

const sync = process.argv.indexOf('--sync');
if (sync > -1) {
  const repo = process.argv[sync + 1] ?? path.join(process.env.HOME, 'Desktop/code/OpenMausBot');
  const from = path.join(repo, 'src', 'components');
  for (const file of FILES) fs.copyFileSync(path.join(from, file), path.join(here, 'app', file));
  console.log(`synced ${FILES.length} files from ${from}`);
}

const out = path.join(here, '..', 'public', 'landing', 'mascot.js');
execFileSync('npx', ['--yes', 'esbuild', 'site.js', '--bundle', '--minify', '--format=iife', '--target=es2020', '--legal-comments=none',
  '--alias:react=./react-shim.js', `--outfile=${out}`], { cwd: here, stdio: 'inherit' });
