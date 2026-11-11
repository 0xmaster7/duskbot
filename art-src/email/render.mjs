// renders the email art into public/landing/email. needs: python3 -m http.server 7433 --bind 127.0.0.1 in ~/Desktop/code
// (this worktree's path is passed as ROOT, relative to that folder), and playwright from the make checkout
import { createRequire } from 'module';
import { copyFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';
const require = createRequire('/Users/siddharth/Desktop/code/make/');
const { chromium } = require('playwright');
const here = new URL('.', import.meta.url).pathname, out = `${here}../../public/landing/email`;
const ROOT = process.env.ROOT ?? 'deployd/sites/dusk';
const scenes = ['code', 'welcome', 'cloud-ready', 'receipt', 'payment', 'cancelled', 'cloud-deleted', 'account-deleted', 'device', 'heads-up', 'promo', 'cloud-night', 'tip-jobs', 'tip-routines', 'tip-rooms'];
mkdirSync(`${out}/fonts`, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Users/siddharth/Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell', args: ['--use-mock-keychain', '--password-store=basic'] });
for (const scene of scenes) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 500 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:7433/${ROOT}/art-src/email/scenes.html?scene=${scene}`);
  await page.waitForFunction(() => window.READY === true, null, { timeout: 15000 });
  const file = `${out}/${/^(tip|cloud-night)/.test(scene) ? scene : `hero-${scene}`}.png`;
  await page.locator('canvas').screenshot({ path: file });
  if (errors.length) console.log(scene, errors);
  await page.close();
}
await browser.close();
copyFileSync('/Users/siddharth/Desktop/code/omb-ref/brand/final/dusk-logo-64.png', `${out}/kit-64.png`);
for (const font of ['general-sans', 'geist-mono']) copyFileSync(`${here}../../public/landing/fonts/${font}.woff2`, `${out}/fonts/${font}.woff2`);
// pixel art carries few colours: a palette png is a fraction of the size
execFileSync('python3', ['-c', `
import glob
from PIL import Image
for f in glob.glob('${out}/*.png'):
    im = Image.open(f).convert('RGB')
    im.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(f, optimize=True)
`]);
console.log('done');
