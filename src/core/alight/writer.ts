/**
 * Writes a DesignScene as Alight Motion scene XML (format 106, as described by the community reference).
 * See rules.ts for the provenance of every structural decision.
 */
import type { ResolvedAsset } from '../assets/types';
import { EXT_FOR_FORMAT } from '../assets/sniff';
import { toAARRGGBB, type RGBA } from '../design/color';
import { apply, decompose, hasSkew, IDENTITY, multiply, rotate, scale as scaleM, translate, type Matrix } from '../design/matrix';
import type { Animation, DesignNode, DesignScene, GroupNode, Paint, SourceRef, TextNode } from '../design/model';
import { ellipseSegs, parsePath, rectSegs, segBounds, segsToD, transformSegs, type Seg } from '../design/path';
import { TARGET } from './rules';

export interface AmOptions {
  title: string;
  fps: number;
  /** Scene duration in ms. */
  totalTime: number;
  /** Background; null = transparent. */
  background: RGBA | null;
  sourceName: string;
}

export interface AmLayerRecord {
  id: number;
  tag: 'shape' | 'text' | 'embedScene';
  label: string;
  layerType: 'Rectangle' | 'Image' | 'Text' | 'Vector shape' | 'Group';
  nodeId: string;
  source: SourceRef;
  rules: string[];
  notes: string[];
  animated: boolean;
  depth: number;
}

export interface AmDropped {
  nodeId: string;
  name: string;
  source: SourceRef;
  reason: string;
}

export interface AmMediaEntry {
  assetId: string;
  sig: string;
  ext: string;
  filename: string;
  uri: string;
  title: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  sha256: string;
  bytes: Uint8Array;
}

export interface AmConversion {
  xml: string;
  options: AmOptions;
  width: number;
  height: number;
  layers: AmLayerRecord[];
  dropped: AmDropped[];
  media: AmMediaEntry[];
  rulesUsed: string[];
}

const f6 = (n: number) => {
  const s = (Math.abs(n) < 5e-7 ? 0 : n).toFixed(6);
  return s === '-0.000000' ? '0.000000' : s;
};
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\t\n\r]/g, (c) => `&#${c.charCodeAt(0)};`);
const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function invert(m: Matrix): Matrix | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

function interp(anim: Animation, t: number): number[] {
  const k = anim.keyframes;
  if (t <= k[0].t) return k[0].v;
  if (t >= k[k.length - 1].t) return k[k.length - 1].v;
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i].t) {
      const u = (t - k[i - 1].t) / (k[i].t - k[i - 1].t || 1);
      return k[i].v.map((v, j) => k[i - 1].v[j] + (v - k[i - 1].v[j]) * u);
    }
  }
  return k[k.length - 1].v;
}

/** Local-space animation matrix at time t (opacity excluded). */
function animMatrixAt(anims: Animation[], t: number): Matrix {
  let m: Matrix = IDENTITY;
  for (const a of anims) {
    if (a.property === 'opacity') continue;
    const v = interp(a, t);
    if (a.property === 'translate') m = multiply(m, translate(v[0], v[1] ?? 0));
    else if (a.property === 'scale') m = multiply(m, scaleM(v[0], v[1] ?? v[0]));
    else m = multiply(m, rotate(v[0], a.center?.[0] ?? 0, a.center?.[1] ?? 0));
  }
  return m;
}

interface LayerFrame {
  /** Canvas point the layer is positioned at. */
  center: [number, number];
  rotation: number;
  scale: [number, number];
}

export function convertToAlightMotion(scene: DesignScene, assets: Map<string, ResolvedAsset>, opts: AmOptions): AmConversion {
  const layers: AmLayerRecord[] = [];
  const dropped: AmDropped[] = [];
  const media = new Map<string, AmMediaEntry>();
  const rulesUsed = new Set<string>(['scene-root', 'version-stamp', 'ids', 'transform', 'color']);
  let nextId = 1;
  const totalTime = Math.max(1, Math.round(opts.totalTime));
  const W = scene.width;
  const H = scene.height;
  const indent = (d: number) => '  '.repeat(d);

  const mediaFor = (asset: ResolvedAsset): AmMediaEntry | null => {
    if (!asset.bytes || !asset.sha256 || !asset.format || !asset.mime) return null;
    const existing = media.get(asset.id);
    if (existing) return existing;
    const sig = asset.sha256.slice(0, 32);
    const ext = EXT_FOR_FORMAT[asset.format];
    const entry: AmMediaEntry = {
      assetId: asset.id, sig, ext, filename: `${sig}.${ext}`, uri: `am-internal:///${sig}.${ext}`, title: asset.name, mime: asset.mime,
      size: asset.byteLength ?? asset.bytes.byteLength, width: asset.width ?? 0, height: asset.height ?? 0, sha256: asset.sha256, bytes: new Uint8Array(asset.bytes),
    };
    media.set(asset.id, entry);
    rulesUsed.add('media').add('media-sig');
    return entry;
  };

  /** Writes the <transform> block, sampling keyframes for animated nodes. */
  const transformXml = (node: DesignNode, frame: LayerFrame, baseMatrix: Matrix, d: number, notes: string[]): { xml: string; animated: boolean } => {
    const anims = node.animations;
    const spatial = anims.filter((a) => a.property !== 'opacity');
    const opacityAnim = anims.find((a) => a.property === 'opacity');
    const lines: string[] = [`${indent(d)}<transform>`];
    let animated = false;
    const kfT = (t: number) => f6(Math.min(1, Math.max(0, t / totalTime)));

    if (spatial.length) {
      animated = true;
      rulesUsed.add('keyframes').add('rotation-direction');
      const inv = invert(baseMatrix);
      const times = new Set<number>();
      for (const a of spatial) for (const k of a.keyframes) times.add(k.t);
      const sorted = [...times].sort((a, b) => a - b);
      // Subdivide so rotations never jump more than 15° between keyframes (keeps arcs and unwrapping correct).
      const samples: number[] = [];
      for (let i = 0; i < sorted.length; i++) {
        if (i > 0) {
          const t0 = sorted[i - 1];
          const t1 = sorted[i];
          const rot = (t: number) => spatial.filter((a) => a.property === 'rotate').reduce((s, a) => s + interp(a, t)[0], 0);
          const steps = Math.min(48, Math.max(1, Math.ceil(Math.abs(rot(t1) - rot(t0)) / 15)));
          for (let s = 1; s < steps; s++) samples.push(t0 + ((t1 - t0) * s) / steps);
        }
        samples.push(sorted[i]);
      }
      const rotOffset = (t: number) => spatial.filter((a) => a.property === 'rotate').reduce((s, a) => s + interp(a, t)[0], 0);
      const sign = baseMatrix[0] * baseMatrix[3] - baseMatrix[1] * baseMatrix[2] < 0 ? -1 : 1;
      const loc: string[] = [];
      const sc: string[] = [];
      const ro: string[] = [];
      for (const t of samples) {
        const delta = inv ? multiply(multiply(baseMatrix, animMatrixAt(spatial, t)), inv) : IDENTITY;
        const [x, y] = apply(delta, frame.center[0], frame.center[1]);
        const dd = decompose(delta);
        loc.push(`${indent(d + 2)}<kf t="${kfT(t)}" v="${f6(x)},${f6(y)},0.000000"/>`);
        sc.push(`${indent(d + 2)}<kf t="${kfT(t)}" v="${f6(frame.scale[0] * dd.scaleX)},${f6(frame.scale[1] * Math.abs(dd.scaleY))}"/>`);
        ro.push(`${indent(d + 2)}<kf t="${kfT(t)}" v="${f6(frame.rotation + sign * rotOffset(t))}"/>`);
      }
      const hasRot = spatial.some((a) => a.property === 'rotate');
      const hasScale = spatial.some((a) => a.property === 'scale');
      lines.push(`${indent(d + 1)}<location>`, ...loc, `${indent(d + 1)}</location>`);
      if (hasScale) lines.push(`${indent(d + 1)}<scale>`, ...sc, `${indent(d + 1)}</scale>`);
      else if (frame.scale[0] !== 1 || frame.scale[1] !== 1) lines.push(`${indent(d + 1)}<scale value="${f6(frame.scale[0])},${f6(frame.scale[1])}"/>`);
      if (hasRot) lines.push(`${indent(d + 1)}<rotation>`, ...ro, `${indent(d + 1)}</rotation>`);
      else if (Math.abs(frame.rotation) > 1e-6) lines.push(`${indent(d + 1)}<rotation value="${f6(frame.rotation)}"/>`);
      if (samples.length > sorted.length) notes.push(`${samples.length - sorted.length} extra keyframes were sampled so rotations stay smooth.`);
    } else {
      lines.push(`${indent(d + 1)}<location value="${f6(frame.center[0])},${f6(frame.center[1])},0.000000"/>`);
      if (frame.scale[0] !== 1 || frame.scale[1] !== 1) lines.push(`${indent(d + 1)}<scale value="${f6(frame.scale[0])},${f6(frame.scale[1])}"/>`);
      if (Math.abs(frame.rotation) > 1e-6) { lines.push(`${indent(d + 1)}<rotation value="${f6(frame.rotation)}"/>`); rulesUsed.add('rotation-direction'); }
    }
    if (opacityAnim) {
      animated = true;
      rulesUsed.add('keyframes');
      lines.push(`${indent(d + 1)}<opacity>`, ...opacityAnim.keyframes.map((k) => `${indent(d + 2)}<kf t="${kfT(k.t)}" v="${f6(Math.min(1, Math.max(0, k.v[0])))}"/>`), `${indent(d + 1)}</opacity>`);
    } else if (node.opacity < 1) {
      lines.push(`${indent(d + 1)}<opacity value="${f6(node.opacity)}"/>`);
    }
    lines.push(`${indent(d)}</transform>`);
    return { xml: lines.join('\n'), animated };
  };

  /** Fill children + fillType for a paint, relative to a local bounding box. */
  const fillXml = (paint: Paint, bbox: { x: number; y: number; w: number; h: number }, d: number, notes: string[]): { fillType: string; xml: string } | null => {
    if (paint.type === 'none') return null;
    if (paint.type === 'solid') return { fillType: 'color', xml: `${indent(d)}<fillColor value="${toAARRGGBB(paint.color)}"/>` };
    rulesUsed.add('gradient').add('gradient-coordinates');
    const stops = paint.stops;
    if (stops.length > 2) notes.push(`Gradient "${paint.sourceId}" has ${stops.length} stops; Alight Motion gradients have two colours, so only the first and last were kept.`);
    if (stops[0].offset > 0 || stops[stops.length - 1].offset < 1) notes.push('Gradient stop offsets were stretched to the full 0–1 range.');
    const toFrac = (x: number, y: number): [number, number] => {
      let [px, py] = apply(paint.transform, x, y);
      if (paint.units === 'userSpaceOnUse') { px = (px - bbox.x) / (bbox.w || 1); py = (py - bbox.y) / (bbox.h || 1); }
      return [px, py];
    };
    if (paint.transform.some((v, k) => Math.abs(v - IDENTITY[k]) > 1e-9)) notes.push('gradientTransform was applied to the gradient end points only (skew and non-uniform scale of the gradient are lost).');
    let start: [number, number];
    let end: [number, number];
    let type: string;
    if (paint.type === 'linear') {
      start = toFrac(paint.x1, paint.y1);
      end = toFrac(paint.x2, paint.y2);
      type = 'linear';
    } else {
      start = toFrac(paint.cx, paint.cy);
      end = toFrac(paint.cx + paint.r, paint.cy);
      type = 'radial';
      if (paint.fx !== paint.cx || paint.fy !== paint.cy) notes.push('The radial gradient focal point was ignored.');
    }
    return {
      fillType: 'gradient',
      xml: [
        `${indent(d)}<fillColor value="${toAARRGGBB(stops[0].color)}"/>`,
        `${indent(d)}<gradient type="${type}" startColor="${toAARRGGBB(stops[0].color)}" endColor="${toAARRGGBB(stops[stops.length - 1].color)}" start="${f6(start[0])},${f6(start[1])}" end="${f6(end[0])},${f6(end[1])}"/>`,
      ].join('\n'),
    };
  };

  const drop = (node: DesignNode, reason: string) => dropped.push({ nodeId: node.id, name: node.name, source: node.source, reason });

  const emitNode = (node: DesignNode, d: number, depth: number): string | null => {
    const notes: string[] = [];
    const common = (id: number, label: string) => `id="${id}" label="${escAttr(label)}" startTime="0" endTime="${totalTime}"`;

    if (node.kind === 'group') {
      const id = nextId++;
      const rec: AmLayerRecord = { id, tag: 'embedScene', label: node.name, layerType: 'Group', nodeId: node.id, source: node.source, rules: ['group', 'ids', 'transform'], notes, animated: false, depth };
      layers.push(rec);
      rulesUsed.add('group');
      const childXml = (node as GroupNode).children.map((c) => emitNode(c, d + 2, depth + 1)).filter((x): x is string => !!x);
      if (!childXml.length) {
        layers.splice(layers.indexOf(rec), 1);
        drop(node, 'Every layer inside this group was dropped, so the group was omitted.');
        return null;
      }
      // Child layers already carry absolute canvas coordinates, so the group itself only adds its own animation/opacity.
      const groupNode: DesignNode = { ...node, matrix: node.animations.length ? node.matrix : IDENTITY };
      const t = transformXml(groupNode, { center: [W / 2, H / 2], rotation: 0, scale: [1, 1] }, groupNode.matrix, d + 1, notes);
      rec.animated = t.animated;
      return [
        `${indent(d)}<embedScene ${common(id, node.name)} fillType="intrinsic" outTime="${totalTime}" mediaFillMode="fill">`,
        t.xml,
        `${indent(d + 1)}<scene title="" width="${W}" height="${H}" exportWidth="${W}" exportHeight="${H}" precompose="dynamicResolution" bgcolor="#00000000" totalTime="${totalTime}" fps="${opts.fps}" modifiedTime="0" amver="${TARGET.amver}" ffver="${TARGET.ffver}" am="${TARGET.am}" amplatform="${TARGET.amplatform}" retime="freeze" retimeAdaptFPS="false">`,
        ...childXml,
        `${indent(d + 1)}</scene>`,
        `${indent(d)}</embedScene>`,
      ].join('\n');
    }

    if (node.kind === 'image') {
      const asset = assets.get(node.assetKey);
      if (!asset || asset.status !== 'resolved') {
        drop(node, `Image not converted: its asset is ${asset ? `${asset.status} — ${asset.reason ?? ''}` : 'unknown'}`.trim());
        return null;
      }
      const m = mediaFor(asset);
      if (!m) { drop(node, 'Image not converted: the image bytes are not available (remote images must be downloadable).'); return null; }
      if (hasSkew(node.matrix)) notes.push('The image is skewed in the source; skew cannot be represented and was dropped.');
      let { x, y, width: w, height: h } = node;
      const iw = asset.width || w;
      const ih = asset.height || h;
      if (!w && !h) { w = iw; h = ih; }
      else if (!w) w = (h * iw) / ih;
      else if (!h) h = (w * ih) / iw;
      const par = node.preserveAspectRatio.trim().split(/\s+/);
      if (par[0] !== 'none' && iw && ih) {
        const s = par[1] === 'slice' ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
        if (par[1] === 'slice') notes.push('preserveAspectRatio "slice" crops the image in SVG; the layer shows the whole image at the cropped scale.');
        const dw = iw * s;
        const dh = ih * s;
        const ax = par[0].includes('xMin') ? 0 : par[0].includes('xMax') ? 1 : 0.5;
        const ay = par[0].includes('YMin') ? 0 : par[0].includes('YMax') ? 1 : 0.5;
        x += (w - dw) * ax; y += (h - dh) * ay; w = dw; h = dh;
      } else if (par[0] === 'none') notes.push('preserveAspectRatio="none" stretches the image; the layer keeps the stretched size.');
      const dec = decompose(node.matrix);
      const frame: LayerFrame = { center: apply(node.matrix, x + w / 2, y + h / 2), rotation: dec.rotation, scale: [(w * dec.scaleX) / 100, (h * Math.abs(dec.scaleY)) / 100] };
      if (dec.scaleY < 0) notes.push('The image is mirrored in the source; mirroring was dropped.');
      const id = nextId++;
      const t = transformXml(node, frame, node.matrix, d + 1, notes);
      layers.push({ id, tag: 'shape', label: node.name, layerType: 'Image', nodeId: node.id, source: node.source, rules: ['image', 'image-fill-mode', 'rect', 'media', 'media-sig'], notes, animated: t.animated, depth });
      rulesUsed.add('image').add('image-fill-mode').add('rect');
      return [`${indent(d)}<shape ${common(id, node.name)} fillType="media" fillImage="${m.uri}" mediaFillMode="fill" s=".rect">`, t.xml, `${indent(d)}</shape>`].join('\n');
    }

    if (node.kind === 'text') {
      const tn = node as TextNode;
      const dec = decompose(tn.matrix);
      if (Math.abs(dec.skew) > 1e-6) notes.push('Skew on the text was dropped.');
      const avgScale = Math.sqrt(Math.abs(dec.scaleX * dec.scaleY));
      const size = tn.fontSize * avgScale;
      const lineHeight = tn.fontSize * 1.2;
      const blockMidY = tn.y - tn.fontSize * 0.35 + ((tn.lines.length - 1) * lineHeight) / 2;
      const frame: LayerFrame = { center: apply(tn.matrix, tn.x, blockMidY), rotation: dec.rotation, scale: [1, 1] };
      let fill = tn.fill;
      if (fill.type === 'linear' || fill.type === 'radial') { notes.push('Gradient text fill was replaced by its first colour.'); fill = { type: 'solid', color: fill.stops[0].color }; }
      if (fill.type === 'none') { drop(node, 'Text has no fill (outline-only text is not converted).'); return null; }
      if (tn.fontStyle === 'italic') notes.push('Italic style is not written; choose the italic font variant in Alight Motion.');
      const longest = Math.max(...tn.lines.map((l) => l.length));
      const wrapWidth = Math.max(512, Math.ceil((longest * size * 0.75 + size) / 8) * 8);
      const align = tn.anchor === 'middle' ? 'center' : tn.anchor === 'end' ? 'right' : 'left';
      const font = `googlefonts?name=${tn.fontFamily}&weight=${tn.fontWeight}`;
      if (/^(sans-serif|serif|monospace|system-ui|cursive|fantasy)$/i.test(tn.fontFamily)) notes.push(`"${tn.fontFamily}" is a generic CSS family, not a Google Font; Alight Motion will substitute a font.`);
      const id = nextId++;
      const t = transformXml(node, frame, tn.matrix, d + 1, notes);
      layers.push({ id, tag: 'text', label: node.name, layerType: 'Text', nodeId: node.id, source: node.source, rules: ['text', 'text-position'], notes, animated: t.animated, depth });
      rulesUsed.add('text').add('text-position');
      return [
        `${indent(d)}<text ${common(id, node.name)} fillType="color" size="${Math.max(1, Math.round(size))}" font="${escAttr(font)}" wrapWidth="${wrapWidth}" align="${align}">`,
        t.xml,
        `${indent(d + 1)}<fillColor value="${toAARRGGBB((fill as { color: RGBA }).color)}"/>`,
        `${indent(d + 1)}<content>${escText(tn.lines.join('\n'))}</content>`,
        `${indent(d)}</text>`,
      ].join('\n');
    }

    // Shapes: rect / ellipse / path
    if (node.stroke) notes.push(`The ${node.stroke.width}px stroke was not converted (outlines are not supported yet).`);
    if (node.fill.type === 'none') {
      drop(node, node.stroke ? 'Outline-only shape: strokes are not converted yet.' : 'The shape has no fill, so it would be invisible.');
      return null;
    }
    const isPlainRect = node.kind === 'rect' && node.rx === 0 && node.ry === 0 && !hasSkew(node.matrix);
    if (isPlainRect && node.kind === 'rect') {
      const dec = decompose(node.matrix);
      const fx = fillXml(node.fill, { x: node.x, y: node.y, w: node.width, h: node.height }, d + 1, notes);
      if (!fx) return null;
      if (dec.scaleY < 0) notes.push('Mirroring was dropped.');
      const frame: LayerFrame = { center: apply(node.matrix, node.x + node.width / 2, node.y + node.height / 2), rotation: dec.rotation, scale: [(node.width * dec.scaleX) / 100, (node.height * Math.abs(dec.scaleY)) / 100] };
      const id = nextId++;
      const t = transformXml(node, frame, node.matrix, d + 1, notes);
      layers.push({ id, tag: 'shape', label: node.name, layerType: 'Rectangle', nodeId: node.id, source: node.source, rules: ['rect', ...(fx.fillType === 'gradient' ? ['gradient', 'gradient-coordinates'] : [])], notes, animated: t.animated, depth });
      rulesUsed.add('rect');
      return [`${indent(d)}<shape ${common(id, node.name)} fillType="${fx.fillType}" s=".rect">`, t.xml, fx.xml, `${indent(d)}</shape>`].join('\n');
    }

    let local: Seg[] | null;
    if (node.kind === 'rect') local = rectSegs(node.x, node.y, node.width, node.height, node.rx, node.ry);
    else if (node.kind === 'ellipse') local = ellipseSegs(node.cx, node.cy, node.rx, node.ry);
    else local = parsePath(node.d);
    if (!local) { drop(node, 'Path data could not be parsed.'); return null; }
    if (node.kind === 'path' && node.fillRule === 'evenodd') notes.push('fill-rule="evenodd" is not represented; overlapping sub-paths may fill differently.');
    const lb = segBounds(local);
    const canvasSegs = transformSegs(local, node.matrix);
    const cb = segBounds(canvasSegs);
    if (!lb || !cb) { drop(node, 'The shape has no area.'); return null; }
    const cx = (cb.minX + cb.maxX) / 2;
    const cy = (cb.minY + cb.maxY) / 2;
    const rel = transformSegs(canvasSegs, translate(-cx, -cy));
    const fx = fillXml(node.fill, { x: lb.minX, y: lb.minY, w: lb.maxX - lb.minX, h: lb.maxY - lb.minY }, d + 1, notes);
    if (!fx) return null;
    const id = nextId++;
    const t = transformXml(node, { center: [cx, cy], rotation: 0, scale: [1, 1] }, node.matrix, d + 1, notes);
    layers.push({ id, tag: 'shape', label: node.name, layerType: 'Vector shape', nodeId: node.id, source: node.source, rules: ['path-contour', 'path-coordinates', ...(fx.fillType === 'gradient' ? ['gradient', 'gradient-coordinates'] : [])], notes, animated: t.animated, depth });
    rulesUsed.add('path-contour').add('path-coordinates');
    return [
      `${indent(d)}<shape ${common(id, node.name)} fillType="${fx.fillType}">`,
      t.xml,
      fx.xml,
      `${indent(d + 1)}<parameter>`,
      `${indent(d + 2)}<contour d="${segsToD(rel)}"/>`,
      `${indent(d + 1)}</parameter>`,
      `${indent(d)}</shape>`,
    ].join('\n');
  };

  const body = scene.nodes.map((n) => emitNode(n, 1, 0)).filter((x): x is string => !!x);
  const mediaXml = [...media.values()].map(
    (m) => `  <media uri="${m.uri}" filename="${m.filename}" title="${escAttr(m.title)}" type="${m.mime}" size="${m.size}" sig="${m.sig}" width="${m.width}" height="${m.height}"/>`,
  );
  const bg = opts.background ? toAARRGGBB(opts.background) : '#00000000';
  const comment = `<!--\nGenerated by XML Canvas from "${opts.sourceName.replace(/--/g, '- -')}".\nTarget: ${TARGET.format}, format ${TARGET.ffver} (as documented by the community reference for app ${TARGET.appVersion}).\nNOT YET VERIFIED by importing into Alight Motion. See compatibility-report.md.\n-->`;
  const xml = [
    "<?xml version='1.0' encoding='UTF-8' ?>",
    comment,
    `<scene title="${escAttr(opts.title)}" width="${W}" height="${H}" exportWidth="${W}" exportHeight="${H}" precompose="dynamicResolution" bgcolor="${bg}" totalTime="${totalTime}" fps="${opts.fps}" modifiedTime="${Date.now()}" amver="${TARGET.amver}" ffver="${TARGET.ffver}" am="${TARGET.am}" amplatform="${TARGET.amplatform}" retime="freeze" retimeAdaptFPS="false">`,
    ...mediaXml,
    ...body,
    '</scene>',
    '',
  ].join('\n');

  return { xml, options: opts, width: W, height: H, layers, dropped, media: [...media.values()], rulesUsed: [...rulesUsed] };
}
