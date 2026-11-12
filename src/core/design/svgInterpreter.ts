/**
 * Interprets an SVG document into the format-independent DesignScene model.
 * Everything that is not interpreted is reported as an issue rather than silently dropped.
 */
import { referenceFromValue } from '../adapters/common';
import { elementPath, getAttr, textContent, walkElements } from '../xml/query';
import { NS, type XmlDocument, type XmlElement } from '../xml/types';
import { parseColor, withAlpha, type RGBA } from './color';
import { IDENTITY, multiply, parseTransform, scale as scaleM, translate, type Matrix } from './matrix';
import type { Animation, DesignIssue, DesignNode, DesignScene, GradientStop, GroupNode, Keyframe, Paint, SourceRef, Stroke, TextNode } from './model';
import { parsePath, polySegs, segsToD } from './path';

type Style = Record<string, string>;

const INHERITED = ['fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'visibility', 'color'];
const PROPS = new Set([...INHERITED, 'opacity', 'display', 'stop-color', 'stop-opacity', 'clip-path', 'mask', 'filter']);

interface CssRule {
  tag?: string;
  id?: string;
  classes: string[];
  specificity: number;
  order: number;
  decls: Style;
}

function parseDecls(s: string): Style {
  const out: Style = {};
  for (const part of s.split(';')) {
    const k = part.indexOf(':');
    if (k === -1) continue;
    const name = part.slice(0, k).trim().toLowerCase();
    const value = part.slice(k + 1).replace(/!important/i, '').trim();
    if (name && value) out[name] = value;
  }
  return out;
}

function parseLength(v: string | undefined, ref: number, fontSize = 16): number | undefined {
  if (v === undefined) return undefined;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(px|pt|pc|mm|cm|in|em|rem|ex|%)?\s*$/i.exec(v);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  switch ((m[2] ?? '').toLowerCase()) {
    case 'pt': return (n * 4) / 3;
    case 'pc': return n * 16;
    case 'mm': return (n * 96) / 25.4;
    case 'cm': return (n * 96) / 2.54;
    case 'in': return n * 96;
    case 'em': case 'rem': return n * fontSize;
    case 'ex': return (n * fontSize) / 2;
    case '%': return (n / 100) * ref;
    default: return n;
  }
}

const numList = (v: string | undefined) => (v ? v.trim().split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite) : []);

function parseClock(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^\s*([\d.]+)\s*(ms|s|min|h)?\s*$/.exec(v);
  if (m) {
    const n = parseFloat(m[1]);
    return m[2] === 'ms' ? n : m[2] === 'min' ? n * 60000 : m[2] === 'h' ? n * 3600000 : n * 1000;
  }
  const hms = /^\s*(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)\s*$/.exec(v);
  if (hms) return ((+(hms[1] ?? 0) * 60 + +hms[2]) * 60 + +hms[3]) * 1000;
  return undefined;
}

export function interpretSvg(doc: XmlDocument): DesignScene {
  const root = doc.root;
  const svgNs = root.ns;
  const issues: DesignIssue[] = [];
  const once = new Set<string>();
  const src = (el: XmlElement): SourceRef => ({ line: el.pos.line, col: el.pos.col, elementPath: elementPath(el), elementName: el.name, id: getAttr(el, 'id', '') });
  const issue = (level: DesignIssue['level'], message: string, el?: XmlElement, onceKey?: string) => {
    if (onceKey) {
      if (once.has(onceKey)) return;
      once.add(onceKey);
    }
    issues.push({ level, message, source: el ? src(el) : undefined });
  };
  const attr = (el: XmlElement, name: string) => getAttr(el, name, '');

  // ---- canvas size & viewBox ----
  const vb = numList(attr(root, 'viewBox'));
  const hasVb = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
  let W = parseLength(attr(root, 'width')?.includes('%') ? undefined : attr(root, 'width'), 0);
  let H = parseLength(attr(root, 'height')?.includes('%') ? undefined : attr(root, 'height'), 0);
  if (W && !H && hasVb) H = (W * vb[3]) / vb[2];
  if (H && !W && hasVb) W = (H * vb[2]) / vb[3];
  if (!W || !H) {
    if (hasVb) { W = vb[2]; H = vb[3]; }
    else {
      W = 1080; H = 1080;
      issue('warning', 'The SVG has neither width/height nor a viewBox, so a 1080 × 1080 canvas was assumed.', root);
    }
  }
  const width = Math.max(1, Math.round(W));
  const height = Math.max(1, Math.round(H));
  if (width !== W || height !== H) issue('info', `Canvas size ${+W.toFixed(3)} × ${+H.toFixed(3)} was rounded to ${width} × ${height} px.`, root);

  const viewBoxMatrix = (box: number[], w: number, h: number, par: string | undefined): Matrix => {
    const [vx, vy, vw, vh] = box;
    const p = (par ?? 'xMidYMid meet').trim().split(/\s+/);
    if (p[0] === 'none') return multiply(scaleM(w / vw, h / vh), translate(-vx, -vy));
    const s = p[1] === 'slice' ? Math.max(w / vw, h / vh) : Math.min(w / vw, h / vh);
    const align = p[0] ?? 'xMidYMid';
    const ax = align.includes('xMin') ? 0 : align.includes('xMax') ? 1 : 0.5;
    const ay = align.includes('YMin') ? 0 : align.includes('YMax') ? 1 : 0.5;
    return multiply(translate((w - vw * s) * ax, (h - vh * s) * ay), multiply(scaleM(s), translate(-vx, -vy)));
  };
  const rootMatrix: Matrix = hasVb ? viewBoxMatrix(vb, width, height, attr(root, 'preserveAspectRatio')) : IDENTITY;
  const refW = hasVb ? vb[2] : width;
  const refH = hasVb ? vb[3] : height;
  const refDiag = Math.hypot(refW, refH) / Math.SQRT2;

  // ---- index ids, gradients, CSS ----
  const byId = new Map<string, XmlElement>();
  const rules: CssRule[] = [];
  let order = 0;
  for (const el of walkElements(root)) {
    const id = attr(el, 'id');
    if (id && !byId.has(id)) byId.set(id, el);
    if (el.local === 'style' && el.ns === svgNs) {
      const css = textContent(el).replace(/\/\*[\s\S]*?\*\//g, '');
      if (/@/.test(css)) issue('warning', 'CSS at-rules (@media, @font-face, @import, …) in <style> are ignored.', el, 'css-at');
      const cleaned = css.replace(/@[^{;]+;/g, '').replace(/@[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
      const re = /([^{}]+)\{([^{}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(cleaned))) {
        const decls = parseDecls(m[2]);
        for (const selRaw of m[1].split(',')) {
          const sel = selRaw.trim();
          const sm = /^([a-zA-Z][\w-]*)?(#[\w-]+)?((?:\.[\w-]+)*)$/.exec(sel);
          if (!sm || !sel) {
            issue('warning', `CSS selector "${sel}" is not supported (only tag, #id and .class selectors are). Its rules were ignored.`, el, `sel:${sel}`);
            continue;
          }
          const classes = sm[3] ? sm[3].split('.').filter(Boolean) : [];
          rules.push({ tag: sm[1], id: sm[2]?.slice(1), classes, specificity: (sm[2] ? 100 : 0) + classes.length * 10 + (sm[1] ? 1 : 0), order: order++, decls });
        }
      }
    }
  }
  rules.sort((a, b) => a.specificity - b.specificity || a.order - b.order);

  const computeStyle = (el: XmlElement, parent: Style): Style => {
    const style: Style = {};
    for (const k of INHERITED) if (parent[k] !== undefined) style[k] = parent[k];
    for (const a of el.attrs) if (a.ns === '' && PROPS.has(a.local)) style[a.local] = a.value.trim();
    if (rules.length) {
      const id = attr(el, 'id');
      const classes = (attr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
      for (const r of rules) {
        if (r.tag && r.tag !== el.local) continue;
        if (r.id && r.id !== id) continue;
        if (r.classes.some((c) => !classes.includes(c))) continue;
        Object.assign(style, r.decls);
      }
    }
    const inline = attr(el, 'style');
    if (inline) Object.assign(style, parseDecls(inline));
    for (const k of Object.keys(style)) if (style[k] === 'inherit') { if (parent[k] !== undefined) style[k] = parent[k]; else delete style[k]; }
    return style;
  };

  // ---- paints ----
  const gradientCache = new Map<string, Paint>();
  const buildGradient = (id: string, user: XmlElement): Paint | null => {
    if (gradientCache.has(id)) return gradientCache.get(id)!;
    const el = byId.get(id);
    if (!el || (el.local !== 'linearGradient' && el.local !== 'radialGradient')) {
      if (el?.local === 'pattern') issue('warning', `Pattern fill "#${id}" is not supported; the element is drawn without a fill.`, user, `pat:${id}`);
      else issue('warning', `Fill references "#${id}", which is not a gradient in this file.`, user, `grad:${id}`);
      return null;
    }
    const chain: XmlElement[] = [];
    let cur: XmlElement | undefined = el;
    while (cur && chain.length < 10 && !chain.includes(cur)) {
      chain.push(cur);
      const href: string | undefined = getAttr(cur, 'href', '') ?? getAttr(cur, 'href', NS.xlink);
      cur = href?.startsWith('#') ? byId.get(href.slice(1)) : undefined;
    }
    const pick = (name: string) => { for (const g of chain) { const v = attr(g, name); if (v !== undefined) return v; } return undefined; };
    const stopsEl = chain.find((g) => g.children.some((c) => c.type === 'element' && c.local === 'stop'));
    const stops: GradientStop[] = [];
    if (stopsEl) {
      for (const s of stopsEl.children) {
        if (s.type !== 'element' || s.local !== 'stop') continue;
        const st = computeStyle(s, {});
        const offRaw = attr(s, 'offset') ?? '0';
        let offset = offRaw.trim().endsWith('%') ? parseFloat(offRaw) / 100 : parseFloat(offRaw);
        offset = Math.min(1, Math.max(stops.length ? stops[stops.length - 1].offset : 0, Number.isFinite(offset) ? offset : 0));
        const color = parseColor(st['stop-color'] ?? 'black') ?? { r: 0, g: 0, b: 0, a: 1 };
        stops.push({ offset, color: withAlpha(color, parseFloat(st['stop-opacity'] ?? '1')) });
      }
    }
    let paint: Paint;
    if (!stops.length) paint = { type: 'none' };
    else if (stops.length === 1) paint = { type: 'solid', color: stops[0].color };
    else {
      const units = pick('gradientUnits') === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox';
      const L = (v: string | undefined, def: number, ref: number) => {
        if (v === undefined) return def;
        if (units === 'objectBoundingBox') return v.trim().endsWith('%') ? parseFloat(v) / 100 : parseFloat(v);
        return parseLength(v, ref) ?? def;
      };
      const transform = parseTransform(pick('gradientTransform')) ?? IDENTITY;
      const bbox = units === 'objectBoundingBox';
      if (el.local === 'linearGradient') {
        paint = { type: 'linear', x1: L(pick('x1'), 0, refW), y1: L(pick('y1'), 0, refH), x2: L(pick('x2'), bbox ? 1 : refW, refW), y2: L(pick('y2'), 0, refH), units, transform, stops, sourceId: id };
      } else {
        const cx = L(pick('cx'), bbox ? 0.5 : refW / 2, refW);
        const cy = L(pick('cy'), bbox ? 0.5 : refH / 2, refH);
        paint = { type: 'radial', cx, cy, r: L(pick('r'), bbox ? 0.5 : refDiag / 2, refDiag), fx: L(pick('fx'), cx, refW), fy: L(pick('fy'), cy, refH), units, transform, stops, sourceId: id };
      }
    }
    gradientCache.set(id, paint);
    return paint;
  };

  const parsePaint = (value: string | undefined, style: Style, el: XmlElement, opacityFactor: number): Paint => {
    if (value === undefined) return { type: 'solid', color: { r: 0, g: 0, b: 0, a: opacityFactor } };
    const v = value.trim();
    if (v === 'none') return { type: 'none' };
    const url = /^url\(\s*['"]?#([^'")]+)['"]?\s*\)\s*(.*)$/.exec(v);
    if (url) {
      const g = buildGradient(url[1], el);
      if (g) {
        if (g.type === 'solid') return { type: 'solid', color: withAlpha(g.color, opacityFactor) };
        if (g.type === 'linear' || g.type === 'radial') return opacityFactor === 1 ? g : { ...g, stops: g.stops.map((s) => ({ ...s, color: withAlpha(s.color, opacityFactor) })) };
        return g;
      }
      return url[2] ? parsePaint(url[2], style, el, opacityFactor) : { type: 'none' };
    }
    const c = v === 'currentColor' ? parseColor(style.color ?? 'black') : parseColor(v);
    if (!c) {
      issue('warning', `Colour "${v}" is not recognised; black was used.`, el, `color:${v}`);
      return { type: 'solid', color: { r: 0, g: 0, b: 0, a: opacityFactor } };
    }
    return { type: 'solid', color: withAlpha(c, opacityFactor) };
  };

  // ---- animations ----
  let durationMs = 0;
  const parseAnimations = (el: XmlElement): Animation[] => {
    const out: Animation[] = [];
    for (const a of el.children) {
      if (a.type !== 'element' || a.ns !== svgNs) continue;
      if (a.local !== 'animate' && a.local !== 'animateTransform') {
        if (a.local === 'animateMotion' || a.local === 'set') issue('warning', `<${a.local}> animations are not converted.`, a, `anim:${a.local}`);
        continue;
      }
      const dur = parseClock(attr(a, 'dur'));
      const beginRaw = attr(a, 'begin');
      const begin = beginRaw === undefined ? 0 : parseClock(beginRaw);
      if (!dur || begin === undefined) {
        issue('warning', `Animation skipped: only simple timing (a numeric "begin" and a finite "dur") is supported.`, a);
        continue;
      }
      let property: Animation['property'];
      let arity: number;
      if (a.local === 'animate') {
        if (attr(a, 'attributeName') !== 'opacity') {
          issue('warning', `Animation of "${attr(a, 'attributeName')}" is not converted (only opacity and transforms are).`, a);
          continue;
        }
        property = 'opacity';
        arity = 1;
      } else {
        const type = attr(a, 'type') ?? 'translate';
        if (type !== 'translate' && type !== 'rotate' && type !== 'scale') {
          issue('warning', `animateTransform type "${type}" is not converted.`, a);
          continue;
        }
        if (attr(a, 'additive') !== 'sum' && el.attrs.some((x) => x.local === 'transform')) {
          issue('info', 'This animateTransform replaces the element transform (additive="replace"); it was applied on top of it instead.', a, `additive:${elementPath(el)}`);
        }
        property = type;
        arity = type === 'rotate' ? 3 : 2;
      }
      const valuesRaw = attr(a, 'values');
      const values: number[][] = valuesRaw
        ? valuesRaw.split(';').map((s) => numList(s)).filter((v) => v.length)
        : [numList(attr(a, 'from')), numList(attr(a, 'to'))].filter((v) => v.length);
      if (values.length < 2) {
        issue('warning', 'Animation skipped: it needs at least two values (from/to or values).', a);
        continue;
      }
      const norm = values.map((v) => {
        if (property === 'scale' && v.length === 1) return [v[0], v[0]];
        if (property === 'translate' && v.length === 1) return [v[0], 0];
        if (property === 'rotate') return [v[0], v[1] ?? 0, v[2] ?? 0];
        return v.slice(0, arity);
      });
      const keyTimes = numList(attr(a, 'keyTimes'));
      const kts = keyTimes.length === norm.length ? keyTimes : norm.map((_, k) => k / (norm.length - 1));
      const keyframes: Keyframe[] = norm.map((v, k) => ({ t: begin + kts[k] * dur, v: property === 'rotate' ? [v[0]] : v }));
      if (attr(a, 'repeatCount') || attr(a, 'repeatDur')) issue('info', 'Repeating animation: one cycle is converted; set looping in the target app.', a, `repeat:${elementPath(a)}`);
      durationMs = Math.max(durationMs, begin + dur);
      out.push({ property, keyframes, center: property === 'rotate' ? [norm[0][1], norm[0][2]] : undefined, source: src(a) });
    }
    return out;
  };

  // ---- tree walk ----
  let nodeSeq = 0;
  const counters: Record<string, number> = {};
  const nameFor = (el: XmlElement, base: string) => attr(el, 'id') ?? `${base} ${(counters[base] = (counters[base] ?? 0) + 1)}`;
  const SKIP = new Set(['defs', 'style', 'title', 'desc', 'metadata', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'symbol', 'marker', 'pattern', 'filter', 'script', 'animate', 'animateTransform', 'animateMotion', 'set', 'font', 'font-face', 'cursor', 'view']);

  const visit = (el: XmlElement, parentMatrix: Matrix, parentStyle: Style, out: DesignNode[], useStack: string[]) => {
    if (el.ns !== svgNs) return;
    if (SKIP.has(el.local)) {
      if (el.local === 'script') issue('info', '<script> elements are never executed.', el, 'script');
      return;
    }
    if (el.local === 'foreignObject') { issue('warning', '<foreignObject> (embedded HTML) is not rendered.', el); return; }
    const style = computeStyle(el, parentStyle);
    if (style.display === 'none') { issue('info', `<${el.name}> has display:none and was skipped.`, el); return; }
    if (style.visibility === 'hidden' || style.visibility === 'collapse') { issue('info', `<${el.name}> is hidden (visibility:hidden) and was skipped.`, el); return; }
    const local = parseTransform(attr(el, 'transform'));
    if (local === null) issue('warning', `Transform "${attr(el, 'transform')}" could not be parsed and was ignored.`, el);
    let matrix = multiply(parentMatrix, local ?? IDENTITY);
    const opacity = Math.min(1, Math.max(0, parseFloat(style.opacity ?? '1') || 0));
    for (const p of ['clip-path', 'mask', 'filter'] as const) {
      if (style[p] && style[p] !== 'none') issue('warning', `${p} on <${el.name}> is not supported and was ignored, so the element may look different.`, el, `${p}:${elementPath(el)}`);
    }
    const base = () => ({ id: `n${++nodeSeq}`, matrix, opacity, source: src(el), animations: parseAnimations(el) });
    const fillOpacity = parseFloat(style['fill-opacity'] ?? '1');
    const fill = () => parsePaint(style.fill, style, el, Number.isFinite(fillOpacity) ? fillOpacity : 1);
    const stroke = (): Stroke | undefined => {
      if (!style.stroke || style.stroke === 'none') return undefined;
      const so = parseFloat(style['stroke-opacity'] ?? '1');
      const paint = parsePaint(style.stroke, style, el, Number.isFinite(so) ? so : 1);
      if (paint.type === 'none') return undefined;
      return { paint, width: parseLength(style['stroke-width'], refDiag) ?? 1 };
    };
    const L = (name: string, ref: number, def = 0) => parseLength(attr(el, name), ref) ?? def;

    switch (el.local) {
      case 'g':
      case 'a':
      case 'switch':
      case 'svg': {
        if (el.local === 'switch') issue('info', '<switch> was treated as a group (all children are drawn).', el, 'switch');
        if (el.local === 'svg' && el !== root) {
          const box = numList(attr(el, 'viewBox'));
          const w = L('width', refW, refW);
          const h = L('height', refH, refH);
          matrix = multiply(matrix, translate(L('x', refW), L('y', refH)));
          if (box.length === 4 && box[2] > 0 && box[3] > 0) matrix = multiply(matrix, viewBoxMatrix(box, w, h, attr(el, 'preserveAspectRatio')));
        }
        const group: GroupNode = { ...base(), kind: 'group', name: nameFor(el, 'Group'), matrix, children: [] };
        for (const c of el.children) if (c.type === 'element') visit(c, matrix, style, group.children, useStack);
        if (group.children.length) out.push(group);
        return;
      }
      case 'use': {
        const href = getAttr(el, 'href', '') ?? getAttr(el, 'href', NS.xlink);
        if (!href?.startsWith('#')) { issue('warning', `<use> pointing to "${href ?? ''}" is not supported (only references within this file are).`, el); return; }
        const target = byId.get(href.slice(1));
        if (!target) { issue('warning', `<use> references "${href}", which does not exist.`, el); return; }
        if (useStack.includes(href) || useStack.length > 16) { issue('warning', `<use> reference loop at "${href}" was stopped.`, el); return; }
        const m2 = multiply(matrix, translate(L('x', refW), L('y', refH)));
        const group: GroupNode = { ...base(), kind: 'group', name: nameFor(el, 'Group'), matrix: m2, children: [] };
        if (target.local === 'symbol') {
          const box = numList(attr(target, 'viewBox'));
          const sm = box.length === 4 && box[2] > 0 && box[3] > 0 ? multiply(m2, viewBoxMatrix(box, L('width', refW, box[2]), L('height', refH, box[3]), attr(target, 'preserveAspectRatio'))) : m2;
          const symStyle = computeStyle(target, style);
          for (const c of target.children) if (c.type === 'element') visit(c, sm, symStyle, group.children, [...useStack, href]);
        } else visit(target, m2, style, group.children, [...useStack, href]);
        if (group.children.length) out.push(group);
        return;
      }
      case 'rect': {
        const w = L('width', refW);
        const h = L('height', refH);
        if (w <= 0 || h <= 0) { issue('info', '<rect> with zero width or height draws nothing and was skipped.', el); return; }
        let rx = parseLength(attr(el, 'rx'), refW);
        let ry = parseLength(attr(el, 'ry'), refH);
        if (rx === undefined) rx = ry ?? 0;
        if (ry === undefined) ry = rx;
        out.push({ ...base(), kind: 'rect', name: nameFor(el, 'Rectangle'), x: L('x', refW), y: L('y', refH), width: w, height: h, rx: Math.min(rx, w / 2), ry: Math.min(ry, h / 2), fill: fill(), stroke: stroke() });
        return;
      }
      case 'circle':
      case 'ellipse': {
        const rx = el.local === 'circle' ? L('r', refDiag) : L('rx', refW);
        const ry = el.local === 'circle' ? rx : L('ry', refH);
        if (rx <= 0 || ry <= 0) { issue('info', `<${el.local}> with zero radius draws nothing and was skipped.`, el); return; }
        out.push({ ...base(), kind: 'ellipse', name: nameFor(el, 'Ellipse'), cx: L('cx', refW), cy: L('cy', refH), rx, ry, fill: fill(), stroke: stroke() });
        return;
      }
      case 'line':
      case 'polyline':
      case 'polygon':
      case 'path': {
        let segs;
        if (el.local === 'path') {
          const d = attr(el, 'd') ?? '';
          segs = parsePath(d);
          if (!segs) { issue('warning', 'Path data could not be parsed; the path was skipped.', el); return; }
        } else if (el.local === 'line') {
          segs = polySegs([L('x1', refW), L('y1', refH), L('x2', refW), L('y2', refH)], false);
        } else {
          const pts = numList(attr(el, 'points'));
          segs = polySegs(pts.length % 2 ? pts.slice(0, -1) : pts, el.local === 'polygon');
        }
        if (segs.length < 2) { issue('info', `<${el.local}> has no drawable geometry and was skipped.`, el); return; }
        const isLine = el.local === 'line';
        out.push({
          ...base(), kind: 'path', name: nameFor(el, isLine ? 'Line' : 'Path'), d: segsToD(segs), shapeTag: el.local,
          fill: isLine ? { type: 'none' } : fill(), fillRule: style['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero', stroke: stroke(),
        });
        return;
      }
      case 'image': {
        const href = (getAttr(el, 'href', '') ?? getAttr(el, 'href', NS.xlink) ?? '').trim();
        if (!href || href.startsWith('#')) return;
        const key = referenceFromValue(href, { adapter: 'svg', confidence: 'schema', evidence: '', usage: { line: 0, col: 0, elementPath: '', elementName: '' } }).key;
        out.push({
          ...base(), kind: 'image', name: nameFor(el, 'Image'), x: L('x', refW), y: L('y', refH), width: L('width', refW), height: L('height', refH),
          assetKey: key, href: href.length > 120 ? href.slice(0, 120) + '…' : href, preserveAspectRatio: attr(el, 'preserveAspectRatio') ?? 'xMidYMid meet',
        });
        return;
      }
      case 'text': {
        const lines: string[] = [];
        let current = '';
        let x = numList(attr(el, 'x'))[0];
        let y = numList(attr(el, 'y'))[0];
        const pushLine = () => { const t = current.replace(/\s+/g, ' ').trim(); if (t) lines.push(t); current = ''; };
        const collect = (node: XmlElement, first: boolean) => {
          for (const c of node.children) {
            if (c.type === 'text') current += c.value;
            else if (c.type === 'element' && (c.local === 'tspan' || c.local === 'textPath' || c.local === 'a')) {
              const breaks = attr(c, 'x') !== undefined || attr(c, 'y') !== undefined || attr(c, 'dy') !== undefined;
              if (first && x === undefined && attr(c, 'x') !== undefined) x = numList(attr(c, 'x'))[0];
              if (first && y === undefined && attr(c, 'y') !== undefined) y = numList(attr(c, 'y'))[0];
              if (breaks && current.trim()) pushLine();
              if (c.local === 'textPath') issue('warning', 'Text on a path is converted as straight text.', c, 'textpath');
              collect(c, false);
            }
          }
        };
        collect(el, true);
        pushLine();
        if (!lines.length) return;
        const fontSize = parseLength(style['font-size'], 16) ?? 16;
        const weightRaw = (style['font-weight'] ?? 'normal').toLowerCase();
        const fontWeight = weightRaw === 'bold' || weightRaw === 'bolder' ? 700 : weightRaw === 'normal' || weightRaw === 'lighter' ? 400 : parseInt(weightRaw, 10) || 400;
        const family = (style['font-family'] ?? 'sans-serif').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
        const node: TextNode = {
          ...base(), kind: 'text', name: attr(el, 'id') ?? lines[0].slice(0, 32), x: x ?? 0, y: y ?? 0, lines, fontFamily: family, fontSize, fontWeight,
          fontStyle: style['font-style'] === 'italic' || style['font-style'] === 'oblique' ? 'italic' : 'normal',
          anchor: style['text-anchor'] === 'middle' ? 'middle' : style['text-anchor'] === 'end' ? 'end' : 'start', fill: fill(),
        };
        out.push(node);
        return;
      }
      default:
        issue('warning', `<${el.name}> is not interpreted and was skipped.`, el, `el:${el.local}`);
    }
  };

  const nodes: DesignNode[] = [];
  const rootStyle = computeStyle(root, {});
  for (const c of root.children) if (c.type === 'element') visit(c, rootMatrix, rootStyle, nodes, []);
  const rootAnims = parseAnimations(root);
  if (rootAnims.length) issue('warning', 'Animations on the root <svg> element are not converted.', root);

  return { width, height, durationMs, nodes, issues, sourceFormat: 'svg' };
}

export const _test = { parseLength, parseClock };
export type { RGBA };
