# turns the chosen pictures into the web assets in public/landing/art
import random, shutil
from PIL import Image
OUT = '../../public/landing/art/'
def save(im, name, w, q=86):
    if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(OUT + name + '.webp', quality=q, method=6); return im.size
rgb = lambda n: Image.open(n + '.png').convert('RGB')
print('terraces', save(rgb('r02-terraces'), 'terraces', 1086))
for n in ['wide-layers', 'wide-sails', 'wide-islands', 'end-meadow', 'price-sky']: print(n, save(rgb(n), n, 1536))
# sky straight onto trees and meadow, with the pale bands and the clouds left out, so the big $0 reads on white
em = rgb('end-meadow'); fill = Image.new('RGB', (1000, 640)); fill.paste(em.crop((270, 150, 1270, 510)), (0, 0)); fill.paste(em.crop((270, 650, 1270, 930)), (0, 360)); print('zero', save(fill, 'zero', 1000))
cat = Image.open('cat.png').convert('RGBA'); cat = cat.crop(cat.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox()); print('cat', save(cat, 'cat', 600, 90))
for n in ['s-computer', 's-notch', 's-clock', 's-notebook', 's-button', 's-phone']:
    im = Image.open(n + '.png').convert('RGBA'); im = im.crop(im.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox()); print(n, save(im, n, 520, 90))
og = rgb('wide-layers'); og.crop((0, 110, 1536, 916)).resize((1200, 630), Image.LANCZOS).save(OUT + 'og.jpg', quality=86)
for s in ['circle', 'star', 'heart', 'clover', 'hex', 'drop']: shutil.copy(f'icons/{s}.png', OUT + f'm-{s}.png')
# white pixels thickening downward, so the last picture breaks up into the footer
random.seed(7); cols, rows = 96, 10
d = Image.new('RGBA', (cols, rows), (0, 0, 0, 0))
for y in range(rows):
    p = ((y + 1) / rows) ** 1.6
    for x in range(cols):
        if random.random() < p: d.putpixel((x, y), (255, 255, 255, 255))
d.save(OUT + 'dissolve.png')
