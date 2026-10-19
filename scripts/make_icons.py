"""產生 App 圖示：一把刻度尺穿過一隻冷靜的眼睛，指針停在偏右的位置。"""
import pathlib

from PIL import Image, ImageDraw

OUT = pathlib.Path(__file__).resolve().parent.parent / 'site' / 'icons'
BG_TOP = (21, 29, 39)
BG_BOT = (11, 15, 20)
ICE = (143, 205, 228)
ICE2 = (79, 176, 211)
TICK = (88, 108, 130)


def draw(size, maskable=False):
    S = 1024
    im = Image.new('RGB', (S, S), BG_BOT)
    px = im.load()
    for y in range(S):
        t = y / (S - 1)
        c = tuple(int(BG_TOP[k] * (1 - t) + BG_BOT[k] * t) for k in range(3))
        for x in range(S):
            px[x, y] = c
    d = ImageDraw.Draw(im)
    scale = 0.74 if maskable else 1.0
    cx, cy = S / 2, S / 2

    def sx(v):
        return cx + (v - S / 2) * scale

    def sy(v):
        return cy + (v - S / 2) * scale

    # 刻度尺
    y0 = 512
    d.line([(sx(150), sy(y0)), (sx(874), sy(y0))], fill=TICK, width=int(10 * scale))
    for k in range(0, 21):
        x = 150 + k * (724 / 20)
        h = 46 if k % 5 == 0 else 22
        col = ICE if k % 5 == 0 and k in (5, 15) else TICK
        d.line([(sx(x), sy(y0 - h)), (sx(x), sy(y0))], fill=col, width=int((9 if k % 5 == 0 else 6) * scale))
    # 眼睛外框（兩條弧線）
    box = [sx(230), sy(300), sx(794), sy(724)]
    d.arc(box, start=200, end=340, fill=ICE, width=int(22 * scale))
    d.arc(box, start=20, end=160, fill=ICE, width=int(22 * scale))
    # 虹膜與指針
    r = 112
    d.ellipse([sx(512 - r), sy(512 - r), sx(512 + r), sy(512 + r)], outline=ICE, width=int(20 * scale))
    nx = 596
    d.line([(sx(nx), sy(372)), (sx(nx), sy(612))], fill=ICE2, width=int(14 * scale))
    # 游標三角形（像量尺上的讀數記號）
    d.polygon([(sx(nx - 38), sy(318)), (sx(nx + 38), sy(318)), (sx(nx), sy(378))], fill=ICE2)
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
    draw(180, maskable=True).save(OUT / 'apple-touch-icon.png', optimize=True)
    draw(32).save(OUT / 'favicon-32.png', optimize=True)


if __name__ == '__main__':
    main()
