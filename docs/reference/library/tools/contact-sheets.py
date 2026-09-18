"""Full visual index: every gameplay frame onto labelled contact sheets."""
import os, re
from PIL import Image, ImageDraw
from collections import defaultdict

G = r"C:\Users\david\Desktop\stuff\nuketown\docs\reference\gameplay"
S = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(S, "index")
os.makedirs(OUT, exist_ok=True)

COLS, ROWS = 10, 6
CW, CH = 192, 108
LAB = 13

files = sorted(f for f in os.listdir(G) if f.endswith(".jpg"))
by = defaultdict(list)
for f in files:
    by[re.sub(r"-\d+\.jpg$", "", f)].append(f)

made = []
for clip, names in sorted(by.items()):
    per = COLS * ROWS
    for si in range(0, len(names), per):
        chunk = names[si:si + per]
        rows = (len(chunk) + COLS - 1) // COLS
        canvas = Image.new("RGB", (COLS * CW, rows * (CH + LAB)), (16, 16, 18))
        d = ImageDraw.Draw(canvas)
        for i, n in enumerate(chunk):
            im = Image.open(os.path.join(G, n)).convert("RGB")
            im.thumbnail((CW, CH), Image.BILINEAR)
            x = (i % COLS) * CW
            y = (i // COLS) * (CH + LAB)
            canvas.paste(im, (x + (CW - im.width) // 2, y + (CH - im.height) // 2))
            num = n.rsplit("-", 1)[1].replace(".jpg", "")
            d.rectangle([x, y + CH, x + CW, y + CH + LAB], fill=(0, 0, 0))
            d.text((x + 2, y + CH + 1), num, fill=(250, 230, 100))
        out = os.path.join(OUT, "%s_%03d.png" % (clip, si // per + 1))
        canvas.save(out)
        made.append((out, clip, chunk[0], chunk[-1], len(chunk)))

for m in made:
    print("%-70s %s .. %s (%d)" % (os.path.basename(m[0]), m[2], m[3], m[4]))
print("sheets:", len(made))
