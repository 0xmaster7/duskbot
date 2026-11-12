# the share pictures (open graph and x cards), 1200 by 630: one of the pixel strips, a white card with the logo and a
# few words, and pixel bots looking over the card's edge. drawn with the site's own fonts in a headless browser.
#   python3 art-src/og/make.py [og-name ...]   (needs playwright for python and node; names pick which cards to draw)
import asyncio, json, os, subprocess, glob, shutil, sys
from playwright.async_api import async_playwright
here = os.path.dirname(os.path.abspath(__file__))
dusk = os.path.abspath(os.path.join(here, '..', '..'))
land = os.path.join(dusk, 'public', 'landing')
CARDS = [
    # file, picture, title, line under it, bots (mascot-src/pixel/crowd.js names, electric colours)
    # og-home.jpg, og-waitlist.jpg and og.jpg (the fallback) are one card drawn apart from these: "meet dusk bot" in white
    # over the waitlist page's pixel sky, with the team on a hill (seo/art/card.mjs at commit 83d7bfd drew it). not redrawn here
    ('og-docs', 'strip-birches', 'the docs', 'everything dusk bot does, in plain words.', [('pip', '#286ef9'), ('hearty', '#f12b93'), ('drip', '#e5a915')]),
    ('og-download', 'strip-falls', 'download dusk bot', 'for mac, windows and linux.', [('boxo', '#fb7c01'), ('starry', '#10a760'), ('pip', '#286ef9')]),
    ('og-pricing', 'strip-islands', 'pricing', 'free for personal use. pay to keep it always on.', [('kit', '#894ef0'), ('hearty', '#f12b93')]),
    ('og-changelog', 'strip-pond', "what's new", 'every release of dusk bot, newest first.', [('wisp', '#f75e51'), ('pip', '#286ef9')]),
    ('og-about', 'strip-cliffs', 'about dusk bot', 'a team of ai bots you text like teammates.', [('pip', '#286ef9'), ('hearty', '#f12b93'), ('boxo', '#fb7c01')]),
    ('og-contact', 'strip-dunes', 'say hi', 'a person reads every message.', [('drip', '#e5a915'), ('kit', '#894ef0')]),
    ('og-brand', 'strip-sky', 'brand', 'the logo, the bots and the colours.', [('kit', '#894ef0'), ('puff', '#1cb7d8'), ('starry', '#e5a915')]),
    ('og-legal', 'strip-layers', 'the fine print', 'terms, privacy, license and security.', [('pip', '#286ef9'), ('boxo', '#fb7c01')]),
    ('og-404', 'strip-lost', 'this page wandered off', 'the bots looked everywhere.', [('boxo', '#fb7c01')]),
]
shapes = sorted({s for c in CARDS for s, _ in c[4]})
# each bot's rest frame from the pixel engine, in the same 100 box the site uses
js = "import('%s/mascot-src/pixel/crowd.js').then(g=>console.log(JSON.stringify(Object.fromEntries(%s.map(s=>{const r=g.DuskPixel.rest(s);return [s,`<g transform='translate(10 10) scale(${80/r.G})'><path fill='currentColor' d='${r.body}'/><path fill='#fff' d='${r.eyes}'/></g>`]})))))" % (dusk, json.dumps(shapes))
svg = json.loads(subprocess.check_output(['node', '-e', js]))
# a white bot (kit as the logo) gets the logo's dark eyes
bot = lambda shape, colour: f'<svg viewBox="0 0 100 100" shape-rendering="crispEdges" style="color:{colour}">{svg[shape].replace("#fff", "#212121") if colour == "#ffffff" else svg[shape]}</svg>'
PAGE = '''<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: "General Sans"; src: url("file://%(land)s/fonts/general-sans.woff2"); font-weight: 200 700; }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; background: #29a9f2 url("file://%(land)s/art/%(art)s.webp") center bottom / cover; font-family: "General Sans"; color: #131316; -webkit-font-smoothing: antialiased; }
.card { position: absolute; left: 72px; bottom: 72px; width: 760px; padding: 44px 52px 50px; border-radius: 40px; background: #fff; }
.brand { display: flex; align-items: center; gap: 12px; font-size: 30px; font-weight: 550; letter-spacing: -0.02em; }
.brand img { width: 44px; height: 44px; border-radius: 22%%; }
h1 { margin-top: 34px; font-size: %(size)spx; line-height: 0.98; letter-spacing: -0.055em; font-weight: 500; }
p { margin-top: 20px; font-size: 32px; line-height: 1.25; letter-spacing: -0.02em; color: #4b4b55; }
.bots { position: absolute; right: 56px; bottom: calc(100%% - 22px); display: flex; gap: 14px; z-index: -1; }
.bots svg { width: 96px; height: 96px; overflow: visible; }
</style><div class="card"><div class="bots">%(bots)s</div><div class="brand"><img src="file://%(dusk)s/art-src/brand/logo-2048.png">dusk bot</div><h1>%(title)s</h1><p>%(line)s</p></div>'''
async def main():
    async with async_playwright() as p:
        shells = sorted(glob.glob(os.path.expanduser('~/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell')))
        b = await p.chromium.launch(headless=True, **({'executable_path': shells[-1]} if shells else {}))
        page = await b.new_page(viewport={'width': 1200, 'height': 630})
        for name, art, title, line, crew in CARDS:
            if sys.argv[1:] and name not in sys.argv[1:]: continue
            html = PAGE % dict(land=land, dusk=dusk, art=art, title=title, line=line, size=112 if len(title) < 12 else 92 if len(title) < 18 else 76, bots=''.join(bot(s, c) for s, c in crew))
            tmp = os.path.join(here, '_card.html'); open(tmp, 'w').write(html)
            await page.goto('file://' + tmp); await page.evaluate('document.fonts.ready'); await page.wait_for_timeout(150)
            await page.screenshot(path=os.path.join(land, 'art', name + '.jpg'), type='jpeg', quality=86)
            print(name)
        os.remove(tmp); await b.close()
asyncio.run(main())
