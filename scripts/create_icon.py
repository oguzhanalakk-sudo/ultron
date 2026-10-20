from pathlib import Path

from PIL import Image, ImageDraw


SIZE = 1024
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "build" / "icon.ico"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

gradient = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
pixels = gradient.load()
top = (29, 24, 39)
bottom = (112, 75, 160)
for y in range(SIZE):
    ratio = y / (SIZE - 1)
    color = tuple(round(a + (b - a) * ratio) for a, b in zip(top, bottom))
    for x in range(SIZE):
        pixels[x, y] = (*color, 255)

mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle((38, 38, SIZE - 38, SIZE - 38), radius=206, fill=255)
icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
icon.paste(gradient, (0, 0), mask)

draw = ImageDraw.Draw(icon)
draw.rounded_rectangle((39, 39, SIZE - 39, SIZE - 39), radius=205, outline=(224, 204, 255, 90), width=7)
draw.line([(408, 340), (312, 512), (408, 684)], fill=(246, 237, 255, 255), width=54, joint="curve")
draw.line([(477, 690), (551, 334)], fill=(211, 181, 252, 255), width=50, joint="curve")
draw.line([(616, 340), (712, 512), (616, 684)], fill=(246, 237, 255, 255), width=54, joint="curve")

icon.save(OUTPUT, format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
