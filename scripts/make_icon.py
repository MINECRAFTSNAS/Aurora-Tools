"""生成 Aurora Tools 应用图标 (build/icon.ico)

设计：圆角方形底 + 极光青紫渐变 + 向下箭头（下载）叠音符圆点（音频提取），
与 Aurora Player 保持同一视觉语言。
"""
from PIL import Image, ImageDraw
import os
import math

S = 1024
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")
os.makedirs(OUT_DIR, exist_ok=True)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, radius, supersample=4):
    """带抗锯齿的圆角矩形遮罩"""
    big = size * supersample
    m = Image.new("L", (big, big), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, big - 1, big - 1], radius=radius * supersample, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def radial_bg(size):
    """对角渐变：左上极光青 -> 右下紫"""
    bg = Image.new("RGB", (size, size), (0, 0, 0))
    px = bg.load()
    c1 = (76, 194, 255)   # #4cc2ff
    c2 = (160, 108, 255)  # #a06cff
    for y in range(size):
        for x in range(size):
            # 45 度方向投影
            t = (x + y) / (2 * (size - 1))
            px[x, y] = lerp(c1, c2, t)
    return bg


def main():
    bg = radial_bg(S)
    mask = rounded_mask(S, int(S * 0.22))
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(bg, (0, 0), mask)

    d = ImageDraw.Draw(img, "RGBA")

    # ---- 下载箭头（描边风格，与 UI 图标一致）----
    cx = S / 2
    top = S * 0.22
    shaft_bottom = S * 0.60
    w = S * 0.072  # 线宽

    # 竖杆
    d.rounded_rectangle(
        [cx - w / 2, top, cx + w / 2, shaft_bottom],
        radius=w / 2,
        fill=(255, 255, 255, 245),
    )
    # 箭头两翼
    aw = S * 0.185  # 半宽
    ah = S * 0.175  # 高
    d.polygon(
        [
            (cx - aw, shaft_bottom - ah * 0.42),
            (cx, shaft_bottom + ah * 0.58),
            (cx + aw, shaft_bottom - ah * 0.42),
            (cx + aw * 0.42, shaft_bottom - ah * 0.42),
            (cx, shaft_bottom - ah * 0.42 + ah * 0.42),
            (cx - aw * 0.42, shaft_bottom - ah * 0.42),
        ],
        fill=(255, 255, 255, 245),
    )
    # 箭头尖收一下，避免过于方正
    d.polygon(
        [
            (cx - aw, shaft_bottom - ah * 0.42),
            (cx, shaft_bottom + ah * 0.62),
            (cx + aw, shaft_bottom - ah * 0.42),
        ],
        fill=(255, 255, 255, 245),
    )

    # ---- 底部音符（表示音频提取）----
    ny = S * 0.795
    nr = S * 0.055
    # 符头
    d.ellipse([cx - S * 0.115 - nr, ny - nr * 0.82, cx - S * 0.115 + nr, ny + nr * 0.82],
              fill=(255, 255, 255, 235))
    d.ellipse([cx + S * 0.115 - nr, ny - nr * 0.82, cx + S * 0.115 + nr, ny + nr * 0.82],
              fill=(255, 255, 255, 235))
    # 符杆
    st = S * 0.030
    d.rounded_rectangle([cx - S * 0.115 + nr - st, ny - S * 0.145, cx - S * 0.115 + nr, ny + nr * 0.3],
                        radius=st / 2, fill=(255, 255, 255, 235))
    d.rounded_rectangle([cx + S * 0.115 + nr - st, ny - S * 0.145, cx + S * 0.115 + nr, ny + nr * 0.3],
                        radius=st / 2, fill=(255, 255, 255, 235))
    # 符梁
    d.rounded_rectangle([cx - S * 0.115 + nr - st, ny - S * 0.145,
                         cx + S * 0.115 + nr, ny - S * 0.145 + S * 0.042],
                        radius=S * 0.012, fill=(255, 255, 255, 235))

    img.save(os.path.join(OUT_DIR, "icon.png"))

    # Pillow 的 ICO 写入器不可靠（实测只写出 1 帧），改为手工拼装 ICO：
    # 每个尺寸存为 PNG 帧（Vista+ 支持的 PNG 压缩 ICO），ICONDIR + 多个 ICONDIRENTRY。
    import struct
    import io

    sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    frames = []
    for s in sizes:
        buf = io.BytesIO()
        img.resize((s, s), Image.LANCZOS).save(buf, format="PNG", optimize=True)
        frames.append(buf.getvalue())

    header = struct.pack("<HHH", 0, 1, len(sizes))  # reserved, type=icon, count
    offset = len(header) + 16 * len(sizes)
    entries = b""
    for s, data in zip(sizes, frames):
        dim = 0 if s >= 256 else s  # 256 用 0 表示
        entries += struct.pack(
            "<BBBBHHII",
            dim, dim, 0, 0, 1, 32, len(data), offset
        )
        offset += len(data)

    ico_path = os.path.join(OUT_DIR, "icon.ico")
    with open(ico_path, "wb") as f:
        f.write(header + entries + b"".join(frames))

    print("wrote", ico_path, os.path.getsize(ico_path), "bytes")
    for s, data in zip(sizes, frames):
        print(f"  {s}x{s}  ({len(data)} bytes)")


if __name__ == "__main__":
    main()
