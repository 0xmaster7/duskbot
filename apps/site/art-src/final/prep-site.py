# turns the pictures drawn by gen.sh's site() part into the web assets the inner pages use (run from art-src/final)
import numpy as np
from PIL import Image
OUT = '../../public/landing/art/'
def save(im, name, w, q=86):
    if im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    im.save(OUT + name + '.webp', quality=q, method=6); return im.size
# the same sky clean-up as prep.py (kept here so running this file does not redo the home page's pictures)
def clean_sky(im, width=7):
    a = np.asarray(im).astype(np.int16); hsv = np.asarray(im.convert('HSV'))
    blue = (hsv[..., 0] >= 122) & (hsv[..., 0] <= 160) & (hsv[..., 1] > 40)
    p = np.pad(a, ((0, 0), (width // 2, width // 2), (0, 0)), mode='edge')
    flat = np.median(np.stack([p[:, i:i + a.shape[1]] for i in range(width)]), axis=0)
    return Image.fromarray(np.where(blue[..., None], flat, a).astype(np.uint8))

# page header strips: the lower five eighths of a wide picture, so the scene fills the strip and a little sky sits on top
for src, name in [('wide-birches', 'birches'), ('wide-cliffs', 'cliffs'), ('wide-dunes', 'dunes'), ('wide-pond', 'pond'), ('wide-falls', 'falls'),
                  ('wide-layers', 'layers'), ('wide-islands', 'islands'), ('price-sky', 'sky'), ('wide-lost', 'lost')]:
    im = clean_sky(Image.open(src + '.png').convert('RGB'))
    print('strip-' + name, save(im.crop((0, 384, 1536, 1024)), 'strip-' + name, 1536, 84))

# small objects, cut to their own edges
for n in ['s-parcel', 's-mailbox', 's-signpost', 's-key', 's-palette', 's-books', 's-map', 's-plug', 's-coins', 's-clock', 's-button', 's-server', 's-cloud']:
    im = Image.open(n + '.png').convert('RGBA'); im = im.crop(im.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox()); print(n, save(im, n, 420, 90))
# the pink phone from the home page's first device studies, for the phone app's page
im = Image.open('d-phone-a.png').convert('RGBA'); im = im.crop(im.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox()); print('s-mobile', save(im, 's-mobile', 300, 90))
