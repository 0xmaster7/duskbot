# the share pictures (open graph and x cards), 1200 by 630: one of the pixel strips, a white card with the mark and a
# few words, and bots looking over the card's edge. drawn with the site's own fonts in a headless browser.
#   python3 art-src/og/make.py        (needs playwright for python and node)
import asyncio, json, os, subprocess, glob
from playwright.async_api import async_playwright
here = os.path.dirname(os.path.abspath(__file__))
dusk = os.path.abspath(os.path.join(here, '..', '..'))
land = os.path.join(dusk, 'public', 'landing')
CARDS = [
    # file, picture, title, line under it, bots
    ('og-home', 'hero-bg', 'Meet Dusk Bot', 'your own team of ai bots, in a chat app.', [('clover', '#ff5c9d'), ('circle', '#2f7bf2'), ('hex', '#ff7d1f'), ('star', '#1fb866')]),
    ('og-docs', 'strip-birches', 'the docs', 'everything dusk bot does, in plain words.', [('circle', '#2f7bf2'), ('heart', '#ff5c9d'), ('drop', '#f8c623')]),
    ('og-download', 'strip-falls', 'download dusk bot', 'for mac, windows and linux.', [('hex', '#ff7d1f'), ('star', '#1fb866'), ('circle', '#2f7bf2')]),
    ('og-pricing', 'strip-islands', 'pricing', 'free for personal use. pay to keep it always on.', [('clover', '#8d5cf0'), ('heart', '#ff5c9d')]),
    ('og-changelog', 'strip-pond', "what's new", 'every release of dusk bot, newest first.', [('moon', '#8d5cf0'), ('circle', '#2f7bf2')]),
    ('og-about', 'strip-cliffs', 'about dusk bot', 'a team of ai bots you text like teammates.', [('circle', '#2f7bf2'), ('heart', '#ff5c9d'), ('hex', '#ff7d1f')]),
    ('og-contact', 'strip-dunes', 'say hi', 'a person reads every message.', [('drop', '#f8c623'), ('clover', '#8d5cf0')]),
    ('og-brand', 'strip-sky', 'brand', 'the mark, the bots and the colours.', [('cloud', '#ff5c9d'), ('star', '#f8c623'), ('pixel', '#ff7d1f')]),
    ('og-legal', 'strip-layers', 'the fine print', 'terms, privacy, license and security.', [('circle', '#2f7bf2'), ('hex', '#ff7d1f')]),
    ('og-404', 'strip-lost', 'this page wandered off', 'the bots looked everywhere.', [('hex', '#ff7d1f')]),
]
shapes = sorted({s for c in CARDS for s, _ in c[4]})
js = "import('%s/mascot-src/engine/geometry.js').then(g=>console.log(JSON.stringify(Object.fromEntries(%s.map(s=>[s,g.botSvg(s)])))))" % (dusk, json.dumps(shapes))
svg = json.loads(subprocess.check_output(['node', '-e', js]))
bot = lambda shape, colour: f'<svg viewBox="0 0 100 100" style="color:{colour}">{svg[shape]}</svg>'
PAGE = '''<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: "General Sans"; src: url("file://%(land)s/fonts/general-sans.woff2"); font-weight: 200 700; }
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; background: #29a9f2 url("file://%(land)s/art/%(art)s.webp") center bottom / cover; font-family: "General Sans"; color: #131316; -webkit-font-smoothing: antialiased; }
.card { position: absolute; left: 72px; bottom: 72px; width: 760px; padding: 44px 52px 50px; border-radius: 40px; background: #fff; }
.brand { display: flex; align-items: center; gap: 12px; font-size: 30px; font-weight: 550; letter-spacing: -0.02em; }
.brand img { width: 44px; height: 44px; }
h1 { margin-top: 34px; font-size: %(size)spx; line-height: 0.98; letter-spacing: -0.055em; font-weight: 500; }
p { margin-top: 20px; font-size: 32px; line-height: 1.25; letter-spacing: -0.02em; color: #4b4b55; }
.bots { position: absolute; right: 56px; bottom: calc(100%% - 22px); display: flex; gap: 14px; z-index: -1; }
.bots svg { width: 96px; height: 96px; overflow: visible; }
</style><div class="card"><div class="bots">%(bots)s</div><div class="brand"><img src="file://%(dusk)s/art-src/brand/mark.png">dusk bot</div><h1>%(title)s</h1><p>%(line)s</p></div>'''
async def main():
    async with async_playwright() as p:
        shells = sorted(glob.glob(os.path.expanduser('~/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell')))
        b = await p.chromium.launch(headless=True, **({'executable_path': shells[-1]} if shells else {}))
        page = await b.new_page(viewport={'width': 1200, 'height': 630})
        for name, art, title, line, crew in CARDS:
            html = PAGE % dict(land=land, dusk=dusk, art=art, title=title, line=line, size=112 if len(title) < 12 else 92 if len(title) < 18 else 76, bots=''.join(bot(s, c) for s, c in crew))
            tmp = os.path.join(here, '_card.html'); open(tmp, 'w').write(html)
            await page.goto('file://' + tmp); await page.evaluate('document.fonts.ready'); await page.wait_for_timeout(150)
            await page.screenshot(path=os.path.join(land, 'art', name + '.jpg'), type='jpeg', quality=86)
            print(name)
        os.remove(tmp); await b.close()
asyncio.run(main())
