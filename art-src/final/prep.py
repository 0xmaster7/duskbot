# turns the chosen pictures into the web assets in public/landing/art
import random, shutil
from PIL import Image
OUT = '../../public/landing/art/'
def save(im, name, w, q=86):
    if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(OUT + name + '.webp', quality=q, method=6); return im.size
rgb = lambda n: Image.open(n + '.png').convert('RGB')
for src, name in [('hero-peaks', 'hero-peaks'), ('r09-dunes', 'dunes'), ('r03-birches', 'birches'), ('r05-white-cliffs', 'cliffs'), ('r17-islands', 'islands'), ('r02-terraces', 'terraces')]: print(name, save(rgb(src), name, 1086))
for n in ['wide-layers', 'wide-sails', 'wide-meadow']: print(n, save(rgb(n), n, 1536))
m = rgb('wide-meadow'); print('meadow-crop', save(m.crop((0, 300, 1536, 940)), 'meadow-crop', 1536))
cat = Image.open('cat.png').convert('RGBA'); cat = cat.crop(cat.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox()); print('cat', save(cat, 'cat', 600, 90))
og = rgb('wide-layers'); og.crop((0, 110, 1536, 916)).resize((1200, 630), Image.LANCZOS).save(OUT + 'og.jpg', quality=86)
for s in ['circle', 'star', 'heart', 'clover']: shutil.copy(f'icons/{s}.png', OUT + f'm-{s}.png')
# white pixels thickening downward, so the last picture breaks up into the footer
random.seed(7); cols, rows = 96, 10
d = Image.new('RGBA', (cols, rows), (0, 0, 0, 0))
for y in range(rows):
    p = ((y + 1) / rows) ** 1.6
    for x in range(cols):
        if random.random() < p: d.putpixel((x, y), (255, 255, 255, 255))
d.save(OUT + 'dissolve.png')
