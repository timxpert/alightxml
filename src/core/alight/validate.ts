/** Pre-export validation of generated Alight Motion scene XML and its media package. */
import { sha256Hex } from '../assets/hash';
import { parsePath } from '../design/path';
import { parseXml } from '../xml/parser';
import { childElements, getAttr, walkElements } from '../xml/query';
import { type XmlElement, XmlParseError } from '../xml/types';
import { TARGET } from './rules';
import type { AmConversion } from './writer';

export type CheckId = 'xml' | 'scene' | 'ids' | 'timing' | 'layer-types' | 'media' | 'transforms' | 'colors' | 'geometry' | 'text' | 'nesting' | 'metadata';

export interface ValidationIssue {
  level: 'error' | 'warning' | 'info';
  check: CheckId;
  message: string;
  line?: number;
  layerId?: number;
}

export interface ValidationCheck {
  id: CheckId;
  title: string;
  status: 'pass' | 'warn' | 'fail';
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  checks: ValidationCheck[];
}

const CHECK_TITLES: Record<CheckId, string> = {
  xml: 'Scene XML is well-formed',
  scene: 'Scene dimensions, duration and frame rate',
  metadata: 'Compatibility metadata (ffver, amver, am, platform)',
  ids: 'Layer ids are unique positive integers',
  timing: 'Layer start/end times within the scene',
  'layer-types': 'Only supported layer types are used',
  media: 'Media references resolve to packaged files',
  transforms: 'Transforms and keyframes are valid',
  colors: 'Colours use #aarrggbb',
  geometry: 'Shape geometry is valid',
  text: 'Text layers are complete',
  nesting: 'Groups contain a valid nested scene',
};

const LAYER_TAGS = new Set(['shape', 'text', 'embedScene']);
const COLOR_RE = /^#[0-9a-f]{8}$/;
const isInt = (v: string | undefined) => v !== undefined && /^-?\d+$/.test(v);

export async function validateConversion(conv: AmConversion): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];
  const add = (level: ValidationIssue['level'], check: CheckId, message: string, el?: XmlElement) => {
    const id = el ? getAttr(el, 'id') : undefined;
    issues.push({ level, check, message, line: el?.pos.line, layerId: isInt(id) ? Number(id) : undefined });
  };

  let doc;
  try {
    doc = parseXml(conv.xml);
  } catch (e) {
    const err = e as XmlParseError;
    add('error', 'xml', `Generated XML is not well-formed: ${err.message}${err.pos ? ` (line ${err.pos.line})` : ''}`);
    return finish(issues);
  }
  const root = doc.root;
  if (root.name !== 'scene') add('error', 'xml', `Root element must be <scene>, found <${root.name}>.`, root);

  const sceneChecks = (scene: XmlElement, isRoot: boolean) => {
    for (const a of ['width', 'height', 'exportWidth', 'exportHeight', 'totalTime', 'fps']) {
      const v = getAttr(scene, a);
      if (!isInt(v) || Number(v) <= 0) add('error', 'scene', `<scene ${a}="${v ?? ''}"> must be a positive integer.`, scene);
    }
    const w = Number(getAttr(scene, 'width'));
    const h = Number(getAttr(scene, 'height'));
    if (isRoot && (w > 3840 || h > 3840)) add('warning', 'scene', `Canvas ${w} × ${h} is larger than 3840 px; very large projects may be slow or limited on phones.`, scene);
    const fps = Number(getAttr(scene, 'fps'));
    if (isRoot && (fps < 12 || fps > 60)) add('warning', 'scene', `fps=${fps} is outside the 12–60 range offered by the app's frame-rate picker.`, scene);
    const bg = getAttr(scene, 'bgcolor');
    if (!bg || !COLOR_RE.test(bg)) add('error', 'colors', `bgcolor "${bg ?? ''}" must be #aarrggbb.`, scene);
    if (getAttr(scene, 'ffver') !== TARGET.ffver) add('error', 'metadata', `ffver must be ${TARGET.ffver}.`, scene);
    if (!isInt(getAttr(scene, 'amver'))) add('error', 'metadata', 'amver must be a numeric build code.', scene);
    if (!/^com\.alightcreative\.motion\/\d/.test(getAttr(scene, 'am') ?? '')) add('error', 'metadata', 'am must look like "com.alightcreative.motion/<version>".', scene);
    if (getAttr(scene, 'amplatform') !== 'android') add('warning', 'metadata', 'amplatform is not "android".', scene);
    let seenLayer = false;
    for (const c of childElements(scene)) {
      if (c.name === 'media') {
        if (seenLayer) add('error', 'media', '<media> declarations must come before all layers.', c);
        if (!isRoot) add('warning', 'media', 'Media declared inside a nested scene.', c);
      } else if (c.name === 'bookmark') continue;
      else if (LAYER_TAGS.has(c.name)) seenLayer = true;
      else add('error', 'layer-types', `<${c.name}> is not a layer type this exporter supports.`, c);
    }
  };

  const totalTime = Number(getAttr(root, 'totalTime'));
  sceneChecks(root, true);

  // Media declarations
  const declared = new Map<string, XmlElement>();
  for (const m of childElements(root).filter((c) => c.name === 'media')) {
    const uri = getAttr(m, 'uri') ?? '';
    const filename = getAttr(m, 'filename') ?? '';
    const sig = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;
    if (declared.has(uri)) add('error', 'media', `Media "${uri}" is declared twice.`, m);
    declared.set(uri, m);
    if (!/^[A-Za-z0-9]+$/.test(sig)) add('error', 'media', `Media file name "${filename}" must be a signature plus extension.`, m);
    if (uri !== `am-internal:///${filename}`) add('error', 'media', `Media uri "${uri}" does not point to its packaged file "${filename}".`, m);
    for (const a of ['size', 'width', 'height']) if (!isInt(getAttr(m, a)) || Number(getAttr(m, a)) <= 0) add('error', 'media', `Media ${a} "${getAttr(m, a) ?? ''}" must be a positive integer.`, m);
    if (!/^image\//.test(getAttr(m, 'type') ?? '')) add('error', 'media', `Media type "${getAttr(m, 'type') ?? ''}" is not an image MIME type.`, m);
    const entry = conv.media.find((e) => e.filename === filename);
    if (!entry) add('error', 'media', `Packaged file "${filename}" is missing.`, m);
    else {
      if (entry.bytes.byteLength !== Number(getAttr(m, 'size'))) add('error', 'media', `Packaged file "${filename}" is ${entry.bytes.byteLength} bytes but the declaration says ${getAttr(m, 'size')}.`, m);
      const hash = await sha256Hex(entry.bytes);
      if (!hash.startsWith(sig)) add('error', 'media', `Packaged file "${filename}" does not match its signature (content changed).`, m);
    }
  }

  const ids = new Map<number, XmlElement>();
  const used = new Set<string>();
  for (const el of walkElements(root)) {
    if (LAYER_TAGS.has(el.name)) {
      const idRaw = getAttr(el, 'id');
      if (!isInt(idRaw) || Number(idRaw) <= 0) add('error', 'ids', `Layer <${el.name}> has an invalid id "${idRaw ?? ''}".`, el);
      else {
        const id = Number(idRaw);
        if (ids.has(id)) add('error', 'ids', `Layer id ${id} is used twice (lines ${ids.get(id)!.pos.line} and ${el.pos.line}).`, el);
        ids.set(id, el);
      }
      const s = getAttr(el, 'startTime');
      const e = getAttr(el, 'endTime');
      if (!isInt(s) || !isInt(e) || Number(s) < 0 || Number(e) <= Number(s) || Number(e) > totalTime) add('error', 'timing', `Layer timing ${s}–${e} ms is invalid for a ${totalTime} ms scene.`, el);
      if (!getAttr(el, 'label')) add('warning', 'ids', 'Layer has no label.', el);
      const transforms = childElements(el).filter((c) => c.name === 'transform');
      if (transforms.length !== 1) add('error', 'transforms', `Layer must have exactly one <transform> (found ${transforms.length}).`, el);
      else checkTransform(transforms[0], add);
    }
    if (el.name === 'shape') {
      const ft = getAttr(el, 'fillType');
      if (!['color', 'gradient', 'media'].includes(ft ?? '')) add('error', 'layer-types', `Shape fillType "${ft ?? ''}" is not supported by this exporter.`, el);
      const s = getAttr(el, 's');
      const contour = childElements(el).find((c) => c.name === 'parameter');
      if (s !== undefined && s !== '.rect') add('error', 'geometry', `Shape template "${s}" is not one this exporter writes.`, el);
      for (const p of childElements(el).filter((c) => c.name === 'property')) {
        const v = (getAttr(p, 'value') ?? '').split(',').map(Number);
        if (getAttr(p, 'name') === 'size' && (getAttr(p, 'type') !== 'vec2' || v.length !== 2 || v.some((n) => !Number.isFinite(n) || n <= 0))) add('error', 'geometry', `Size property "${getAttr(p, 'value') ?? ''}" must be two positive numbers (type vec2).`, p);
      }
      if (s === '.rect' && !childElements(el).some((c) => c.name === 'property' && getAttr(c, 'name') === 'size')) add('warning', 'geometry', 'Real exports always write <property name="size"> on .rect layers.', el);
      if (s === undefined) {
        const d = contour ? childElements(contour).find((c) => c.name === 'contour') : undefined;
        const dv = d ? getAttr(d, 'd') : undefined;
        if (!dv) add('error', 'geometry', 'Shape without a template must contain <parameter><contour d="…"/></parameter>.', el);
        else if (!/^[MLCZ0-9.,\s-]+$/.test(dv) || !parsePath(dv)) add('error', 'geometry', 'Contour path must use only M, L, C and Z with numeric coordinates.', el);
      }
      if (ft === 'media') {
        const uri = getAttr(el, 'fillImage') ?? '';
        if (!declared.has(uri)) add('error', 'media', `fillImage "${uri}" does not match any <media> declaration.`, el);
        else used.add(uri);
        if (s !== '.rect') add('error', 'geometry', 'Media-filled shapes are written as .rect layers.', el);
        if (!getAttr(el, 'mediaFillMode')) add('error', 'media', 'Media-filled shape must declare mediaFillMode.', el);
      } else {
        const fc = childElements(el).find((c) => c.name === 'fillColor');
        if (!fc) add('error', 'colors', 'Colour/gradient shape has no <fillColor>.', el);
        if (ft === 'gradient') {
          const g = childElements(el).find((c) => c.name === 'gradient');
          if (!g) add('error', 'colors', 'fillType="gradient" requires a <gradient> element.', el);
          else {
            if (!['linear', 'radial', 'sweep'].includes(getAttr(g, 'type') ?? '')) add('error', 'colors', 'Gradient type must be linear, radial or sweep.', g);
            for (const a of ['startColor', 'endColor']) if (!COLOR_RE.test(getAttr(g, a) ?? '')) add('error', 'colors', `Gradient ${a} must be #aarrggbb.`, g);
            for (const a of ['start', 'end']) {
              const v = (getAttr(g, a) ?? '').split(',').map(Number);
              if (v.length !== 2 || v.some((n) => !Number.isFinite(n))) add('error', 'colors', `Gradient ${a} must be "x,y".`, g);
            }
          }
        }
      }
    }
    if (el.name === 'fillColor' && !COLOR_RE.test(getAttr(el, 'value') ?? '')) add('error', 'colors', `fillColor "${getAttr(el, 'value') ?? ''}" must be #aarrggbb.`, el);
    if (el.name === 'text') {
      if (!isInt(getAttr(el, 'size')) || Number(getAttr(el, 'size')) <= 0) add('error', 'text', 'Text size must be a positive integer.', el);
      if (!getAttr(el, 'font')) add('error', 'text', 'Text has no font descriptor.', el);
      if (!['left', 'center', 'right'].includes(getAttr(el, 'align') ?? '')) add('error', 'text', 'Text align must be left, center or right.', el);
      const content = childElements(el).find((c) => c.name === 'content');
      if (!content || !content.children.some((c) => c.type === 'text' && c.value.trim())) add('error', 'text', 'Text layer has no <content>.', el);
    }
    if (el.name === 'embedScene') {
      const scenes = childElements(el).filter((c) => c.name === 'scene');
      if (scenes.length !== 1) add('error', 'nesting', `Group must contain exactly one nested <scene> (found ${scenes.length}).`, el);
      else {
        sceneChecks(scenes[0], false);
        if (getAttr(scenes[0], 'width') !== getAttr(root, 'width') || getAttr(scenes[0], 'height') !== getAttr(root, 'height')) add('warning', 'nesting', 'Nested scene size differs from the main canvas.', el);
        if (!childElements(scenes[0]).some((c) => LAYER_TAGS.has(c.name))) add('warning', 'nesting', 'Group contains no layers.', el);
      }
    }
  }
  for (const uri of declared.keys()) if (!used.has(uri)) add('warning', 'media', `Media "${uri}" is declared but not used by any layer.`, declared.get(uri));
  if (ids.size === 0) add('error', 'layer-types', 'The scene contains no layers, so there is nothing to export.');
  return finish(issues);
}

function checkTransform(t: XmlElement, add: (level: ValidationIssue['level'], check: CheckId, message: string, el?: XmlElement) => void) {
  const arity: Record<string, number> = { location: 3, scale: 2, rotation: 1, opacity: 1, pivot: 2, skew: 2 };
  for (const p of childElements(t)) {
    const n = arity[p.name];
    if (!n) { add('warning', 'transforms', `Unknown transform property <${p.name}>.`, p); continue; }
    const check = (v: string | undefined, where: XmlElement) => {
      const parts = (v ?? '').split(',').map(Number);
      if (parts.length !== n || parts.some((x) => !Number.isFinite(x))) { add('error', 'transforms', `<${p.name}> value "${v ?? ''}" must have ${n} numeric component(s).`, where); return; }
      if (p.name === 'opacity' && (parts[0] < 0 || parts[0] > 1)) add('error', 'transforms', `Opacity ${parts[0]} is outside 0–1.`, where);
      if (p.name === 'scale' && parts.some((x) => x === 0)) add('warning', 'transforms', 'A scale of 0 makes the layer invisible.', where);
    };
    const kfs = childElements(p).filter((c) => c.name === 'kf');
    const value = getAttr(p, 'value');
    if (value !== undefined && kfs.length) add('error', 'transforms', `<${p.name}> has both a value and keyframes.`, p);
    if (value === undefined && !kfs.length) add('error', 'transforms', `<${p.name}> has neither a value nor keyframes.`, p);
    if (value !== undefined) check(value, p);
    let lastT = -1;
    for (const k of kfs) {
      const tv = Number(getAttr(k, 't'));
      if (!Number.isFinite(tv) || tv < 0 || tv > 1) add('error', 'transforms', `Keyframe time ${getAttr(k, 't')} is outside 0–1.`, k);
      if (tv < lastT) add('error', 'transforms', 'Keyframes are not in time order.', k);
      lastT = tv;
      check(getAttr(k, 'v'), k);
    }
  }
}

function finish(issues: ValidationIssue[]): ValidationResult {
  const checks: ValidationCheck[] = (Object.keys(CHECK_TITLES) as CheckId[]).map((id) => {
    const mine = issues.filter((i) => i.check === id);
    return { id, title: CHECK_TITLES[id], status: mine.some((i) => i.level === 'error') ? 'fail' : mine.some((i) => i.level === 'warning') ? 'warn' : 'pass' };
  });
  return { ok: !issues.some((i) => i.level === 'error'), issues, checks };
}
