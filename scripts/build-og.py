"""Build og.png from azzletype.png for Open Graph previews."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (255, 255, 255)
ACCENT = (0, 200, 150)
MUTED = (82, 82, 91)
GRID = (228, 228, 231)
PLUS = (212, 212, 216)

img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

step = 48
for x in range(0, W, step):
    draw.line([(x, 0), (x, H)], fill=GRID, width=1)
for y in range(0, H, step):
    draw.line([(0, y), (W, y)], fill=GRID, width=1)
for x in range(0, W, step):
    for y in range(0, H, step):
        draw.text((x + 2, y + 2), "+", fill=PLUS)

draw.rectangle([0, 0, 3, H], fill=ACCENT)
draw.rectangle([0, H - 3, W, H], fill=ACCENT)

logo = Image.open("azzletype.png").convert("RGBA")
target_w = 760
scale = target_w / logo.width
target_h = int(logo.height * scale)
logo = logo.resize((target_w, target_h), Image.LANCZOS)
lx = (W - target_w) // 2
ly = 150
img.paste(logo, (lx, ly), logo)

try:
    tag_font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 28)
    live_font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 22)
except OSError:
    tag_font = ImageFont.load_default()
    live_font = ImageFont.load_default()

tag = "Task coordination for onchain AI agents"
tag_bbox = draw.textbbox((0, 0), tag, font=tag_font)
tag_w = tag_bbox[2] - tag_bbox[0]
draw.text(((W - tag_w) // 2, ly + target_h + 36), tag, fill=MUTED, font=tag_font)
draw.text((28, H - 44), "LIVE ON MAINNET", fill=ACCENT, font=live_font)

img.save("og.png", optimize=True)
print("wrote og.png")
