import type { AssetReference } from '../assets/types';
import type { ProjectFS } from '../project/vfs';
import type { XmlDocument } from '../xml/types';

export interface AdapterContext {
  doc: XmlDocument;
  xmlPath: string | null;
  fs: ProjectFS;
}

export interface StructureCategory {
  key: string;
  label: string;
  count: number;
}

export interface IgnoredElement {
  label: string;
  count: number;
  reason: string;
}

export interface AdapterResult {
  references: AssetReference[];
  categories: StructureCategory[];
  ignored: IgnoredElement[];
  notes: string[];
  /** Offsets of attributes/text already interpreted (so the content sweep does not report them twice). */
  claimed: Set<string>;
}

export interface Detection {
  score: number;
  reason: string;
  variant?: string;
}

export interface FormatAdapter {
  id: string;
  name: string;
  /** Whether the visual reconstruction / Alight Motion conversion can use this format. */
  designConversion: boolean;
  detect(doc: XmlDocument): Detection | null;
  extract(ctx: AdapterContext): Promise<AdapterResult>;
}

export const claimKey = (offset: number, what: string) => `${offset}:${what}`;

export function emptyResult(): AdapterResult {
  return { references: [], categories: [], ignored: [], notes: [], claimed: new Set() };
}
