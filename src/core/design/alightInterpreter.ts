/**
 * Reads Alight Motion scene XML into the DesignScene model so the canvas can show it.
 * Static view: animated properties are shown at their first keyframe. Everything not drawn is reported.
 */
import { elementPath, getAttr } from '../xml/query';
import type { XmlDocument, XmlElement } from '../xml/types';
import type { RGBA } from './color';
import { multiply, rotate, scale as scaleM, translate, type Matrix } from './matrix';
import type { DesignIssue, DesignNode, DesignScene, GroupNode, Paint, SourceRef } from './model';
import { parsePath, segsToD } from './path';

export function parseAARRGGBB(v: string | undefined): RGBA | null {
  const m = /^#([0-9a-f]{8})$/i.exec((v ?? '').trim());
  if (!m) {
    const short = /^#([0-9a-f]{6})$/i.exec((v ?? '').trim());
    if (!short) return null;
    const h = short[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const h = m[1];
  return { a: parseInt(h.slice(0, 2), 16) / 255, r: parseInt(h.slice(2, 4), 16), g: parseInt(h.slice(4, 6), 16), b: parseInt(h.slice(6, 8), 16) };
}

const kids = (el: XmlElement) => el.children.filter((c): c is XmlElement => c.type === 'element');
const nums = (v: string | undefined) => (v ?? '').split(',').map((x) => Number(x.trim())).filter(Number.isFinite);

export function interpretAlight(doc: XmlDocument): DesignScene {
  const issues: DesignIssue[] = [];
  const once = new Set<string>();
  const src = (el: XmlElement): SourceRef => ({ line: el.pos.line, col: el.pos.col, elementPath: elementPath(el), elementName: el.name, id: getAttr(el, 'id') });
  const issue = (level: DesignIssue['level'], message: string, el?: XmlElement, key?: string) => {
    if (key) { if (once.has(key)) return; once.add(key); }
    issues.push({ level, message, source: el ? src(el) : undefined });
  };
  const root = doc.root;
  const W = Number(getAttr(root, 'width')) || 1080;
  const H = Number(getAttr(root, 'height')) || 1920;
  let seq = 0;

  /** Static value of a property: value attribute, or the first keyframe. */
  const propValue = (p: XmlElement | undefined): number[] | undefined => {
    if (!p) return undefined;
    const v = getAttr(p, 'value');
    if (v !== undefined) return nums(v);
    const kf = kids(p).find((k) => k.name === 'kf');
    if (kf) {
      issue('info', 'Animated properties are shown at their first keyframe.', undefined, 'kf');
      return nums(getAttr(kf, 'v'));
    }
    return undefined;
  };

  const layerTransform = (el: XmlElement): { matrix: Matrix; opacity: number } => {
    const t = kids(el).find((c) => c.name === 'transform');
    const get = (n: string) => (t ? propValue(kids(t).find((c) => c.name === n)) : undefined);
    const loc = get('location') ?? [0, 0, 0];
    const sc = get('scale') ?? [1, 1];
    const rot = get('rotation')?.[0] ?? 0;
    const piv = get('pivot');
    const op = get('opacity')?.[0] ?? 1;
    if (piv && (piv[0] || piv[1])) issue('info', 'Non-zero pivot points are ignored on the canvas.', el, 'pivot');
    if (t && kids(t).some((c) => c.name === 'skew' && (propValue(c) ?? [0, 0]).some((x) => x !== 0))) issue('warning', 'Skew is not drawn.', el, 'skew');
    const matrix = multiply(multiply(translate(loc[0], loc[1]), rotate(rot)), scaleM(sc[0] ?? 1, sc[1] ?? sc[0] ?? 1));
    return { matrix, opacity: Math.max(0, Math.min(1, op)) };
  };

  const fillOf = (el: XmlElement): Paint => {
    const type = getAttr(el, 'fillType') ?? 'color';
    const fc = parseAARRGGBB(getAttr(kids(el).find((c) => c.name === 'fillColor') ?? el, 'value'));
    if (type === 'gradient') {
      const g = kids(el).find((c) => c.name === 'gradient');
      if (g) {
        const startColor = parseAARRGGBB(getAttr(g, 'startColor')) ?? { r: 0, g: 0, b: 0, a: 1 };
        const endColor = parseAARRGGBB(getAttr(g, 'endColor')) ?? { r: 255, g: 255, b: 255, a: 1 };
        const [x1, y1] = nums(getAttr(g, 'start') ?? '0,0');
        const [x2, y2] = nums(getAttr(g, 'end') ?? '1,1');
        const stops = [{ offset: 0, color: startColor }, { offset: 1, color: endColor }];
        const kind = getAttr(g, 'type') ?? 'linear';
        if (kind === 'sweep') issue('warning', 'Sweep gradients are drawn as linear gradients.', el, 'sweep');
        if (kind === 'radial') return { type: 'radial', cx: x1, cy: y1, r: Math.hypot(x2 - x1, y2 - y1), fx: x1, fy: y1, units: 'objectBoundingBox', transform: [1, 0, 0, 1, 0, 0], stops, sourceId: `layer ${getAttr(el, 'id')}` };
        return { type: 'linear', x1, y1, x2, y2, units: 'objectBoundingBox', transform: [1, 0, 0, 1, 0, 0], stops, sourceId: `layer ${getAttr(el, 'id')}` };
      }
    }
    if (type === 'color' || type === 'gradient') return fc ? { type: 'solid', color: fc } : { type: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } };
    return { type: 'none' };
  };

  /** Drawn size before scale: verified on device to be twice the size property (default 100 → 200). */
  const sizeOf = (el: XmlElement): [number, number] => {
    const p = kids(el).find((c) => c.name === 'property' && getAttr(c, 'name') === 'size');
    const v = propValue(p);
    return v && v.length >= 2 ? [v[0] * 2, v[1] * 2] : [200, 200];
  };
  const textUnit = Math.min(W, H) / 360;

  const visit = (el: XmlElement, parent: Matrix, out: DesignNode[]) => {
    if (getAttr(el, 'hidden') === 'true') { issue('info', `Hidden layer "${getAttr(el, 'label') ?? ''}" is not drawn.`, el); return; }
    const { matrix: local, opacity } = layerTransform(el);
    const matrix = multiply(parent, local);
    const name = getAttr(el, 'label') ?? `${el.name} ${getAttr(el, 'id') ?? ''}`.trim();
    const base = { id: `a${++seq}`, name, matrix, opacity, source: src(el), animations: [] };
    const effects = kids(el).filter((c) => c.name === 'effect').length;
    if (effects) issue('info', `"${name}" has ${effects} effect${effects > 1 ? 's' : ''} that are not rendered.`, el);
    switch (el.name) {
      case 'shape': {
        const s = getAttr(el, 's');
        const [w, h] = sizeOf(el);
        if (getAttr(el, 'fillType') === 'media') {
          const uri = getAttr(el, 'fillImage') ?? '';
          const key = `am-media:${uri.length > 200 ? `${uri.length}:${uri.slice(0, 64)}:${uri.slice(-64)}` : uri}`;
          const mode = getAttr(el, 'mediaFillMode') ?? 'fill';
          out.push({ ...base, kind: 'image', x: -w / 2, y: -h / 2, width: w, height: h, assetKey: key, href: uri.length > 120 ? `${uri.slice(0, 120)}…` : uri, preserveAspectRatio: mode === 'fit' ? 'xMidYMid meet' : 'xMidYMid slice' });
          if (s && s !== '.rect') issue('warning', `Media inside the "${s}" shape template is drawn as a rectangle.`, el, `mt:${s}`);
          return;
        }
        const fill = fillOf(el);
        if (s === '.rect' || s === undefined && !kids(el).some((c) => c.name === 'parameter')) {
          out.push({ ...base, kind: 'rect', x: -w / 2, y: -h / 2, width: w, height: h, rx: 0, ry: 0, fill });
          return;
        }
        if (s && /ellipse|circle|oval/i.test(s)) {
          out.push({ ...base, kind: 'ellipse', cx: 0, cy: 0, rx: w / 2, ry: h / 2, fill });
          return;
        }
        if (s) {
          issue('warning', `Shape template "${s}" is not known to XML Canvas; its bounding box is drawn instead.`, el, `tpl:${s}`);
          out.push({ ...base, kind: 'rect', x: -w / 2, y: -h / 2, width: w, height: h, rx: 0, ry: 0, fill: fill.type === 'solid' ? { type: 'solid', color: { ...fill.color, a: fill.color.a * 0.5 } } : fill, stroke: { paint: { type: 'solid', color: { r: 248, g: 113, b: 113, a: 1 } }, width: 2 } });
          return;
        }
        const contour = kids(kids(el).find((c) => c.name === 'parameter')!).find((c) => c.name === 'contour');
        const d = contour && getAttr(contour, 'd');
        const segs = d ? parsePath(d) : null;
        if (!segs) { issue('warning', `Shape "${name}" uses keyframed or knot-based geometry, which is not drawn yet.`, el); return; }
        out.push({ ...base, kind: 'path', d: segsToD(segs), fill, fillRule: 'nonzero', shapeTag: 'contour' });
        return;
      }
      case 'text': {
        const content = kids(el).find((c) => c.name === 'content');
        const text = content ? content.children.map((c) => (c.type === 'text' ? c.value : '')).join('') : '';
        const lines = text.split('\n');
        const size = (Number(getAttr(el, 'size')) || 18) * textUnit;
        const font = getAttr(el, 'font') ?? '';
        const fontName = /name=([^&]+)/.exec(font)?.[1] ?? 'sans-serif';
        const weight = Number(/weight=(\d+)/.exec(font)?.[1]) || 400;
        const align = getAttr(el, 'align') ?? 'left';
        const fc = fillOf(el);
        const lineH = size * 1.2;
        out.push({
          ...base, kind: 'text', x: 0, y: size * 0.35 - ((lines.length - 1) * lineH) / 2, lines, fontFamily: decodeURIComponent(fontName), fontSize: size, fontWeight: weight, fontStyle: 'normal',
          anchor: align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start', fill: fc,
        });
        issue('info', 'Text is drawn centred on its layer location; line wrapping (wrapWidth) is not applied.', el, 'textpos');
        return;
      }
      case 'embedScene': {
        const inner = kids(el).find((c) => c.name === 'scene');
        if (!inner) { issue('warning', `Group "${name}" has no nested scene.`, el); return; }
        const iw = Number(getAttr(inner, 'width')) || W;
        const ih = Number(getAttr(inner, 'height')) || H;
        const gm = multiply(matrix, translate(-iw / 2, -ih / 2));
        const group: GroupNode = { ...base, kind: 'group', matrix: gm, children: [] };
        for (const c of kids(inner)) if (isLayer(c)) visit(c, gm, group.children);
        if (group.children.length) out.push(group);
        return;
      }
      default:
        issue('info', `<${el.name}> layers are not drawn.`, el, `tag:${el.name}`);
    }
  };
  const isLayer = (c: XmlElement) => ['shape', 'text', 'embedScene', 'drawing', 'audio', 'camera', 'nullobj'].includes(c.name);

  const nodes: DesignNode[] = [];
  const bg = parseAARRGGBB(getAttr(root, 'bgcolor'));
  if (bg && bg.a > 0) {
    nodes.push({ id: 'a0', name: 'Scene background', kind: 'rect', x: 0, y: 0, width: W, height: H, rx: 0, ry: 0, fill: { type: 'solid', color: bg }, matrix: [1, 0, 0, 1, 0, 0], opacity: 1, source: src(root), animations: [] });
  }
  for (const c of kids(root)) if (isLayer(c)) visit(c, [1, 0, 0, 1, 0, 0], nodes);
  return { width: W, height: H, durationMs: Number(getAttr(root, 'totalTime')) || 0, nodes, issues, sourceFormat: 'alight' };
}
