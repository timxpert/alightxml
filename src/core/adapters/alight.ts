/**
 * Alight Motion scene XML (projects and presets exported by the app, and files generated for it).
 * Images are declared once in <media uri=…> and referenced by layers through the same uri in fillImage.
 * The filename/title attributes are labels of the original file, never paths.
 */
import { getAttr, getAttrNode, walkElements } from '../xml/query';
import type { XmlElement } from '../xml/types';
import type { AssetReference } from '../assets/types';
import { basename } from '../project/vfs';
import { referenceFromValue, usageOf } from './common';
import { claimKey, emptyResult, type FormatAdapter } from './types';

const LAYER_TAGS = new Set(['shape', 'text', 'drawing', 'embedScene', 'audio', 'camera', 'nullobj']);

export function isAlightScene(root: XmlElement): boolean {
  return root.local === 'scene' && (getAttr(root, 'ffver') !== undefined || getAttr(root, 'amver') !== undefined);
}

export const alightAdapter: FormatAdapter = {
  id: 'alight',
  name: 'Alight Motion project XML',
  designConversion: false,
  detect(doc) {
    if (!isAlightScene(doc.root)) return null;
    const am = getAttr(doc.root, 'am') ?? '';
    const preset = getAttr(doc.root, 'type') === 'preset';
    return {
      score: 100,
      reason: `Root element is <scene> with Alight Motion version attributes (ffver ${getAttr(doc.root, 'ffver') ?? '?'}${am ? `, ${am.replace('com.alightcreative.motion/', 'app ')}` : ''}).`,
      variant: preset ? 'Preset' : 'Project',
    };
  },
  async extract({ doc, fs }) {
    const r = emptyResult();
    const media = new Map<string, { el: XmlElement; key: string; type: string }>();
    const counts: Record<string, number> = {};
    let effects = 0;
    let keyframed = 0;
    let av = 0;

    const refFor = (uri: string, mediaEl: XmlElement | undefined, usageEl: XmlElement, attrName: string): AssetReference => {
      const attr = getAttrNode(usageEl, attrName)!;
      const title = (mediaEl && (getAttr(mediaEl, 'filename') || getAttr(mediaEl, 'title'))) || basename(uri);
      const base = {
        adapter: 'alight',
        confidence: 'schema' as const,
        evidence: 'Alight Motion declares each image in a <media> element; layers use the same uri in fillImage.',
        usage: usageOf(usageEl, attr, mediaEl ? { w: Number(getAttr(mediaEl, 'width')) || undefined, h: Number(getAttr(mediaEl, 'height')) || undefined } : undefined),
      };
      const key = `am-media:${uri.length > 200 ? `${uri.length}:${uri.slice(0, 64)}:${uri.slice(-64)}` : uri}`;
      if (/^data:/i.test(uri)) return { ...referenceFromValue(uri, base), key, label: title };
      if (/^(https?:)?\/\//i.test(uri)) return { ...referenceFromValue(uri, base), key };
      const byName = (name: string) => fs.findBySuffix([name]).files;
      if (/^content:/i.test(uri) || /^am-internal:/i.test(uri)) {
        const internal = /^am-internal:/i.test(uri);
        const wanted = internal ? basename(uri) : title;
        const hits = wanted ? byName(wanted) : [];
        if (hits.length === 1) {
          return {
            ...base, key, kind: 'project-path', value: hits[0].path, label: title,
            resolveMethod: internal ? 'Packaged media file matched by name' : 'Matched by the file name recorded in <media>',
            resolveNote: internal
              ? undefined
              : `The XML points to ${uri}, an image in the gallery of the phone that exported the project. XML Canvas used the imported file with the same name ("${hits[0].path}"); check that it is the same image.`,
          };
        }
        const reason = internal
          ? `Packaged media "${wanted}" is not among the imported files. Import the whole package folder or ZIP.`
          : hits.length > 1
            ? `The XML points to ${uri} (an image in the gallery of the phone that exported it). ${hits.length} imported files are named "${wanted}", so none was chosen.`
            : `The XML points to ${uri}: an image in the gallery of the phone that exported the project. The XML stores only that address and the name "${title}", not the image itself. Import the image file alongside the XML (same folder or ZIP) to show it here.`;
        return { ...base, key, kind: 'unresolvable', value: uri, label: title, failure: { status: 'missing', reason } };
      }
      return { ...referenceFromValue(uri, base), key, label: title };
    };

    for (const el of walkElements(doc.root)) {
      if (el.name === 'media') {
        const uri = getAttr(el, 'uri') ?? '';
        const type = getAttr(el, 'type') ?? '';
        for (const a of el.attrs) r.claimed.add(claimKey(a.pos.offset, a.name));
        if (!type.startsWith('image/') && type !== '') { av++; continue; }
        if (uri) media.set(uri, { el, key: '', type });
      } else if (LAYER_TAGS.has(el.name)) {
        counts[el.name] = (counts[el.name] ?? 0) + 1;
        for (const a of el.attrs) if (a.name === 'fillImage' || a.name === 'src' || a.name === 'fillVideo') r.claimed.add(claimKey(a.pos.offset, a.name));
      } else if (el.name === 'effect') effects++;
      else if (el.name === 'kf' && el.parent && el.parent.children.find((c) => c.type === 'element') === el) keyframed++;
    }

    const used = new Set<string>();
    for (const el of walkElements(doc.root)) {
      if (!LAYER_TAGS.has(el.name)) continue;
      const uri = getAttr(el, 'fillImage');
      if (!uri) continue;
      const m = media.get(uri);
      used.add(uri);
      r.references.push(refFor(uri, m?.el, el, 'fillImage'));
      if (!m) r.notes.push(`Layer "${getAttr(el, 'label') ?? getAttr(el, 'id')}" uses an image with no <media> declaration.`);
    }
    for (const [uri, m] of media) {
      if (used.has(uri)) continue;
      r.references.push(refFor(uri, m.el, m.el, 'uri'));
      r.notes.push(`Media "${getAttr(m.el, 'title') ?? uri.slice(0, 40)}" is declared but no layer uses it.`);
    }

    r.categories = [
      { key: 'media', label: 'Image media', count: media.size },
      { key: 'shape', label: 'Shape layers', count: counts.shape ?? 0 },
      { key: 'text', label: 'Text layers', count: counts.text ?? 0 },
      { key: 'embedScene', label: 'Groups / nested scenes', count: counts.embedScene ?? 0 },
      { key: 'effects', label: 'Effects', count: effects },
      { key: 'kf', label: 'Animated properties', count: keyframed },
    ];
    if (av) r.ignored.push({ label: 'Video / audio media', count: av, reason: 'Only images are shown.' });
    for (const tag of ['drawing', 'audio', 'camera', 'nullobj']) if (counts[tag]) r.ignored.push({ label: `<${tag}> layers`, count: counts[tag], reason: 'Not drawn on the canvas yet.' });
    if (effects) r.ignored.push({ label: 'Effects', count: effects, reason: 'Effects are listed but not rendered.' });
    return r;
  },
};
