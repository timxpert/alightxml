#!/usr/bin/env python3
"""Builds the Alight Motion compatibility probe: one scene whose layers each test one way of writing something.

Import samples/alight-probe/xmlcanvas-probe.xml in Alight Motion and note which lettered images appear.
Layer C points to the image from the user's real export (content://…/143949), so it only exists on that phone.
"""
import hashlib
import os
import time
import zipfile

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'samples', 'alight-probe')
os.makedirs(OUT, exist_ok=True)

COLORS = {'A': (124, 92, 255), 'B': (34, 170, 120), 'D': (230, 120, 40)}


def letter_png(letter, color):
    img = Image.new('RGB', (600, 600), color)
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=420)
    except TypeError:
        font = ImageFont.load_default()
    box = d.textbbox((0, 0), letter, font=font)
    d.text(((600 - (box[2] - box[0])) / 2 - box[0], (600 - (box[3] - box[1])) / 2 - box[1]), letter, fill=(255, 255, 255), font=font)
    d.rectangle([8, 8, 591, 591], outline=(255, 255, 255), width=8)
    path = f'/tmp/probe-{letter}.png'
    img.save(path, 'PNG')
    with open(path, 'rb') as f:
        return f.read()


pngs = {k: letter_png(k, c) for k, c in COLORS.items()}
sig_a = hashlib.sha256(pngs['A']).hexdigest()[:32]
files = {
    'A': f'{sig_a}.png',
    'B': 'xmlcanvas-probe-b.png',
    'D': 'xmlcanvas-probe-d.png',
}
uris = {
    'A': f'am-internal:///{files["A"]}',
    'B': f'file:///storage/emulated/0/Download/{files["B"]}',
    'C': 'content://media/external/images/media/143949',
    'D': files['D'],
}
now = int(time.time() * 1000)
T = 10000


def media(k):
    if k == 'C':
        return f'  <media uri="{uris[k]}" filename="picture-ok.png" title="picture-ok.png" type="image/png" size="11668" orientation="0" infoUpdated="{now}" width="600" height="600" />'
    return f'  <media uri="{uris[k]}" filename="{files[k]}" title="{files[k]}" type="image/png" size="{len(pngs[k])}" orientation="0" infoUpdated="{now}" width="600" height="600" />'


ids = iter(range(700000001, 700000100))


def tr(x, y, sx=None, sy=None):
    s = f'    <transform>\n      <location value="{x:.6f},{y:.6f},0.000000" />\n'
    if sx is not None:
        s += f'      <scale value="{sx:.6f},{sy:.6f}" />\n'
    return s + '    </transform>\n'


def image(k, x, y):
    return (f'  <shape id="{next(ids)}" label="{k} image" startTime="0" endTime="{T}" fillType="media" fillImage="{uris[k]}" mediaFillMode="fill" s=".rect">\n'
            + tr(x, y) + '    <property name="size" type="vec2" value="420.000000,420.000000" />\n  </shape>\n')


def text(label, content, x, y, size=44, align='center', color='#ffffffff'):
    return (f'  <text id="{next(ids)}" label="{label}" startTime="0" endTime="{T}" fillType="color" size="{size}" font="googlefonts?name=Roboto&amp;weight=700" wrapWidth="900" align="{align}">\n'
            + tr(x, y) + f'    <fillColor value="{color}" />\n    <content>{content}</content>\n  </text>\n')


slots = {'A': (290, 560), 'B': (790, 560), 'C': (290, 1130), 'D': (790, 1130)}
desc = {'A': 'A · am-internal', 'B': 'B · Download path', 'C': 'C · your picture-ok', 'D': 'D · file name only'}
xml = ["<?xml version='1.0' encoding='UTF-8' ?><!--\nXML Canvas compatibility probe. Each lettered layer references its image differently.\n-->",
       f'<scene title="XML Canvas probe" width="1080" height="1920" exportWidth="1080" exportHeight="1920" precompose="dynamicResolution" bgcolor="#ff16161c" totalTime="{T}" fps="30" modifiedTime="{now}" amver="1028425" ffver="106" am="com.alightcreative.motion/5.0.273.1028425" amplatform="android" retime="freeze" retimeAdaptFPS="false">']
xml += [media(k) for k in 'ABCD']
body = f'  <shape id="{next(ids)}" label="Panel" startTime="0" endTime="{T}" fillType="color" mediaFillMode="fill" s=".rect">\n' + tr(540, 960, 10.0, 18.4) + '    <fillColor value="#ff23232b" />\n    <property name="size" type="vec2" value="100.000000,100.000000" />\n  </shape>\n'
body += text('Title', 'XML Canvas probe', 540, 190, 64)
for k, (x, y) in slots.items():
    body += image(k, x, y) + text(f'{k} label', desc[k], x, y + 260, 34)
body += (f'  <shape id="{next(ids)}" label="E ellipse (contour)" startTime="0" endTime="{T}" fillType="color" mediaFillMode="fill">\n' + tr(290, 1640)
         + '    <fillColor value="#ffffcc66" />\n    <parameter>\n      <contour d="M150,0 C150,55.228 82.843,100 0,100 C-82.843,100 -150,55.228 -150,0 C-150,-55.228 -82.843,-100 0,-100 C82.843,-100 150,-55.228 150,0 Z" />\n    </parameter>\n  </shape>\n')
body += (f'  <shape id="{next(ids)}" label="F gradient" startTime="0" endTime="{T}" fillType="gradient" mediaFillMode="fill" s=".rect">\n' + tr(790, 1640, 4.0, 2.0)
         + '    <fillColor value="#ff8b6cff" />\n    <gradient type="linear" startColor="#ff8b6cff" endColor="#ffff5a1f" start="0.000000,0.000000" end="1.000000,0.000000" />\n    <property name="size" type="vec2" value="100.000000,100.000000" />\n  </shape>\n')
body += text('E label', 'E · ellipse', 290, 1800, 34) + text('F label', 'F · gradient', 790, 1800, 34)
xml.append(body.rstrip('\n'))
xml.append('</scene>\n')
probe = '\n'.join(xml)

with open(os.path.join(OUT, 'xmlcanvas-probe.xml'), 'w', encoding='utf-8') as f:
    f.write(probe)
for k in 'ABD':
    with open(os.path.join(OUT, files[k]), 'wb') as f:
        f.write(pngs[k])
readme = f"""XML Canvas → Alight Motion probe

1. Copy ALL files in this folder to your phone's Download folder (directly in Download, not a subfolder):
   xmlcanvas-probe.xml, {files['B']}, {files['D']}, {files['A']}
2. In Alight Motion, import xmlcanvas-probe.xml.
3. Report what you see:
   - Which lettered images show: A, B, C, D (and whether the app asks to replace missing media)
   - Do the title and the labels show as text? Correct size/position?
   - E: is there a yellow ellipse? F: is there a purple→orange gradient bar?
   - Is everything centred where expected (2×2 grid of images)?

What each tests:
  A  am-internal:///{files['A']}  (packaged media name, what XML Canvas exports now)
  B  file:///storage/emulated/0/Download/{files['B']}
  C  content://media/external/images/media/143949  (your own picture-ok.png from the real export; control)
  D  {files['D']}  (bare file name next to the XML)
"""
with open(os.path.join(OUT, 'README.txt'), 'w') as f:
    f.write(readme)
with zipfile.ZipFile(os.path.join(ROOT, 'public', 'xmlcanvas-alight-probe.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for name in sorted(os.listdir(OUT)):
        z.write(os.path.join(OUT, name), name)
print('probe written to', OUT)
