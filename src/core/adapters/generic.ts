/**
 * Content-based sweep for XML formats without a dedicated adapter (and for anything an adapter did not claim).
 * Element and attribute NAMES are never used as evidence. A value is reported only when the value itself shows
 * it is an image: a data:image URI, Base64 whose decoded header is an image signature, or a path/URL ending in
 * an image file extension. Path matches are confirmed later by sniffing the actual bytes.
 */
import { decodeBase64, looksLikeBase64 } from '../assets/base64';
import { fnv1a } from '../assets/hash';
import { sniffSignature } from '../assets/sniff';
import type { AssetReference } from '../assets/types';
import { walkElements } from '../xml/query';
import type { XmlDocument } from '../xml/types';
import { IMAGE_EXT_RE, referenceFromValue, usageOf } from './common';
import { claimKey, emptyResult, type AdapterResult, type FormatAdapter } from './types';

function classify(value: string): { kind: 'data' | 'base64' | 'pathlike'; evidence: string } | null {
  const v = value.trim();
  if (!v || v.length > 50_000_000) return null;
  if (/^data:image\//i.test(v)) return { kind: 'data', evidence: 'The value is a data:image/… URI.' };
  if (v.length < 2048 && !/[\n<>"|*]/.test(v)) {
    const noQuery = v.replace(/[?#].*$/, '');
    if (IMAGE_EXT_RE.test(noQuery) && !/\s{2,}/.test(v)) return { kind: 'pathlike', evidence: `The value is a path or URL ending in ".${noQuery.split('.').pop()}". It is confirmed only if the file's bytes are an image.` };
  }
  if (looksLikeBase64(v, 96)) {
    const head = v.replace(/\s+/g, '').slice(0, 64);
    const decoded = decodeBase64(head.slice(0, head.length - (head.length % 4)));
    if (decoded.ok) {
      const sig = sniffSignature(decoded.bytes);
      if (sig && sig !== 'svg') return { kind: 'base64', evidence: `The value is Base64 whose decoded bytes start with a ${sig.toUpperCase()} signature.` };
    }
  }
  return null;
}

/**
 * mode 'full' (unknown schemas): data URIs, Base64 signatures and image-like paths.
 * mode 'data-uri' (schemas with a dedicated adapter): only unambiguous data:image URIs, because the adapter already
 * knows which attributes hold image references (e.g. Word's <pic:cNvPr name="image.png"> is a label, not a path).
 */
export function contentSweep(doc: XmlDocument, claimed: Set<string>, adapterId: string, mode: 'full' | 'data-uri' = 'full'): AssetReference[] {
  const refs: AssetReference[] = [];
  const accept = (c: ReturnType<typeof classify>) => (c && (mode === 'full' || c.kind === 'data') ? c : null);
  for (const el of walkElements(doc.root)) {
    for (const a of el.attrs) {
      if (a.prefix === 'xmlns' || a.name === 'xmlns' || claimed.has(claimKey(a.pos.offset, a.name))) continue;
      const c = accept(classify(a.value));
      if (!c) continue;
      const base = { adapter: adapterId, confidence: 'content' as const, evidence: c.evidence, usage: usageOf(el, a) };
      if (c.kind === 'base64') refs.push({ ...base, kind: 'base64', value: a.value, label: el.local, key: `b64:${a.value.length}:${fnv1a(a.value)}` });
      else refs.push(referenceFromValue(a.value, base));
    }
    const textNodes = el.children.filter((ch) => ch.type === 'text');
    if (textNodes.length === 0 || el.children.some((ch) => ch.type === 'element')) continue;
    const first = textNodes[0];
    if (claimed.has(claimKey(first.pos.offset, '#text'))) continue;
    const text = textNodes.map((t) => (t.type === 'text' ? t.value : '')).join('');
    const c = accept(classify(text));
    if (!c) continue;
    const base = { adapter: adapterId, confidence: 'content' as const, evidence: c.evidence, usage: usageOf(el) };
    if (c.kind === 'base64') refs.push({ ...base, kind: 'base64', value: text, label: el.local, key: `b64:${text.length}:${fnv1a(text)}` });
    else refs.push(referenceFromValue(text, base));
  }
  return refs;
}

export const genericAdapter: FormatAdapter = {
  id: 'generic',
  name: 'Generic XML',
  designConversion: false,
  detect: () => ({ score: 1, reason: 'No dedicated adapter recognised this schema, so images are detected from attribute and text values only.' }),
  async extract({ doc }): Promise<AdapterResult> {
    const r = emptyResult();
    const names = new Map<string, number>();
    for (const el of walkElements(doc.root)) names.set(el.name, (names.get(el.name) ?? 0) + 1);
    r.categories = [...names].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ key: name, label: `<${name}>`, count }));
    r.notes.push(`Root element <${doc.root.name}>${doc.root.ns ? ` in namespace ${doc.root.ns}` : ''}. This schema has no dedicated adapter, so element names are not interpreted.`);
    return r;
  },
};
