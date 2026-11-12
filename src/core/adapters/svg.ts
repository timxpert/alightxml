import { NS } from '../xml/types';
import { getAttrNode, walkElements } from '../xml/query';
import { claimKey, emptyResult, type FormatAdapter } from './types';
import { parseNumberAttr, referenceFromValue, usageOf } from './common';

const SHAPES = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path']);
const TEXT = new Set(['text', 'tspan', 'textPath']);
const GRADIENTS = new Set(['linearGradient', 'radialGradient']);
const ANIMATION = new Set(['animate', 'animateTransform', 'animateMotion', 'set']);
const DEFS = new Set(['defs', 'stop', 'title', 'desc', 'style', 'svg']);

export const svgAdapter: FormatAdapter = {
  id: 'svg',
  name: 'SVG (Scalable Vector Graphics)',
  designConversion: true,
  detect(doc) {
    if (doc.root.local !== 'svg') return null;
    if (doc.root.ns === NS.svg) return { score: 100, reason: 'Root element is <svg> in the SVG namespace (http://www.w3.org/2000/svg).' };
    if (doc.root.ns === '') return { score: 60, reason: 'Root element is <svg> but the SVG namespace is not declared; it is interpreted as SVG.' };
    return null;
  },
  async extract({ doc }) {
    const r = emptyResult();
    const svgNs = doc.root.ns;
    const counts = { groups: 0, shapes: 0, text: 0, gradients: 0, images: 0, uses: 0, clips: 0, filters: 0, animations: 0 };
    const ignored = new Map<string, { count: number; reason: string }>();
    const ignore = (label: string, reason: string) => {
      const e = ignored.get(label);
      if (e) e.count++;
      else ignored.set(label, { count: 1, reason });
    };

    for (const el of walkElements(doc.root)) {
      if (el.ns !== svgNs) {
        if (el.ns && el.parent && el.parent.ns === svgNs) ignore(`<${el.name}> (${el.ns.replace(/^https?:\/\//, '').split('/')[0]})`, 'Editor-specific metadata from another namespace; it has no visual effect in SVG.');
        continue;
      }
      const name = el.local;
      if (name === 'g') counts.groups++;
      else if (SHAPES.has(name)) counts.shapes++;
      else if (TEXT.has(name)) { if (name === 'text') counts.text++; }
      else if (GRADIENTS.has(name)) counts.gradients++;
      else if (name === 'use' || name === 'symbol') counts.uses++;
      else if (name === 'clipPath' || name === 'mask') counts.clips++;
      else if (name === 'filter' || name.startsWith('fe')) { if (name === 'filter') counts.filters++; }
      else if (ANIMATION.has(name)) counts.animations++;
      else if (name === 'script') ignore('<script>', 'Scripts are never executed by XML Canvas.');
      else if (name === 'foreignObject') ignore('<foreignObject>', 'Embedded HTML/foreign content is not rendered (it could contain active content).');
      else if (name === 'image') { /* handled below */ }
      else if (!DEFS.has(name) && name !== 'metadata' && name !== 'pattern' && name !== 'marker' && name !== 'a' && name !== 'switch') ignore(`<${name}>`, 'SVG element not interpreted yet.');

      if (name === 'image' || name === 'feImage') {
        const href = getAttrNode(el, 'href', '') ?? getAttrNode(el, 'href', NS.xlink);
        if (name === 'image') counts.images++;
        if (!href || !href.value.trim()) {
          r.notes.push(`<${name}> at line ${el.pos.line} has no href, so it shows nothing.`);
          continue;
        }
        r.claimed.add(claimKey(href.pos.offset, href.name));
        const declared = { w: parseNumberAttr(getAttrNode(el, 'width')?.value), h: parseNumberAttr(getAttrNode(el, 'height')?.value) };
        const base = {
          adapter: 'svg',
          confidence: 'schema' as const,
          evidence: `SVG <${name}> elements reference raster or vector images through ${href.name}.`,
          usage: usageOf(el, href, declared),
        };
        if (href.value.trim().startsWith('#')) {
          r.references.push({
            ...base, kind: 'unresolvable', key: `frag:${href.value}`, value: href.value, label: href.value,
            failure: { status: 'unsupported', reason: `"${href.value}" points to another element in this document, not to an image file. ${name === 'feImage' ? 'Filter images are not rendered yet.' : ''}`.trim() },
          });
        } else {
          r.references.push(referenceFromValue(href.value, base));
        }
      }
    }
    r.categories = [
      { key: 'images', label: 'Images', count: counts.images },
      { key: 'shapes', label: 'Shapes & paths', count: counts.shapes },
      { key: 'text', label: 'Text blocks', count: counts.text },
      { key: 'groups', label: 'Groups', count: counts.groups },
      { key: 'gradients', label: 'Gradients', count: counts.gradients },
      { key: 'uses', label: 'Symbols / <use>', count: counts.uses },
      { key: 'clips', label: 'Clip paths & masks', count: counts.clips },
      { key: 'filters', label: 'Filters', count: counts.filters },
      { key: 'animations', label: 'Animations', count: counts.animations },
    ];
    r.ignored = [...ignored].map(([label, v]) => ({ label, count: v.count, reason: v.reason }));
    return r;
  },
};
