// bundles the home page's bots into public/landing/mascot.js (one minified file, no runtime deps).
//   node mascot-src/build.mjs
// pixel/ is the bots themselves (the engine and the twenty drawings), free of any framework;
// site.js is the page glue. build-pages.mjs imports pixel/crowd.js to draw each bot's rest frame into the html.
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'public', 'landing', 'mascot.js');
execFileSync('npx', ['--yes', 'esbuild', 'site.js', '--bundle', '--minify', '--format=iife', '--target=es2020', '--legal-comments=none', `--outfile=${out}`], { cwd: here, stdio: 'inherit' });
