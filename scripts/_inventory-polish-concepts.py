"""Read-only source inventory and labelled thumbnail sheets for visual review."""
import hashlib, json, math
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
source = Path('C:/Users/david/Desktop/stuff/nuketown/docs/reference')
out = root / 'captures/concept-review-20260927'
out.mkdir(parents=True, exist_ok=True)
entries = []
for family in ('concept', 'concept2'):
    manifest = json.loads((root / 'docs/reference' / family / 'manifest.json').read_text(encoding='utf-8-sig'))
    named = {e.get('filename', e.get('file')): e for e in manifest['entries']}
    files = sorted(p for p in (source / family).iterdir() if p.suffix.lower() in ('.png', '.jpg', '.webp'))
    for p in files:
        with Image.open(p) as im: size = list(im.size)
        entry = named.get(p.name, {})
        entries.append(dict(family=family, file=p.name, source=str(p), sha256=hashlib.sha256(p.read_bytes()).hexdigest(), bytes=p.stat().st_size, size=size, manifestEntry=entry, claimState='VERIFIED filesystem/hash; visual review separately'))
for page in range(math.ceil(len(entries) / 28)):
    subset = entries[page*28:(page+1)*28]
    sheet = Image.new('RGB', (1600, 7*255), '#202225')
    draw = ImageDraw.Draw(sheet)
    for i, entry in enumerate(subset):
        x, y = i % 4 * 400, i // 4 * 255
        with Image.open(entry['source']) as im:
            im.thumbnail((394, 224))
            sheet.paste(im.convert('RGB'), (x+(400-im.width)//2, y))
        draw.text((x+4,y+228), entry['family']+'/'+entry['file'], fill='white')
    sheet.save(out / f'sheet-{page+1}.jpg', quality=90)
receipt = dict(sourceRepository='daveinturkey15-byte/atomic-acres (same restart fallback)', sourceRoot=str(source), imageCount=len(entries), entries=entries, sheets=[str(p) for p in sorted(out.glob('sheet-*.jpg'))], missingManifestFiles={family:[e.get('filename',e.get('file')) for e in json.loads((root/'docs/reference'/family/'manifest.json').read_text(encoding='utf-8-sig'))['entries'] if not (source/family/e.get('filename',e.get('file'))).exists()] for family in ('concept','concept2')})
dest = root / 'docs/assets/POLISH-CONCEPT-INVENTORY-2026-09-27.json'
dest.write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
print(json.dumps(dict(images=len(entries), sheets=receipt['sheets'], missing=receipt['missingManifestFiles'])))
