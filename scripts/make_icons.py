"""產生 App 圖示：「冷眼瞳」——極夜藍底上的一圈刻度、分段的資產環與瞄準十字，和 App 首頁的資產環同一套語言。"""
import math
import pathlib

from PIL import Image, ImageDraw, ImageFilter

OUT = pathlib.Path(__file__).resolve().parent.parent / 'site' / 'icons'
BG_TOP = (12, 27, 52)
BG_BOT = (5, 11, 22)
GLACIER = (92, 225, 255)
FROST = (234, 242, 255)
TICK = (52, 76, 112)
TICK_MAJOR = (116, 137, 170)
SEGS = [((57, 135, 229), 0.42), ((144, 133, 233), 0.24), ((217, 89, 38), 0.16), ((92, 225, 255), 0.18)]


def draw(size, maskable=False, scale=None):
    S = 2048
    im = Image.new('RGB', (S, S), BG_BOT)
    px = im.load()
    for y in range(S):
        t = y / (S - 1)
        c = tuple(int(BG_TOP[k] * (1 - t) + BG_BOT[k] * t) for k in range(3))
        for x in range(S):
            px[x, y] = c
    # 冰藍光暈
    glow = Image.new('L', (S, S), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse([S * 0.18, S * 0.14, S * 0.82, S * 0.78], fill=120)
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.09))
    im = Image.composite(Image.new('RGB', (S, S), (20, 88, 120)), im, glow)
    d = ImageDraw.Draw(im)
    if scale is None:
        scale = 0.78 if maskable else 1.0
    cx = cy = S / 2

    def P(r, a):
        return (cx + r * scale * math.cos(a), cy + r * scale * math.sin(a))

    # 外圈刻度
    for k in range(72):
        a = k / 72 * math.tau - math.pi / 2
        major = k % 6 == 0
        r1, r2 = (700 if major else 728), 770
        d.line([P(r1, a), P(r2, a)], fill=TICK_MAJOR if major else TICK, width=int((16 if major else 9) * scale))
    # 北方指標
    n = [P(800, -math.pi / 2 - 0.035), P(800, -math.pi / 2 + 0.035), P(740, -math.pi / 2)]
    d.polygon(n, fill=GLACIER)
    # 分段資產環
    R = 560
    w = int(118 * scale)
    box = [cx - R * scale, cy - R * scale, cx + R * scale, cy + R * scale]
    a0 = -90.0
    gap = 4.0
    for col, frac in SEGS:
        ang = frac * 360
        d.arc(box, start=a0 + gap / 2, end=a0 + ang - gap / 2, fill=col, width=w)
        a0 += ang
    # 內圈瞄準十字
    for k in range(4):
        a = k * math.pi / 2
        d.line([P(440, a), P(370, a)], fill=TICK_MAJOR, width=int(18 * scale))
    # 瞳孔
    r = 150 * scale
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=FROST)
    r2 = 72 * scale
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=BG_TOP)
    hl = 30 * scale
    d.ellipse([cx + 40 * scale - hl, cy - 70 * scale - hl, cx + 40 * scale + hl, cy - 70 * scale + hl], fill=GLACIER)
    if not maskable:
        mask = Image.new('L', (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
        im = Image.composite(im, Image.new('RGB', (S, S), BG_BOT), mask)
    return im.resize((size, size), Image.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    draw(192).save(OUT / 'icon-192.png', optimize=True)
    draw(512).save(OUT / 'icon-512.png', optimize=True)
    draw(512, maskable=True).save(OUT / 'icon-maskable-512.png', optimize=True)
    # iOS 會自己裁圓角，給滿版方形
    draw(180, maskable=True, scale=0.92).save(OUT / 'apple-touch-icon.png', optimize=True)
    draw(32).save(OUT / 'favicon-32.png', optimize=True)


if __name__ == '__main__':
    main()
