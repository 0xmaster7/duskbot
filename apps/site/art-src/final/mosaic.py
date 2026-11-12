# small bots built from tiny tiles, for the card rows
import math, random, colorsys
from PIL import Image, ImageDraw
S, N, C = 720, 14, 6
def mask(shape):
    m = Image.new('L', (S, S), 0); d = ImageDraw.Draw(m); s = S / 100
    P = lambda pts: [(x * s, y * s) for x, y in pts]
    if shape == 'circle': d.ellipse(P([(5, 5), (95, 95)]), fill=255)
    if shape == 'clover':
        for cx, cy in [(31, 31), (69, 31), (31, 69), (69, 69)]: d.ellipse(P([(cx - 25, cy - 25), (cx + 25, cy + 25)]), fill=255)
        d.rectangle(P([(28, 28), (72, 72)]), fill=255)
    if shape == 'hex': d.polygon(P([(4, 50), (27, 10), (73, 10), (96, 50), (73, 90), (27, 90)]), fill=255)
    if shape == 'star':
        pts = [(50 + (47 if i % 2 == 0 else 26) * math.cos(math.pi / 5 * i - math.pi / 2), 53 + (47 if i % 2 == 0 else 26) * math.sin(math.pi / 5 * i - math.pi / 2)) for i in range(10)]
        d.polygon(P(pts), fill=255)
    if shape == 'heart':
        pts = [(50 + 2.9 * 16 * math.sin(t) ** 3, 46 - 2.9 * (13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))) for t in [i * math.pi / 60 for i in range(120)]]
        d.polygon(P(pts), fill=255)
    if shape == 'drop':
        d.ellipse(P([(14, 28), (86, 96)]), fill=255); d.polygon(P([(50, 3), (20, 48), (80, 48)]), fill=255)
    return m.resize((N, N), Image.BOX)
def bot(shape, hexcol, eye_row, seed):
    random.seed(seed); m = mask(shape)
    r, g, b = [int(hexcol[i:i + 2], 16) / 255 for i in (1, 3, 5)]; h, l, s = colorsys.rgb_to_hls(r, g, b)
    im = Image.new('RGBA', (N * C, N * C), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for y in range(N):
        for x in range(N):
            if m.getpixel((x, y)) < 120: continue
            eye = eye_row <= y < eye_row + 3 and x in (5, 8)
            ll = 0.12 + random.uniform(0, 0.05) if eye else min(0.92, max(0.1, l + random.choice([-0.07, -0.03, 0, 0, 0.03, 0.07])))
            col = tuple(int(v * 255) for v in colorsys.hls_to_rgb(h, ll, 0.15 if eye else s))
            d.rectangle((x * C, y * C, x * C + C - 1, y * C + C - 1), fill=col + (255,))
    im.save(f'icons/{shape}.png')
for i, (shape, col, row) in enumerate([('circle', '#4f8df5', 5), ('clover', '#9a7bf0', 5), ('hex', '#f58a3c', 5), ('star', '#35b56a', 6), ('heart', '#f0649a', 4), ('drop', '#f2c530', 7)]): bot(shape, col, row, i)
