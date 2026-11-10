# turns the chosen pictures into the web assets in public/landing/art
import random, shutil
import numpy as np
from PIL import Image
OUT = '../../public/landing/art/'
def save(im, name, w, q=86):
    if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(OUT + name + '.webp', quality=q, method=6); return im.size
# takes the fine tick texture out of the sky and water with a sideways median, which leaves the pixel steps sharp; clouds, land and sparkles are untouched
def clean_sky(im, width=7):
    a = np.asarray(im).astype(np.int16); hsv = np.asarray(im.convert('HSV'))
    blue = (hsv[..., 0] >= 122) & (hsv[..., 0] <= 160) & (hsv[..., 1] > 40)
    p = np.pad(a, ((0, 0), (width // 2, width // 2), (0, 0)), mode='edge')
    flat = np.median(np.stack([p[:, i:i + a.shape[1]] for i in range(width)]), axis=0)
    return Image.fromarray(np.where(blue[..., None], flat, a).astype(np.uint8))
rgb = lambda n: clean_sky(Image.open(n + '.png').convert('RGB'))
print('terraces', save(rgb('r02-terraces'), 'terraces', 1086))
for n in ['hero-bg', 'wide-sails', 'wide-islands', 'end-meadow', 'price-sky']: print(n, save(rgb(n), n, 1536))
# sky straight onto trees and meadow, with the pale bands and the clouds left out, so the big $0 reads on white
em = rgb('end-meadow'); fill = Image.new('RGB', (1000, 640)); fill.paste(em.crop((270, 150, 1270, 510)), (0, 0)); fill.paste(em.crop((270, 650, 1270, 930)), (0, 360)); print('zero', save(fill, 'zero', 1000))
cat = Image.open('cat.png').convert('RGBA'); cat = cat.crop(cat.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox()); print('cat', save(cat, 'cat', 600, 90))
for n in ['s-computer', 's-clock', 's-notebook', 's-button', 's-phone']:
    im = Image.open(n + '.png').convert('RGBA'); im = im.crop(im.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox()); print(n, save(im, n, 520, 90))
for src, n in [('s-server', 's-server'), ('s-cloud', 's-cloud'), ('s-notch', 's-laptop')]:
    im = Image.open(src + '.png').convert('RGBA'); im = im.crop(im.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox()); print(n, save(im, n, 520, 90))
og = rgb('hero-bg'); og.crop((0, 218, 1536, 1024)).resize((1200, 630), Image.LANCZOS).save(OUT + 'og.jpg', quality=86)
for s in ['circle', 'star', 'heart', 'clover', 'hex', 'drop']: shutil.copy(f'icons/{s}.png', OUT + f'm-{s}.png')
# two small pixel clouds that drift across the skies
def cloud(under, name):
    rows = [(9, 15), (6, 18), (3, 21), (1, 23), (0, 24), (0, 24), (2, 22), (5, 9)]
    c = Image.new('RGBA', (24, 8), (0, 0, 0, 0))
    for y, (a, b) in enumerate(rows):
        for x in range(a, b): c.putpixel((x, y), (255, 252, 244, 255) if y < 5 else under)
    for x in range(14, 20): c.putpixel((x, 7), under)
    c.resize((240, 80), Image.NEAREST).save(OUT + name + '.png')
cloud((255, 190, 222, 255), 'cloud-pink'); cloud((255, 240, 120, 255), 'cloud-lemon')
# white pixels thickening downward, so the last picture breaks up into the footer
random.seed(7); cols, rows = 96, 10
d = Image.new('RGBA', (cols, rows), (0, 0, 0, 0))
for y in range(rows):
    p = ((y + 1) / rows) ** 1.6
    for x in range(cols):
        if random.random() < p: d.putpixel((x, y), (255, 255, 255, 255))
d.save(OUT + 'dissolve.png')
