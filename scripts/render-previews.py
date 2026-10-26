"""Render real OpenTUI captureSpans output as PNGs; no browser required."""
import json
import subprocess
import unicodedata
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent / 'previews'
font_path = subprocess.check_output(['fc-match', '-f', '%{file}', 'DejaVu Sans Mono'], text=True)
bold_path = subprocess.check_output(['fc-match', '-f', '%{file}', 'DejaVu Sans Mono:style=Bold'], text=True)
fonts = [ImageFont.truetype(font_path, 16), ImageFont.truetype(bold_path, 16)]
hebrew_font_path = subprocess.check_output(['fc-match', '-f', '%{file}', 'DejaVu Sans:charset=05d0'], text=True)
hebrew_font = ImageFont.truetype(hebrew_font_path, 16)
cell, line_height = 10, 23
def color(raw):
    b = raw['buffer']
    return tuple(b[str(i)] for i in range(3))
for mode in sys.argv[1:] or ['workspace', 'workspace-atlas', 'workspace-focus', 'study', 'reader', 'atlas']:
    capture = json.loads((root / f'{mode}.json').read_text())
    image = Image.new('RGB', (capture['cols'] * cell, capture['rows'] * line_height))
    draw = ImageDraw.Draw(image)
    for row, line in enumerate(capture['lines']):
        column = 0
        for span in line['spans']:
            x, y = column * cell, row * line_height
            draw.rectangle((x, y, x + span['width'] * cell, y + line_height), fill=color(span['bg']))
            cursor = column
            clusters = []
            for char in span['text']:
                if unicodedata.combining(char) and clusters: clusters[-1] += char
                else: clusters.append(char)
            for cluster in clusters:
                font = hebrew_font if any('\u0590' <= c <= '\u05ff' for c in cluster) else fonts[int(bool(span['attributes'] & 1))]
                draw.text((cursor * cell, y + 2), cluster, font=font, fill=color(span['fg']))
                if not unicodedata.combining(cluster[0]): cursor += 2 if unicodedata.east_asian_width(cluster[0]) in ['W', 'F'] else 1
            column += span['width']
    image.save(root / f'{mode}.png')
    print(root / f'{mode}.png')
