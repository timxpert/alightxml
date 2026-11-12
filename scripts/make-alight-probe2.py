#!/usr/bin/env python3
"""Probe v2 for Alight Motion: checks the corrected size/text rules and tries six ellipse formats.

Copy every file in samples/alight-probe-2/ directly into the phone's Download folder, then import
xmlcanvas-probe-2.xml. Expected picture: four small squares exactly in the corners, a 1000 px bar,
a centred image, a rectangle tilted 20°, and as many yellow ellipses (E1–E6) as there are working formats.
"""
import os
import time
import zipfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'samples', 'alight-probe-2')
os.makedirs(OUT, exist_ok=True)
DL = '/storage/emulated/0/Download'
IMG = 'xmlcanvas-probe2-photo.png'
T = 10000
now = int(time.time() * 1000)

img = Image.new('RGB', (600, 400), (40, 120, 200))
d = ImageDraw.Draw(img)
try:
    font = ImageFont.load_default(size=120)
except TypeError:
    font = ImageFont.load_default()
d.rectangle([6, 6, 593, 393], outline=(255, 255, 255), width=12)
d.text((300, 200), '600x400', fill=(255, 255, 255), font=font, anchor='mm')
img.save(os.path.join(OUT, IMG), 'PNG')
img_size = os.path.getsize(os.path.join(OUT, IMG))

ids = iter(range(800000001, 800000200))
f6 = lambda v: f'{v:.6f}'


def tr(x, y, sx=None, sy=None, rot=None):
    s = f'    <transform>\n      <location value="{f6(x)},{f6(y)},0.000000" />\n'
    if sx is not None:
        s += f'      <scale value="{f6(sx)},{f6(sy)}" />\n'
    if rot is not None:
        s += f'      <rotation value="{f6(rot)}" />\n'
    return s + '    </transform>\n'


def rect(label, cx, cy, w, h, color, rot=None):
    # verified: drawn size = 2 × size(100) × scale
    return (f'  <shape id="{next(ids)}" label="{label}" startTime="0" endTime="{T}" fillType="color" mediaFillMode="fill" s=".rect">\n'
            + tr(cx, cy, w / 200, h / 200, rot) + f'    <fillColor value="{color}" />\n    <property name="size" type="vec2" value="100.000000,100.000000" />\n  </shape>\n')


def text(label, content, x, y, px, color='#ffffffff'):
    # verified: size unit = short side / 360 px → ÷3 at 1080 wide
    return (f'  <text id="{next(ids)}" label="{label}" startTime="0" endTime="{T}" fillType="color" size="{round(px / 3)}" font="googlefonts?name=Roboto&amp;weight=700" wrapWidth="1000" align="center">\n'
            + tr(x, y) + f'    <fillColor value="{color}" />\n    <content>{content}</content>\n  </text>\n')


def template(label, slug, cx, cy, d=200):
    return (f'  <shape id="{next(ids)}" label="{label}" startTime="0" endTime="{T}" fillType="color" mediaFillMode="fill" s="{slug}">\n'
            + tr(cx, cy, d / 200, d / 200) + '    <fillColor value="#ffffcc33" />\n    <property name="size" type="vec2" value="100.000000,100.000000" />\n  </shape>\n')


K = 0.5522847498307936


def ellipse_d(r):
    k = K * r
    return (f'M{r},0 C{r},{k:.3f} {k:.3f},{r} 0,{r} C{-k:.3f},{r} {-r},{k:.3f} {-r},0 '
            f'C{-r},{-k:.3f} {-k:.3f},{-r} 0,{-r} C{k:.3f},{-r} {r},{-k:.3f} {r},0 Z')


def knots(r, relative):
    k = K * r
    pts = [((r, 0), (0, -k), (0, k)), ((0, r), (k, 0), (-k, 0)), ((-r, 0), (0, k), (0, -k)), ((0, -r), (-k, 0), (k, 0))]
    out = []
    for (px, py), (ix, iy), (ox, oy) in pts:
        if relative:
            out.append(f'        <knot in="{f6(ix)},{f6(iy)}" p="{f6(px)},{f6(py)}" out="{f6(ox)},{f6(oy)}" />')
        else:
            out.append(f'        <knot in="{f6(px + ix)},{f6(py + iy)}" p="{f6(px)},{f6(py)}" out="{f6(px + ox)},{f6(py + oy)}" />')
    return '\n'.join(out)


def contour(label, cx, cy, inner):
    return (f'  <shape id="{next(ids)}" label="{label}" startTime="0" endTime="{T}" fillType="color" mediaFillMode="fill">\n'
            + tr(cx, cy) + f'    <fillColor value="#ffffcc33" />\n    <parameter>\n{inner}\n    </parameter>\n  </shape>\n')


body = ''
body += rect('Panel', 540, 960, 1080, 1920, '#ff1c1c24')
for i, (x, y) in enumerate([(60, 60), (1020, 60), (60, 1860), (1020, 1860)]):
    body += rect(f'Corner {i + 1} (80 px)', x, y, 80, 80, '#ffff5a1f')
body += text('Title', 'Probe 2', 540, 130, 72)
body += (f'  <shape id="{next(ids)}" label="Photo 600×400 → 480×320" startTime="0" endTime="{T}" fillType="media" fillImage="file://{DL}/{IMG}" mediaFillMode="fill" s=".rect">\n'
         + tr(300, 420) + '    <property name="size" type="vec2" value="240.000000,160.000000" />\n  </shape>\n')
body += rect('Rotated +20°', 800, 420, 300, 160, '#ff22aa78', rot=20)
body += text('Row 1 labels', 'Photo 480×320      Tilted +20°', 540, 650, 36)
body += text('Text check', 'This line is 60 px', 540, 800, 60)
body += rect('Ruler 1000 px', 540, 900, 1000, 10, '#ffffffff')
body += text('Ruler label', 'bar = 1000 px wide', 540, 960, 36)
for (label, slug), x in zip([('E1 .ellipse', '.ellipse'), ('E2 .circle', '.circle'), ('E3 .oval', '.oval')], (200, 540, 880)):
    body += template(label, slug, x, 1220)
    body += text(f'{label} label', label.split(' ')[0] + ' ' + slug, x, 1380, 36)
body += contour('E4 contour closed', 200, 1600, f'      <contour closed="true" exclude="false" d="{ellipse_d(100)}" />')
body += contour('E5 knots absolute', 540, 1600, f'      <contour closed="true" exclude="false">\n{knots(100, False)}\n      </contour>')
body += contour('E6 knots relative', 880, 1600, f'      <contour closed="true" exclude="false">\n{knots(100, True)}\n      </contour>')
for label, x in (('E4 path', 200), ('E5 knots', 540), ('E6 knots rel', 880)):
    body += text(f'{label} label', label, x, 1760, 36)

xml = ("<?xml version='1.0' encoding='UTF-8' ?><!--\nXML Canvas compatibility probe 2.\n-->\n"
       f'<scene title="XML Canvas probe 2" width="1080" height="1920" exportWidth="1080" exportHeight="1920" precompose="dynamicResolution" bgcolor="#ff000000" totalTime="{T}" fps="30" modifiedTime="{now}" amver="1028425" ffver="106" am="com.alightcreative.motion/5.0.273.1028425" amplatform="android" retime="freeze" retimeAdaptFPS="false">\n'
       f'  <media uri="file://{DL}/{IMG}" filename="{IMG}" title="{IMG}" type="image/png" size="{img_size}" orientation="0" infoUpdated="{now}" width="600" height="400" />\n'
       + body + '</scene>\n')
with open(os.path.join(OUT, 'xmlcanvas-probe-2.xml'), 'w', encoding='utf-8') as f:
    f.write(xml)
with open(os.path.join(OUT, 'README.txt'), 'w') as f:
    f.write(f"""XML Canvas → Alight Motion probe 2

1. Copy BOTH files directly into your phone's Download folder: xmlcanvas-probe-2.xml and {IMG}
2. Import xmlcanvas-probe-2.xml in Alight Motion and take a screenshot of the canvas.

What you should see if the size fixes are right:
  - four small orange squares exactly in the corners (20 px from each edge)
  - a white bar 1000 px wide (almost the full width) under "This line is 60 px"
  - a blue 600×400 photo on the left, a green rectangle on the right tilted 20°
  - text roughly the size in its label (titles not wrapping)
Which yellow ellipses show (E1–E6) tells which ellipse format works. Is the green rectangle tilted clockwise or anticlockwise?
""")
with zipfile.ZipFile(os.path.join(ROOT, 'public', 'xmlcanvas-alight-probe-2.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for name in sorted(os.listdir(OUT)):
        z.write(os.path.join(OUT, name), name)
print('probe 2 written to', OUT)
