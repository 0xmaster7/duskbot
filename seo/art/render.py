# photographs the pictures the build lays out. seo/art/scenes.json (the seo pages and hubs) and seo/art/cards.json (the
# core and docs share cards) are written by node seo/art/scenes.mjs and by every build; this draws the ones that changed
# since last time (seo/art/rendered.json keeps a hash per picture) in headless chromium and writes, into public/landing/art:
#   seo/<id>.webp, seo/<id>-660.webp   a seo page's hero, 1320 by 528 and 660 wide for phones
#   seo/og/<id>.jpg                    a seo page's share card, 1200 by 630 (and seo/og/<id>-sq.jpg, 1200 by 1200, for hubs)
#   og/<id>.jpg, og/<id>-sq.jpg        a core or docs page's share card (og.jpg, the fallback, is a copy of og/home.jpg)
#   python3 seo/art/render.py [--all] [id ...]     (needs playwright for python; headless only)
import asyncio, glob, io, json, os, shutil, sys
from playwright.async_api import async_playwright
from PIL import Image

here = os.path.dirname(os.path.abspath(__file__))
dusk = os.path.abspath(os.path.join(here, '..', '..'))
art = os.path.join(dusk, 'public', 'landing', 'art')
out = os.path.join(art, 'seo')
done_file = os.path.join(here, 'rendered.json')
LIMIT = 150 * 1024


def save_card(png, file):
    # the card as a jpeg under the limit: full colour detail first (crisp pixel edges), then a little less
    im = Image.open(io.BytesIO(png)).convert('RGB')
    for q, sub in ((88, 0), (84, 0), (84, 2), (78, 2), (72, 2)):
        buf = io.BytesIO()
        im.save(buf, 'JPEG', quality=q, subsampling=sub, optimize=True, progressive=True)
        if buf.tell() <= LIMIT:
            break
    with open(file, 'wb') as f:
        f.write(buf.getvalue())


async def shoot(page, html, size, tmp):
    await page.set_viewport_size({'width': size[0], 'height': size[1]})
    with open(tmp, 'w') as f:
        f.write(html)
    await page.goto('file://' + tmp)
    await page.evaluate('document.fonts.ready')
    await page.wait_for_function('[...document.images].every((i) => i.complete && i.naturalWidth > 0)')
    if '<script>' in html:
        await page.wait_for_selector('body[data-ready]', state='attached')
    png = await page.screenshot(type='png')
    os.remove(tmp)
    return png


async def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    everything = '--all' in sys.argv
    scenes = json.load(open(os.path.join(here, 'scenes.json')))
    cards = json.load(open(os.path.join(here, 'cards.json'))) if os.path.exists(os.path.join(here, 'cards.json')) else []
    done = json.load(open(done_file)) if os.path.exists(done_file) else {}
    # older ledgers kept one hash per seo picture for hero and card together: the hero stays, the card is redrawn
    done = {k: (v if isinstance(v, dict) else {'hero': next((s['hash'] for s in scenes if s['id'] == k), v)}) for k, v in done.items()}
    os.makedirs(os.path.join(out, 'og'), exist_ok=True)
    os.makedirs(os.path.join(art, 'og'), exist_ok=True)
    jobs = []
    for s in scenes:
        d, want = done.get(s['id'], {}), (not args) or s['id'] in args
        if want and (everything or args or d.get('hero') != s['hash'] or not os.path.exists(os.path.join(out, s['id'] + '.webp'))):
            jobs.append(('hero', s))
        if want and (everything or args or d.get('og') != s['og_hash'] or not os.path.exists(os.path.join(out, 'og', s['id'] + '.jpg'))):
            jobs.append(('seo-og', s))
    for c in cards:
        key = 'og:' + c['id']
        if ((not args) or c['id'] in args) and (everything or args or done.get(key, {}).get('og') != c['hash'] or not os.path.exists(os.path.join(art, 'og', c['id'] + '.jpg'))):
            jobs.append(('card', c))
    if not jobs:
        print('every picture is up to date')
    else:
        async with async_playwright() as p:
            shells = sorted(glob.glob(os.path.expanduser('~/Library/Caches/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell')))
            browser = await p.chromium.launch(headless=True, args=['--use-mock-keychain', '--password-store=basic', '--allow-file-access-from-files'], **({'executable_path': shells[-1]} if shells else {}))
            page = await browser.new_page(viewport={'width': 1320, 'height': 528})
            tmp = os.path.join(art, '_scene.html')
            for kind, s in jobs:
                if kind == 'hero':
                    im = Image.open(io.BytesIO(await shoot(page, s['hero'], (1320, 528), tmp))).convert('RGB')
                    im.save(os.path.join(out, s['id'] + '.webp'), quality=80, method=6)
                    im.resize((660, 264), Image.LANCZOS).save(os.path.join(out, s['id'] + '-660.webp'), quality=80, method=6)
                    done.setdefault(s['id'], {})['hero'] = s['hash']
                    print(s['id'])
                else:
                    wide, square = (s['og'], s.get('og_square')) if kind == 'seo-og' else (s['wide'], s.get('square'))
                    folder = os.path.join(out, 'og') if kind == 'seo-og' else os.path.join(art, 'og')
                    save_card(await shoot(page, wide, (1200, 630), tmp), os.path.join(folder, s['id'] + '.jpg'))
                    if square:
                        save_card(await shoot(page, square, (1200, 1200), tmp), os.path.join(folder, s['id'] + '-sq.jpg'))
                    elif os.path.exists(os.path.join(folder, s['id'] + '-sq.jpg')):
                        os.remove(os.path.join(folder, s['id'] + '-sq.jpg'))
                    if kind == 'seo-og':
                        done.setdefault(s['id'], {})['og'] = s['og_hash']
                    else:
                        done['og:' + s['id']] = {'og': s['hash']}
                    print('card', s['id'])
            await browser.close()
    # the fallback card for anything without its own
    if os.path.exists(os.path.join(art, 'og', 'home.jpg')):
        shutil.copy(os.path.join(art, 'og', 'home.jpg'), os.path.join(art, 'og.jpg'))
    # pictures of pages that are gone go too
    ids = {s['id'] for s in scenes}
    card_ids = {c['id'] for c in cards}
    for f in glob.glob(os.path.join(out, '*.webp')) + glob.glob(os.path.join(out, 'og', '*.jpg')):
        name = os.path.basename(f).rsplit('.', 1)[0].removesuffix('-660').removesuffix('-sq')
        if name not in ids:
            os.remove(f)
    for f in glob.glob(os.path.join(art, 'og', '*.jpg')):
        if os.path.basename(f).rsplit('.', 1)[0].removesuffix('-sq') not in card_ids:
            os.remove(f)
    json.dump({k: v for k, v in sorted(done.items()) if k in ids or k.removeprefix('og:') in card_ids}, open(done_file, 'w'), indent=1)

asyncio.run(main())
