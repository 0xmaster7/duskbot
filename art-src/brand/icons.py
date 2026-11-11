# every size of the brand mark the site uses, from one file. to change the logo: replace mark.png beside this script
# (a square png with a clear background, 512 px or more is best), run `python3 art-src/brand/icons.py`, then the build.
import os
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
site = os.path.join(here, '..', '..', 'public', 'landing')
mark = Image.open(os.path.join(here, 'mark.png')).convert('RGBA')
mark = mark.crop(mark.getbbox())
side = max(mark.size)
sq = Image.new('RGBA', (side, side), (0, 0, 0, 0)); sq.alpha_composite(mark, ((side - mark.width) // 2, (side - mark.height) // 2))

def fit(size, scale=1.0, bg=None):
    im = Image.new('RGBA', (size, size), bg or (0, 0, 0, 0))
    m = sq.resize((round(size * scale),) * 2, Image.LANCZOS)
    im.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return im

white = (255, 255, 255, 255)
os.makedirs(os.path.join(site, 'brand'), exist_ok=True)
fit(88).save(os.path.join(site, 'art', 'cursor-88.webp'), quality=92, method=6)                 # the header, the footer, the home page
fit(48, 0.92).save(os.path.join(site, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
fit(180, 0.66, white).convert('RGB').save(os.path.join(site, 'art', 'apple-touch-icon.png'), optimize=True)
fit(192, 0.7, white).convert('RGB').save(os.path.join(site, 'art', 'icon-192.png'), optimize=True)
fit(512, 0.7, white).convert('RGB').save(os.path.join(site, 'art', 'icon-512.png'), optimize=True)
fit(512, 0.52, white).convert('RGB').save(os.path.join(site, 'art', 'icon-maskable-512.png'), optimize=True)
fit(1024, 0.94).save(os.path.join(site, 'brand', 'dusk-bot-mark.png'), optimize=True)             # the brand page's download
fit(320, 0.94).save(os.path.join(site, 'art', 'mark-320.webp'), quality=92, method=6)            # the brand page's tiles
print('wrote the mark at every size')
