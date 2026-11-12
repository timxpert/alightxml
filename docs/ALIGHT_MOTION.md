# Alight Motion output

## Sources used

1. **Real exported project XML** (public samples from Alight Motion 4.0.3–5.0.272) for the scene header attributes, `.rect` shapes with `location`/`scale`, `#aarrggbb` colours, `<kf>` keyframes, `<gradient>`, and groups written as `<embedScene>` containing a nested `<scene>`.
2. **Community reference generated from the decompiled app**, [kuchingneko28/alight-motion-docs](https://github.com/kuchingneko28/alight-motion-docs) (`docs/authoring.md`, format 106 / app 5.0.273), for element tags, ID allocation, the 100×100 `.rect` template, imported-shape contours, text attributes, `<media>` declarations and `<sig>.<ext>` packaging.
3. The [bevy_alight_motion](https://bli-aik.github.io/bevy_alight_motion/) project, which reads `.amproj` files as ZIP archives containing the scene XML.

Every rule the writer applies is listed in `src/core/alight/rules.ts` with its provenance, and appears in each compatibility report.

## On-device verification (Alight Motion 5.0.273, Android, 2026-11-12)

Probe 1 (`samples/alight-probe/`) was imported on a phone. Every layer arrived as its own editable layer.

| Item | Result |
|---|---|
| Image as `file:///storage/emulated/0/Download/NAME` | ✅ shows |
| Image as the phone's own `content://…` | ✅ shows (same phone only) |
| Image as `am-internal:///NAME` | ❌ empty |
| Image as a bare file name | ❌ empty |
| Image as `data:` URI (separate tool-made file) | ❌ empty |
| `.rect` size | ✅ drawn **2 × size × scale** (size is a half-extent); the real export's size-100 / scale 5.4×9.6 rectangle is the full 1080 × 1920 canvas |
| Text | ✅ editable; size unit ≈ canvas short side / 360 px (÷3 at 1080 wide); location = block centre |
| Linear gradient | ✅ colours and direction correct |
| Vector contour (`<parameter><contour d>`) | ❌ layer created but empty |

Probe 2 (`samples/alight-probe-2/`) checks the corrected sizes and text, rotation direction, and tries six ellipse formats (`.ellipse`, `.circle`, `.oval`, contour with `closed`, knots absolute, knots relative).

## Evidence from a real export

`samples/alight/real-export-5.0.273.xml`: `.rect` layers with `<property name="size" type="vec2">`, `<media uri filename title type size orientation infoUpdated width height>` without `sig`, images referenced by `content://` (so not inside the XML), unordered layer ids (file order = stacking order).

## Mapping

| Source | Alight Motion | Provenance |
|---|---|---|
| Canvas size, duration, fps, background | `<scene width height exportWidth exportHeight totalTime fps bgcolor …>` | observed |
| Axis-aligned rectangle | `<shape s=".rect">` + size property 100,100, scale = width/200, location = centre | **verified** |
| Circle, ellipse, rounded/skewed rect, polygon, path | `<shape>` + `<parameter><contour d="M/L/C/Z…"/></parameter>` | **failed** on device (empty layer); probe 2 tests alternatives |
| Image | `.rect` with `fillType="media" fillImage="file:///storage/emulated/0/Download/NAME"`, size property = half the drawn size | **verified** (copy images into Download first) |
| Text | `<text size font="googlefonts?name=…&weight=…" wrapWidth align>` + `<content>`, size = px ÷ (short side/360) | **verified** at 1080 wide |
| Group | `<embedScene fillType="intrinsic">` with a full-canvas nested `<scene>` | observed |
| Solid / linear / radial fill | `<fillColor>` / `<gradient type startColor endColor start end>` (two colours) | **verified** (linear); radial untested |
| Position, scale, rotation, opacity | `<transform>` children | observed; rotation sign **assumed** |
| Animation | `<kf t v>` with `t` normalised to the layer duration; rotations sampled every ≤15° | observed (conflicts with the reference, which says seconds) |
| Media | `<media uri filename title type size orientation infoUpdated width height>`; files packaged as `name-xxxxxxxx.ext` | **verified** |

## Package

`<title>.am-package.zip` contains the scene XML, the media files named `SIG.ext`, `compatibility-report.md` and `.json`, `HOW-TO-IMPORT.txt`, and `source/<original>`.

This is **not** an Alight Motion Project Package. Project Packages (Alight links and QR codes) are created only by the app's cloud sharing, after a project is open in the app. XML Canvas does not produce or imitate Alight links.

## Test protocol

The success criterion is that a generated project opens in Alight Motion with every supported element as an independently editable layer. To check it:

1. Export the `svg-poster` sample package.
2. On an Android device with Alight Motion, import the `.xml` (open it with Alight Motion, or use the app's import option).
3. Record: does it import, do the media resolve or ask to be relinked, and for each layer: type, position, size, rotation, colour/gradient, text font and size, group nesting, and animation timing.
4. Compare against the "assumed" rules in the report and adjust `rules.ts` / `writer.ts`. Then change those rules' provenance to `observed`, citing the test.
5. Repeat on iOS.

Until step 3 passes, the app labels all output as untested.
