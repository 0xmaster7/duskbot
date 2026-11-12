# photographs the og6 share cards (cards.mjs) into public/landing/art/og6/<id>.jpg, 1200 by 630, each under 150 kb; og.jpg,
# the fallback card, is a copy of the home one.   python3 art-src/og6/render.py   (needs node and playwright for python)
import asyncio, glob, io, json, os, shutil, subprocess, tempfile
from playwright.async_api import async_playwright
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
dusk = os.path.abspath(os.path.join(here, '..', '..'))
out = os.path.join(dusk, 'public', 'landing', 'art', 'og6')

async def main():
    tmp = tempfile.mkdtemp()
    subprocess.check_call(['node', os.path.join(here, 'cards.mjs'), tmp])
    cards = json.load(open(os.path.join(dusk, 'seo', 'art', 'og6.json')))
    os.makedirs(out, exist_ok=True)
    async with async_playwright() as p:
        shells = sorted(glob.glob(os.path.expanduser('~/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell')))
        b = await p.chromium.launch(headless=True, args=['--use-mock-keychain', '--password-store=basic', '--allow-file-access-from-files'], **({'executable_path': shells[-1]} if shells else {}))
        page = await b.new_page(viewport={'width': 1200, 'height': 630})
        for c in cards:
            await page.goto('file://' + os.path.join(tmp, c['id'] + '.html'))
            await page.wait_for_selector('body[data-ready]', state='attached')
            await page.wait_for_function('[...document.images].every((i) => i.complete && i.naturalWidth > 0)')
            im = Image.open(io.BytesIO(await page.screenshot(type='png'))).convert('RGB')
            for q in (90, 86, 82, 76):
                buf = io.BytesIO(); im.save(buf, 'JPEG', quality=q, subsampling=0, optimize=True, progressive=True)
                if buf.tell() <= 150 * 1024: break
            open(os.path.join(out, c['id'] + '.jpg'), 'wb').write(buf.getvalue())
            print(c['id'], buf.tell() // 1024, 'kb')
        await b.close()
    for f in glob.glob(os.path.join(out, '*.jpg')):
        if os.path.basename(f)[:-4] not in {c['id'] for c in cards}: os.remove(f)
    shutil.copy(os.path.join(out, 'home.jpg'), os.path.join(dusk, 'public', 'landing', 'art', 'og.jpg'))
    shutil.rmtree(tmp)

asyncio.run(main())
