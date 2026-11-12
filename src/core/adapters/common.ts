import type { AssetReference, AssetUsage } from '../assets/types';
import { fnv1a } from '../assets/hash';
import { basename } from '../project/vfs';
import { elementPath } from '../xml/query';
import type { XmlAttr, XmlElement } from '../xml/types';

export function usageOf(el: XmlElement, attr?: XmlAttr, declared?: { w?: number; h?: number }): AssetUsage {
  return {
    line: attr?.pos.line ?? el.pos.line,
    col: attr?.pos.col ?? el.pos.col,
    elementPath: elementPath(el),
    elementName: el.name,
    attribute: attr?.name,
    declaredWidth: declared?.w,
    declaredHeight: declared?.h,
  };
}

export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|tiff?|heic)$/i;

/** Classifies a reference string written in the XML into a reference kind (no file-name guessing beyond the value). */
export function referenceFromValue(
  value: string,
  base: Omit<AssetReference, 'key' | 'kind' | 'value' | 'label'>,
): AssetReference {
  const v = value.trim();
  if (/^data:/i.test(v)) {
    return { ...base, kind: 'data-uri', value: v, label: 'Embedded data URI', key: `data:${v.length}:${fnv1a(v)}` };
  }
  if (/^(https?:)?\/\//i.test(v)) {
    return { ...base, kind: 'url', value: v, label: basename(v) || v, key: `url:${v}` };
  }
  return { ...base, kind: 'path', value: v, label: basename(v) || v, key: `path:${v}` };
}

export function parseNumberAttr(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}
