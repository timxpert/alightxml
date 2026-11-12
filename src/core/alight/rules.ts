/**
 * Every structural decision the Alight Motion writer makes is a named rule with its provenance, so the
 * compatibility report can say exactly what is backed by evidence and what is an assumption.
 *
 *  observed   — seen in real project XML exported by Alight Motion (public samples).
 *  documented — described by the community reference generated from the decompiled app
 *               (github.com/kuchingneko28/alight-motion-docs, docs/authoring.md, format 106 / app 5.0.273).
 *  assumed    — our best inference; not confirmed by any source. Must be verified by importing into Alight Motion.
 */
export type Provenance = 'observed' | 'documented' | 'assumed';

export interface MappingRule {
  id: string;
  title: string;
  description: string;
  provenance: Provenance;
  evidence: string;
}

export const TARGET = {
  format: 'Alight Motion scene XML',
  ffver: '106',
  amver: '1028425',
  appVersion: '5.0.273',
  am: 'com.alightcreative.motion/5.0.273.1028425',
  amplatform: 'android',
} as const;

const DOCS = 'Community reference generated from the decompiled Alight Motion APK (kuchingneko28/alight-motion-docs, docs/authoring.md).';
const EXPORTS = 'Public project XML exported by Alight Motion (scene headers and layer snippets from app versions 4.0.3–5.0.272).';
const REAL = 'A complete project XML exported by Alight Motion 5.0.273 on an Android phone (samples/alight/real-export-5.0.273.xml)';

export const RULES: Record<string, MappingRule> = {
  'scene-root': {
    id: 'scene-root', title: 'Scene root attributes', provenance: 'observed',
    description: '<scene> carries title, width, height, exportWidth, exportHeight, precompose="dynamicResolution", bgcolor, totalTime (ms), fps, modifiedTime, amver, ffver, am, amplatform, retime="freeze", retimeAdaptFPS="false". Child order: media, then layers back-to-front.',
    evidence: `${EXPORTS} Child ordering and defaults: ${DOCS}`,
  },
  'version-stamp': {
    id: 'version-stamp', title: 'Version stamp', provenance: 'assumed',
    description: `ffver="${TARGET.ffver}" and amver="${TARGET.amver}" come from the reference (format 106, app ${TARGET.appVersion}). The combined am="${TARGET.am}" string follows the pattern seen in exports but this exact value was not observed.`,
    evidence: DOCS,
  },
  color: {
    id: 'color', title: 'Colours as #aarrggbb', provenance: 'observed',
    description: 'Colours are written as lower-case #aarrggbb (alpha first).', evidence: EXPORTS,
  },
  ids: {
    id: 'ids', title: 'Layer ids and timing', provenance: 'observed',
    description: 'Every layer has a unique positive integer id, startTime="0" and endTime equal to the scene totalTime. Ids are not ordered: file order is the stacking order (first = back).',
    evidence: `${REAL} shows ids 987142627 then 987142626, back to front.`,
  },
  transform: {
    id: 'transform', title: 'Transform block', provenance: 'observed',
    description: '<transform> holds <location value="x,y,0">, <scale value="sx,sy">, <rotation value="deg">, <opacity value="0..1">. Default-valued children are omitted.',
    evidence: `${EXPORTS} Rotation/defaults: ${DOCS}`,
  },
  'rotation-direction': {
    id: 'rotation-direction', title: 'Rotation direction and pivot', provenance: 'assumed',
    description: 'Rotation is written in degrees, clockwise on screen (same sign as SVG), around the layer location (pivot 0,0).',
    evidence: 'Not confirmed by any source.',
  },
  rect: {
    id: 'rect', title: 'Rectangle → .rect shape', provenance: 'observed',
    description: 'Axis-aligned rectangles become <shape s=".rect" mediaFillMode="fill"> layers with <property name="size" value="100,100"/>, scale = size / 100 and location = rectangle centre.',
    evidence: `${REAL}: a 540 × 960 rectangle is written as size 100,100 with scale 5.4,9.6.`,
  },
  'size-property': {
    id: 'size-property', title: 'Size property', provenance: 'observed',
    description: '.rect layers carry <property name="size" type="vec2" value="w,h"/> after their fill. Image layers put their real size there and keep scale 1.',
    evidence: `${REAL}: the image layer has size 540,540 (with a uniform scale); the rectangle has size 100,100.`,
  },
  'path-contour': {
    id: 'path-contour', title: 'Vectors → imported shape contour', provenance: 'documented',
    description: 'Circles, ellipses, rounded or skewed rectangles, polygons and paths become <shape> layers without "s", with geometry in <parameter><contour d="…"/></parameter>. Only M, L, C and Z commands are written.',
    evidence: DOCS,
  },
  'path-coordinates': {
    id: 'path-coordinates', title: 'Contour coordinate space', provenance: 'assumed',
    description: 'Contour coordinates are written relative to the layer location (the shape\'s bounding-box centre), and <parameter> is written after the fill children.',
    evidence: 'Not confirmed by any source.',
  },
  gradient: {
    id: 'gradient', title: 'Gradients', provenance: 'observed',
    description: 'Gradient fills use fillType="gradient" and <gradient type="linear|radial" startColor endColor start end/> after <fillColor>. Only two colours are supported, so multi-stop gradients keep their first and last stop.',
    evidence: `${EXPORTS} Two-colour model: ${DOCS}`,
  },
  'gradient-coordinates': {
    id: 'gradient-coordinates', title: 'Gradient start/end space', provenance: 'assumed',
    description: 'Gradient start/end points are written as fractions (0–1) of the layer\'s bounding box, y downwards. Radial gradients use start = centre, end = a point on the radius.',
    evidence: 'Exported values fall in this range, but the meaning is not confirmed.',
  },
  media: {
    id: 'media', title: 'Media declarations', provenance: 'observed',
    description: 'Each image is declared once, before the layers, as <media uri filename title type size orientation="0" infoUpdated width height/>, and image layers point to the same uri in fillImage.',
    evidence: REAL,
  },
  'media-uri': {
    id: 'media-uri', title: 'Image reference (uri)', provenance: 'assumed',
    description: 'Images are referenced as am-internal:///SIG.ext and packaged under that name. A real project export instead uses the phone\'s own content:// address, which only exists on that phone, so images in imported XML are expected to need replacing in the app. Embedding the image as a data: URI was tested on a device and the image did NOT show. Use the probe project to find a reference that loads.',
    evidence: `${REAL} (content://). am-internal for exported presets: ${DOCS} data: URI: user test on 2026-11-12, image not shown.`,
  },
  'media-sig': {
    id: 'media-sig', title: 'Packaged file name', provenance: 'assumed',
    description: 'Packaged image files are named with the first 32 hex characters of their SHA-256, as the reference describes for packaged projects.',
    evidence: DOCS,
  },
  image: {
    id: 'image', title: 'Image → media-filled .rect', provenance: 'observed',
    description: 'Images become .rect shape layers with fillType="media", fillImage pointing to the media uri and mediaFillMode="fill". The size property holds the image\'s drawn size, so its aspect ratio is preserved.',
    evidence: REAL,
  },
  'image-fill-mode': {
    id: 'image-fill-mode', title: 'Media fill mode meaning', provenance: 'assumed',
    description: 'mediaFillMode="fill" is assumed to cover the layer. Because the layer already has the image\'s aspect ratio, cover and fit give the same result.',
    evidence: 'Not confirmed by any source.',
  },
  text: {
    id: 'text', title: 'Text layers', provenance: 'documented',
    description: '<text fillType="color" size font wrapWidth align> with <transform>, <fillColor> and <content>. Fonts are written as googlefonts?name=FAMILY&weight=W.',
    evidence: DOCS,
  },
  'text-position': {
    id: 'text-position', title: 'Text anchoring', provenance: 'assumed',
    description: 'The location is placed at the SVG anchor point (start/middle/end ↔ left/center/right) at the vertical middle of the text block. SVG positions text by its baseline, so small vertical offsets are expected.',
    evidence: 'Not confirmed by any source.',
  },
  group: {
    id: 'group', title: 'Groups → embedded scenes', provenance: 'observed',
    description: 'Groups become <embedScene fillType="intrinsic" mediaFillMode="fill"> layers at the canvas centre containing a full-size nested <scene>. Child layers keep canvas coordinates.',
    evidence: EXPORTS,
  },
  keyframes: {
    id: 'keyframes', title: 'Keyframes', provenance: 'observed',
    description: 'Animated properties contain <kf t="…" v="…"/> children instead of a value attribute. t is written as a fraction (0–1) of the layer duration.',
    evidence: `An export shows <kf t="0.023547"> on a layer lasting ~7.4 s, which fits a normalised time. Note: ${DOCS} describes t as seconds; this conflict is unresolved.`,
  },
};

export const ruleList = () => Object.values(RULES);
