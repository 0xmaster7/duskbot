// screenshots each lab direction at desktop and phone width, and a side-by-side sheet
//   node apps/site/hero-lab/serve.mjs 7481 & node apps/site/hero-lab/shoot.cjs <out dir>
const { chromium } = require(process.env.HOME + '/Desktop/code/make/node_modules/playwright');
const out = process.argv[2], base = 'http://127.0.0.1:7481/lab/';
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-mac-arm64/chrome-headless-shell', args: ['--use-mock-keychain', '--password-store=basic'] });
  for (const id of ['a', 'b', 'c']) for (const [w, tag] of [[1440, 'desktop'], [390, 'mobile']]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: tag === 'mobile' ? 2 : 1 });
    await p.goto(base + id + '.html'); await p.waitForLoadState('networkidle'); await p.evaluate(() => document.fonts.ready);
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (ov > 0) console.log(id, tag, 'overflow', ov);
    await p.screenshot({ path: `${out}/hero-v2-${id}-${tag}.png`, fullPage: true }); await p.close();
  }
  const p = await b.newPage({ viewport: { width: 1800, height: 1000 } });
  await p.goto(base + 'sheet.html'); await p.waitForLoadState('networkidle'); await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${out}/hero-v2-sheet.png`, fullPage: true }); await b.close();
})();
