# -*- coding: utf-8 -*-
"""앱 아이콘 생성. 고층 아파트 건물 픽토그램(몸체 + 창문 격자)을 그린다.

다있맵 공통 규칙: 면색 위에 흰 픽토그램, 그림자 없음.
maskable 은 안전 영역(중앙 80%) 안에 픽토그램이 들어가도록 더 작게 그린다.
shelter_map/tools/make_icons.py 와 같은 패턴(슈퍼샘플링 후 축소).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8")

ICONS = Path(__file__).resolve().parent.parent / "assets" / "icons"
SIGN = (122, 46, 56, 255)     # --sign #7A2E38
INK = (255, 255, 255, 255)
SS = 4                        # 슈퍼샘플링 배율


def draw_building(size, scale):
    """직사각형 몸체(흰색) + 3x5 창문 격자(면색으로 뚫어낸다)."""
    s = size * SS
    img = Image.new("RGBA", (s, s), SIGN)
    d = ImageDraw.Draw(img)

    cx, cy = s / 2, s / 2
    w = s * scale
    h = w * 1.35
    left, top = cx - w / 2, cy - h / 2
    right, bottom = cx + w / 2, cy + h / 2

    d.rectangle([left, top, right, bottom], fill=INK)

    cols, rows = 3, 5
    pad_x, pad_y = w * 0.14, h * 0.08
    gap = w * 0.09
    cell_w = (w - 2 * pad_x - (cols - 1) * gap) / cols
    cell_h = (h - 2 * pad_y - (rows - 1) * gap) / rows
    for r in range(rows):
        for c in range(cols):
            x0 = left + pad_x + c * (cell_w + gap)
            y0 = top + pad_y + r * (cell_h + gap)
            d.rectangle([x0, y0, x0 + cell_w, y0 + cell_h], fill=SIGN)

    return img.resize((size, size), Image.LANCZOS)


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    targets = [
        ("app-icon-192.png", 192, 0.56),
        ("app-icon-512.png", 512, 0.56),
        ("app-icon-apple-180.png", 180, 0.56),
        ("app-icon-maskable-512.png", 512, 0.42),
    ]
    for name, size, scale in targets:
        path = ICONS / name
        draw_building(size, scale).save(path, "PNG", optimize=True)
        print(f"저장: {path}")


if __name__ == "__main__":
    main()
