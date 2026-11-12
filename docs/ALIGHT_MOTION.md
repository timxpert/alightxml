# Alight Motion output

## Sources used

1. **Real exported project XML** (public samples from Alight Motion 4.0.3–5.0.272) for the scene header attributes, `.rect` shapes with `location`/`scale`, `#aarrggbb` colours, `<kf>` keyframes, `<gradient>`, and groups written as `<embedScene>` containing a nested `<scene>`.
2. **Community reference generated from the decompiled app**, [kuchingneko28/alight-motion-docs](https://github.com/kuchingneko28/alight-motion-docs) (`docs/authoring.md`, format 106 / app 5.0.273), for element tags, ID allocation, the 100×100 `.rect` template, imported-shape contours, text attributes, `<media>` declarations and `<sig>.<ext>` packaging.
3. The [bevy_alight_motion](https://bli-aik.github.io/bevy_alight_motion/) project, which reads `.amproj` files as ZIP archives containing the scene XML.

Every rule the writer applies is listed in `src/core/alight/rules.ts` with its provenance, and appears in each compatibility report.

## Evidence from a real export (Alight Motion 5.0.273, 2026-11-12)

`samples/alight/real-export-5.0.273.xml` (one rectangle, one image) established:

- Rectangles: `<shape s=".rect" mediaFillMode="fill">` with `<property name="size" type="vec2" value="100,100"/>` after the fill, sized by `scale` (5.4, 9.6 → 540 × 960).
- Images: `fillType="media"`, `fillImage` = the media uri, `size` property = the image's base size, uniform `scale`.
- `<media uri filename title type size orientation="0" infoUpdated width height/>`, with **no `sig`**.
- Images are referenced by the phone's gallery address (`content://media/external/images/media/…`), so the image is not in the XML and only exists on the phone that exported it.
- Layer ids are not ordered; file order is the stacking order.

A tool-made file that embedded its image as a `data:` URI imported without the image showing, so `data:` media is not used.

**Open question:** which image reference loads in an imported XML on another phone. Run the probe (`samples/alight-probe/`, also `public/xmlcanvas-alight-probe.zip`).

## Mapping

| Source | Alight Motion | Provenance |
|---|---|---|
| Canvas size, duration, fps, background | `<scene width height exportWidth exportHeight totalTime fps bgcolor …>` | observed |
| Axis-aligned rectangle | `<shape s=".rect">` + size property 100,100, scale = size/100, location = centre | observed (real export) |
| Circle, ellipse, rounded/skewed rect, polygon, path | `<shape>` + `<parameter><contour d="M/L/C/Z…"/></parameter>` | documented; coordinate space **assumed** |
| Image | `.rect` with `fillType="media" fillImage="am-internal:///SIG.ext" mediaFillMode="fill"`, size property = drawn size | structure observed; `am-internal` reference **assumed** (see probe) |
| Text | `<text size font="googlefonts?name=…&weight=…" wrapWidth align>` + `<content>` | documented; anchoring **assumed** |
| Group | `<embedScene fillType="intrinsic">` with a full-canvas nested `<scene>` | observed |
| Solid / linear / radial fill | `<fillColor>` / `<gradient type startColor endColor start end>` (two colours) | observed; start/end space **assumed** |
| Position, scale, rotation, opacity | `<transform>` children | observed; rotation sign **assumed** |
| Animation | `<kf t v>` with `t` normalised to the layer duration; rotations sampled every ≤15° | observed (conflicts with the reference, which says seconds) |
| Media | `<media uri filename title type size orientation infoUpdated width height>`; file packaged as `SIG.ext` | attributes observed; packaging **assumed** |

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
