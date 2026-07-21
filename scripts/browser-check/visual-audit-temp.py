from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import os

src = Path('scripts/browser-check/screenshots')
tmp = Path('scripts/browser-check/visual-audit-temp')
tmp.mkdir(exist_ok=True)

pages = [
    'boot','workbench','tutorial','monitor','history','knowledge','logs',
    'settings-general','settings-model','settings-appearance','settings-risk',
    'settings-ssh','settings-terminal','settings-decision','settings-about',
    'history-detail','knowledge-detail','decision-detail','tutorial-detail'
]

# use a fallback font for labels
try:
    font = ImageFont.truetype("arial.ttf", 20)
except Exception:
    font = ImageFont.load_default()

for page in pages:
    app = src / f'app-{page}.png'
    des = src / f'design-{page}.png'
    if not app.exists() or not des.exists():
        print(f'missing {page}')
        continue
    with Image.open(app) as a, Image.open(des) as d:
        # scale down if too wide to keep file size manageable (max width per side 1280)
        max_w = 1280
        scale_a = min(1.0, max_w / a.width)
        scale_d = min(1.0, max_w / d.width)
        a2 = a.resize((int(a.width*scale_a), int(a.height*scale_a)), Image.Resampling.LANCZOS)
        d2 = d.resize((int(d.width*scale_d), int(d.height*scale_d)), Image.Resampling.LANCZOS)
        label_h = 30
        total_w = a2.width + d2.width
        total_h = max(a2.height, d2.height) + label_h
        canvas = Image.new('RGB', (total_w, total_h), (30,30,30))
        draw = ImageDraw.Draw(canvas)
        # labels
        draw.text((10, 8), f'APP: {page}', fill=(200,200,200), font=font)
        draw.text((a2.width+10, 8), f'DESIGN: {page}', fill=(200,200,200), font=font)
        canvas.paste(a2, (0, label_h))
        canvas.paste(d2, (a2.width, label_h))
        # divider
        draw.line([(a2.width, label_h), (a2.width, total_h)], fill=(100,100,100), width=2)
        out = tmp / f'compare-{page}.png'
        canvas.save(out, 'PNG', optimize=True)
        print(out, canvas.size)
print('done')
