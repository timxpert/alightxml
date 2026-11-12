# Alight Motion output

## Sources used

1. **Real exported project XML** (public samples from Alight Motion 4.0.3–5.0.272) for the scene header attributes, `.rect` shapes with `location`/`scale`, `#aarrggbb` colours, `<kf>` keyframes, `<gradient>`, and groups written as `<embedScene>` containing a nested `<scene>`.
2. **Community reference generated from the decompiled app**, [kuchingneko28/alight-motion-docs](https://github.com/kuchingneko28/alight-motion-docs) (`docs/authoring.md`, format 106 / app 5.0.273), for element tags, ID allocation, the 100×100 `.rect` template, imported-shape contours, text attributes, `<media>` declarations and `<sig>.<ext>` packaging.
3. The [bevy_alight_motion](https://bli-aik.github.io/bevy_alight_motion/) project, which reads `.amproj` files as ZIP archives containing the scene XML.

Every rule the writer applies is listed in `src/core/alight/rules.ts` with its provenance, and appears in each compatibility report.

## Mapping

| Source | Alight Motion | Provenance |
|---|---|---|
| Canvas size, duration, fps, background | `<scene width height exportWidth exportHeight totalTime fps bgcolor …>` | observed |
| Axis-aligned rectangle | `<shape s=".rect">`, scale = size/100, location = centre | observed + documented |
| Circle, ellipse, rounded/skewed rect, polygon, path | `<shape>` + `<parameter><contour d="M/L/C/Z…"/></parameter>` | documented; coordinate space **assumed** |
| Image | `.rect` with `fillType="media" fillImage="am-internal:///SIG.ext" mediaFillMode="fill"`, sized to the image's aspect ratio | documented; fill-mode meaning **assumed** |
| Text | `<text size font="googlefonts?name=…&weight=…" wrapWidth align>` + `<content>` | documented; anchoring **assumed** |
| Group | `<embedScene fillType="intrinsic">` with a full-canvas nested `<scene>` | observed |
| Solid / linear / radial fill | `<fillColor>` / `<gradient type startColor endColor start end>` (two colours) | observed; start/end space **assumed** |
| Position, scale, rotation, opacity | `<transform>` children | observed; rotation sign **assumed** |
| Animation | `<kf t v>` with `t` normalised to the layer duration; rotations sampled every ≤15° | observed (conflicts with the reference, which says seconds) |
| Media | `<media uri filename title type size sig width height>`; file packaged as `SIG.ext`; SIG = first 32 hex characters of SHA-256 | documented; sig algorithm **assumed** |

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
