import { NS } from '../xml/types';
import { getAttr, getAttrNode, leafText, walkElements } from '../xml/query';
import { claimKey, emptyResult, type FormatAdapter } from './types';
import { referenceFromValue, usageOf } from './common';
import type { XmlElement } from '../xml/types';

/** FictionBook 2: images are <binary id content-type>Base64</binary> elements referenced by <image l:href="#id"/>. */
export const fb2Adapter: FormatAdapter = {
  id: 'fb2',
  name: 'FictionBook 2 (FB2)',
  designConversion: false,
  detect(doc) {
    if (doc.root.local === 'FictionBook' && doc.root.ns === NS.fb2) return { score: 100, reason: 'Root element is <FictionBook> in the FictionBook 2.0 namespace.' };
    return null;
  },
  async extract({ doc }) {
    const r = emptyResult();
    const binaries = new Map<string, XmlElement>();
    const images: XmlElement[] = [];
    let sections = 0;
    let paragraphs = 0;
    for (const el of walkElements(doc.root)) {
      if (el.ns !== NS.fb2) continue;
      if (el.local === 'binary') {
        const id = getAttr(el, 'id');
        if (id) binaries.set(id, el);
      } else if (el.local === 'image') images.push(el);
      else if (el.local === 'section') sections++;
      else if (el.local === 'p') paragraphs++;
    }
    const binaryRef = (id: string, el: XmlElement, usageEl: XmlElement, usageAttr?: ReturnType<typeof getAttrNode>) => {
      const text = leafText(el) ?? '';
      if (el.children[0]) r.claimed.add(claimKey(el.children[0].pos.offset, '#text'));
      r.references.push({
        key: `fb2-binary:${id}`,
        kind: 'base64',
        value: text,
        label: id,
        adapter: 'fb2',
        confidence: 'schema',
        evidence: 'FB2 stores images as Base64 inside <binary> elements; <image> elements point to them with "#id".',
        declaredMime: getAttr(el, 'content-type'),
        usage: usageOf(usageEl, usageAttr ?? undefined),
      });
    };
    const referenced = new Set<string>();
    for (const img of images) {
      const href = img.attrs.find((a) => a.local === 'href');
      if (!href) {
        r.notes.push(`<${img.name}> at line ${img.pos.line} has no href.`);
        continue;
      }
      r.claimed.add(claimKey(href.pos.offset, href.name));
      const v = href.value.trim();
      if (v.startsWith('#')) {
        const id = v.slice(1);
        const bin = binaries.get(id);
        if (bin) {
          referenced.add(id);
          binaryRef(id, bin, img, href);
        } else {
          r.references.push({
            key: `fb2-binary:${id}`, kind: 'unresolvable', value: v, label: id, adapter: 'fb2', confidence: 'schema',
            evidence: 'FB2 <image> elements point to <binary> elements by id.',
            usage: usageOf(img, href),
            failure: { status: 'missing', reason: `The book refers to "#${id}", but it contains no <binary id="${id}"> element.` },
          });
        }
      } else {
        r.references.push(referenceFromValue(v, { adapter: 'fb2', confidence: 'schema', evidence: 'FB2 <image> with an external href.', usage: usageOf(img, href) }));
      }
    }
    for (const [id, bin] of binaries) {
      if (referenced.has(id)) continue;
      binaryRef(id, bin, bin);
      r.notes.push(`<binary id="${id}"> is embedded but never referenced by an <image>.`);
    }
    r.categories = [
      { key: 'images', label: 'Image references', count: images.length },
      { key: 'binaries', label: 'Embedded binaries', count: binaries.size },
      { key: 'sections', label: 'Sections', count: sections },
      { key: 'paragraphs', label: 'Paragraphs', count: paragraphs },
    ];
    r.notes.push('FB2 is a flowing e-book format with no fixed layout, so only its images are extracted.');
    return r;
  },
};
