# XML Canvas — From XML to Visual

XML Canvas opens XML files that describe designs, finds every image they reference, shows exactly which images resolve (and why the others do not), reconstructs SVG designs on a canvas, and converts them into **Alight Motion scene XML** with a pre-export validation and compatibility report.

Everything runs locally in the browser. Nothing is uploaded.

> **Alight Motion status: untested.** The writer follows real exported projects and the community reference built from the decompiled app (format 106 / app 5.0.273), but it has **not yet been verified by importing a generated project into Alight Motion**. Every mapping rule is labelled *observed*, *documented* or *assumed*. See [docs/ALIGHT_MOTION.md](docs/ALIGHT_MOTION.md) for the test protocol.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # parser, resolver, interpreter and Alight Motion writer tests (Vitest)
npm run build      # type-check + production build into dist/
```

The samples in `samples/` (and their copies in `public/samples/`, used by **Try a sample**) are generated with `npm run samples` (Python 3 with Pillow; python-docx for the DOCX sample).

## What works now

| Area | Status |
|---|---|
| Import | XML/SVG/FB2 file, folder (picker or drag-and-drop), ZIP/DOCX/PPTX/XLSX, pasted XML |
| Parsing | Strict XML 1.0 parser with line/column errors and hints, encoding detection, namespaces, XXE and entity-expansion protection, runs in a Web Worker |
| Format adapters | SVG, FB2, Android resource XML, Office Open XML parts, and a generic value-based sweep for unknown schemas |
| Image resolution | Relative paths, case mismatches (with warning), absolute paths (matched by trailing path, with warning), Base64 / data URIs, Android `@drawable`/`@mipmap` with density selection, OOXML relationships, opt-in remote URLs |
| Image verification | Formats identified from bytes (never from file names); dimensions read from headers; browser decode check; thumbnails |
| Asset gallery | Filters, search, status badges, inspector with source locations (click to jump to the line) |
| Visual canvas | SVG reconstruction: rect, circle, ellipse, line, polyline, polygon, path (arcs → Béziers), image, text/tspan, groups, `<use>`/`<symbol>`, nested `<svg>`, linear/radial gradients, opacity, transforms, simple CSS; zoom, pan, fit, selection |
| Source view | Syntax highlighting, line numbers, search, folding, error and warning markers; virtualised for large files |
| Alight Motion | Scene XML writer, media packaging by signature, validation (12 checks), compatibility report (Markdown + JSON), package ZIP |

Not interpreted yet, and reported wherever it occurs: strokes in the export, clip paths, masks, filters, patterns, `<foreignObject>`, text on a path, SMIL animations other than opacity/translate/rotate/scale, layout for non-SVG formats. There is no undo/redo because nothing is editable yet; those controls will be added with editing.

## Architecture

```
src/
  core/                    framework-free, unit-tested
    xml/                   parser.ts (secure, positioned), decode.ts (BOM/encoding), query.ts
    project/               vfs.ts (virtual project FS, path rules), importer.ts (files, folders, ZIP, drag-drop, paste)
    adapters/              svg, fb2, android, ooxml, generic (+ registry.ts): schema detection and image references
    assets/                resolver.ts, sniff.ts (magic bytes + dimensions), base64.ts, hash.ts
    design/                model.ts (format-independent scene), svgInterpreter.ts, matrix.ts, path.ts, color.ts, bounds.ts
    alight/                rules.ts (provenance), writer.ts, validate.ts, report.ts, package.ts
    pipeline/analyze.ts    decode → parse → detect → extract → resolve → interpret
  worker/                  analyze.worker.ts + client.ts (falls back to the main thread if workers are unavailable)
  ui/                      React components (App, views, inspector) and useAssets (blob URLs, decode check, remote opt-in)
tests/                     Vitest suites; they also run under `bun test`
scripts/                   make-samples.py, build-preview.mjs (offline build without Vite), e2e.mjs (Playwright)
```

**Adding a format:** implement `FormatAdapter` (`detect` by namespace/root, `extract` returning `AssetReference`s with evidence) and add it to `ADAPTERS` in `adapters/registry.ts`. To make a format convertible, add an interpreter that produces a `DesignScene`.

### Design decisions

- **Own XML parser instead of fast-xml-parser.** Every node needs a line/column (to trace assets and layers back to the source), errors need exact positions, and entity handling must be impossible to misconfigure. External entities and DTDs are never fetched; custom entities are never expanded.
- **Evidence, not names.** An element is never treated as an image because its name contains "image". Adapters use the schema; for unknown schemas only the value counts (data URI, Base64 with an image signature, or a path with an image extension, which is then confirmed by reading the bytes).
- **No silent substitution.** Missing images are shown as labelled outlines with the reason, never as placeholder pictures. Unsupported elements are listed in the Structure panel and in the compatibility report.
- **Remote images are opt-in**, because loading them contacts third-party servers. Images that are displayable but not downloadable (CORS) are flagged as not packageable.

## Verification performed

- `bun test` / `npm test`: 82 tests covering the parser, decoding, Base64, header sniffing, every sample, the SVG interpreter, the Alight Motion writer (geometry, gradients, groups, keyframes) and validation (including tamper detection).
- Strict `tsc` on `src/core` and `src/worker` (TypeScript 6 and 7).
- `scripts/e2e.mjs`: 27 checks in Chromium on the built app, covering samples, folder upload, DOCX, parse errors, paste, remote opt-in, canvas selection, zoom, source search/folding, theme, downloading the package and checking its contents, and confirming that no script in an SVG executes.
- Performance: a 15 MB SVG with 360,000 elements analyses in about 3 s.

The UI was type-checked by the bundler only (React type definitions were not available offline when it was written); `npm run build` runs the full `tsc` check.

See [docs/SUPPORTED_FORMATS.md](docs/SUPPORTED_FORMATS.md) for exactly which structures are supported and tested.
