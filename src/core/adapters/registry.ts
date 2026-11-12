import type { XmlDocument } from '../xml/types';
import { alightAdapter } from './alight';
import { androidAdapter } from './android';
import { fb2Adapter } from './fb2';
import { genericAdapter } from './generic';
import { ooxmlAdapter } from './ooxml';
import { svgAdapter } from './svg';
import type { Detection, FormatAdapter } from './types';

/** Register new formats here. Order does not matter; the highest detection score wins. */
export const ADAPTERS: FormatAdapter[] = [alightAdapter, svgAdapter, fb2Adapter, androidAdapter, ooxmlAdapter, genericAdapter];

export interface AdapterMatch {
  adapter: FormatAdapter;
  detection: Detection;
  alternatives: Array<{ id: string; name: string; score: number }>;
}

export function detectFormat(doc: XmlDocument): AdapterMatch {
  const scored = ADAPTERS.map((adapter) => ({ adapter, detection: adapter.detect(doc) }))
    .filter((x): x is { adapter: FormatAdapter; detection: Detection } => x.detection !== null)
    .sort((a, b) => b.detection.score - a.detection.score);
  const [best, ...rest] = scored;
  return {
    adapter: best.adapter,
    detection: best.detection,
    alternatives: rest.filter((x) => x.adapter.id !== 'generic').map((x) => ({ id: x.adapter.id, name: x.adapter.name, score: x.detection.score })),
  };
}
