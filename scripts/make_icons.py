# -*- coding: utf-8 -*-
"""生成 PWA 图标 icon-192.png / icon-512.png（渐变圆角 + 白色对勾）"""
from PIL import Image, ImageDraw

OUT = "public"

def make(size, path):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # 渐变背景（近似：分块绘制渐变）
    for y in range(size):
        t = y / max(1, size - 1)
        r = int(79 + (124 - 79) * t)    # 79 -> 124
        g = int(70 + (58 - 70) * t)     # 70 -> 58
        b = int(229 + (237 - 229) * t)  # 229 -> 237
        d.line([(0, y), (size, y)], fill=(r, g, b, 255))
    # 圆角遮罩
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    r = int(size * 0.22)
    md.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    img.putalpha(mask)
    # 白色对勾
    d = ImageDraw.Draw(img)
    w = int(size * 0.16)
    pts = [
        (int(size * 0.24), int(size * 0.52)),
        (int(size * 0.43), int(size * 0.70)),
        (int(size * 0.76), int(size * 0.30)),
    ]
    d.line([pts[0], pts[1]], fill=(255, 255, 255, 255), width=w)
    d.line([pts[1], pts[2]], fill=(255, 255, 255, 255), width=w)
    # 圆头端点
    for p in pts:
        rp = w // 2
        d.ellipse([p[0]-rp, p[1]-rp, p[0]+rp, p[1]+rp], fill=(255, 255, 255, 255))
    img.save(path)
    print("saved", path, size)

make(512, OUT + "/icon-512.png")
make(192, OUT + "/icon-192.png")
