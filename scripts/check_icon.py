"""校验 build/icon.ico 的像素内容是否符合设计（无法肉眼看图时的程序化验证）"""
from PIL import Image

im = Image.open("build/icon.ico")
im.size = (256, 256)
im.load()
im = im.convert("RGBA")
W, H = im.size
px = im.load()
fails = []


def check(name, ok, detail):
    print(f"{'PASS' if ok else 'FAIL'}  {name} :: {detail}")
    if not ok:
        fails.append(name)


# 1. 圆角外应为透明
for k, (x, y) in {"左上": (3, 3), "右上": (W - 4, 3), "左下": (3, H - 4), "右下": (W - 4, H - 4)}.items():
    a = px[x, y][3]
    check(f"圆角外透明 ({k})", a < 40, f"alpha={a}")

# 2. 中心为不透明渐变底
cx, cy = W // 2, H // 2
r, g, b, a = px[cx, cy]
check("中心不透明", a > 200, f"rgba=({r},{g},{b},{a})")

# 3. 渐变方向：左上偏青（#4cc2ff 蓝>绿>红）、右下偏紫（#a06cff 蓝>红>绿）
#    采样点需避开白色笔画，故取贴近边缘但因圆角仍在内侧的角落
tl = px[int(W * 0.10), int(H * 0.30)]
br = px[int(W * 0.90), int(H * 0.72)]
# 左上：青色调 -> 绿通道明显高于红
check("渐变左上偏青", tl[1] - tl[0] > 40, f"rgba={tl} g-r={tl[1] - tl[0]}")
# 右下：紫色调 -> 红通道明显高于绿
check("渐变右下偏紫", br[0] - br[1] > 10, f"rgba={br} r-g={br[0] - br[1]}")
# 整体确有渐变（两端颜色不同）
diff = sum(abs(tl[i] - br[i]) for i in range(3))
check("两端颜色确有差异（渐变生效）", diff > 30, f"曼哈顿距离={diff}")

# 4. 白色笔画存在且占比合理
white = opaque = 0
for y in range(0, H, 2):
    for x in range(0, W, 2):
        rr, gg, bb, aa = px[x, y]
        if aa > 128:
            opaque += 1
            if rr > 230 and gg > 230 and bb > 230:
                white += 1
pct = 100 * white / opaque if opaque else 0
check("白色笔画占比合理", 4 < pct < 40, f"{pct:.1f}%")

# 5. 上中部（箭头竖杆）应为白
sp = px[cx, int(H * 0.30)]
check("箭头竖杆为白", min(sp[:3]) > 200 and sp[3] > 200, f"rgba={sp}")

# 6. 底部音符行应有白色像素
row = int(H * 0.80)
cols = sum(1 for x in range(int(W * 0.20), int(W * 0.80)) if px[x, row][3] > 128 and min(px[x, row][:3]) > 200)
check("底部音符存在", cols > 0, f"{cols} 个白色像素")

# 7. 各尺寸帧均可解码
sizes = sorted(Image.open("build/icon.ico").info.get("sizes", []))
check("ICO 含 10 个尺寸", len(sizes) == 10, str(sizes))

print(f"\n=== {'全部通过' if not fails else '失败: ' + ', '.join(fails)} ===")
raise SystemExit(1 if fails else 0)
