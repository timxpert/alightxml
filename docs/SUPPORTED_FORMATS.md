# Supported XML structures

Only structures listed here have been tested. Each has a sample in `samples/` and assertions in `tests/`.

## Detection

| Adapter | Detected when | Images found in | Layout / conversion |
|---|---|---|---|
| Alight Motion | root `<scene>` with `ffver` / `amver` | `<media uri>` and layer `fillImage` (`data:`, `content://` matched by the recorded file name, `am-internal:///` matched by name, URLs) | Canvas view (static, first keyframe); `.rect` with size × scale, contours, text, groups, gradients |
| SVG | root `<svg>` in `http://www.w3.org/2000/svg` (or with no namespace, with a warning) | `<image>` / `<feImage>` `href` or `xlink:href` | Yes: canvas + Alight Motion |
| FB2 | root `<FictionBook>` in the FictionBook 2.0 namespace | `<binary id content-type>` Base64, referenced by `<image l:href="#id">` | Images only |
| Android | any attribute in `http://schemas.android.com/apk/res/android` | attribute values `@drawable/…`, `@mipmap/…` (incl. `app:` attributes) | Images only |
| Office Open XML | root in WordprocessingML / PresentationML / SpreadsheetDrawing, or DrawingML present | `<a:blip r:embed / r:link>` resolved through `_rels/<part>.rels` | Images only |
| Generic | anything else | values only: `data:image/…` URIs, Base64 whose decoded header is an image, paths/URLs ending in an image extension | Images only |

For known schemas, the value-based sweep reports only `data:image` URIs, because the adapter already knows which attributes are references (e.g. Word's `<pic:cNvPr name="image.png">` is a label).

## Image resolution rules

| Reference | Resolution | Sample |
|---|---|---|
| Relative path | Against the XML file's folder. Exact match, or case-insensitive match with a warning. A file with the same name elsewhere is suggested but never used. | `svg-poster` (`photo.jpg`, `Badge.PNG`) |
| Absolute path / `file://` | Browsers cannot open it. Matched only by trailing path segments in the imported files, with a visible warning; ambiguous matches are refused. | `svg-poster` (`texture.png`) |
| Data URI (Base64 or percent-encoded) | Decoded; format checked against the bytes. | `svg-poster`, `catalog` |
| Raw Base64 | Decoded; declared type compared with the real format. | `fb2`, `catalog` |
| `http(s)://`, `//` | Not contacted until the user clicks **Load remote images**. Download for packaging needs CORS. | `svg-poster` (`venue-map.png`) |
| `@drawable/x`, `@mipmap/x` | `res/(drawable\|mipmap)*/x.(png\|jpg\|webp\|gif\|bmp\|xml)` next to the layout; highest-density bitmap wins; XML drawables are reported as unsupported; `@android:` framework resources are explained. | `android-app` |
| OOXML `r:embed` | Relationship target relative to the part; external targets treated as URLs. | `office/site-report.docx` |
| `content://`, `blob:`, `javascript:` | Refused with an explanation. | `security/active-content.svg` |

Formats are identified from magic bytes: PNG, JPEG, GIF, WebP (VP8/VP8L/VP8X), BMP, ICO, SVG, AVIF, HEIC, TIFF. Dimensions come from headers (SVG from width/height or viewBox). TIFF and HEIC are marked unsupported because most browsers cannot display them.

## SVG interpretation

Supported: `rect` (incl. rx/ry), `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path` (all commands; arcs and quadratics become cubics), `image` (preserveAspectRatio), `text` + `tspan` (multi-line via x/y/dy), `g`, `a`, `switch` (as group), nested `svg`, `use` (internal references incl. `symbol`), viewBox scaling, transforms (matrix/translate/scale/rotate/skew), presentation attributes, `style=""`, `<style>` with tag/#id/.class selectors, inheritance, opacity, fill-opacity, linear/radial gradients (units, gradientTransform, href inheritance), `animate` (opacity) and `animateTransform` (translate/rotate/scale) with numeric begin/dur, values/keyTimes.

Reported, not interpreted: `clip-path`, `mask`, `filter`, `pattern` fills, `foreignObject`, `textPath` (drawn straight), `animateMotion`, `set`, complex CSS selectors and at-rules, foreign-namespace metadata, `script` (never executed).

## Samples

| Sample | Expected result |
|---|---|
| `svg-poster/` | 7 images: 5 resolved (relative, xlink in a rotated group, data URI, case mismatch, absolute-path match), 1 missing (`assets/sponsor.png`), 1 remote. 18 Alight Motion layers; the remote/missing images and the stroke-only divider are reported as not converted. |
| `fb2/lighthouse.fb2` | Cover JPEG and emblem PNG decoded (the emblem's wrong `content-type` is flagged); `#figure-1.png` missing. |
| `android-app/` | `hero` from drawable-xxhdpi, `ic_launcher` WebP from mipmap; `bg_card` XML drawable unsupported; framework icon explained; `promo_banner` missing. `@+id/imageTitle` is not treated as an image. |
| `office/site-report.docx` | 2 images resolved through relationships; importing `document.xml` alone explains the missing `.rels`. |
| `catalog/` | Unknown schema: `<thumbnail>` path, `<photo>` Base64 and a data URI detected; `<imageCaption>`, `<imageCount>` and a PDF ignored; `notreally.png` rejected as plain text. |
| `security/` | XXE and billion-laughs parse safely with warnings; scripts never run. |
| `broken/` | Mismatched tag at line 8; unescaped `&` with a fix hint. |
| `alight/real-export-5.0.273.xml` | Real Alight Motion export: one `content://` image reported as stored on the exporting phone (resolved if a file with its recorded name is imported alongside); rectangle 540 × 960 and image 772.5 px drawn. |
| `alight/tool-made-data-uri.xml` | Tool-made scene with a `data:` image: decoded once; `filename` is not treated as a path. (On a device the image did not show in Alight Motion.) |
| `alight-probe/` | On-device probe: four image-reference methods (A–D), text, contour ellipse, gradient. |
