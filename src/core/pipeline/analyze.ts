/** The analysis pipeline: decode → parse → detect format → extract references → resolve assets → interpret design. */
import { contentSweep } from '../adapters/generic';
import { detectFormat } from '../adapters/registry';
import type { IgnoredElement, StructureCategory } from '../adapters/types';
import { resolveReferences } from '../assets/resolver';
import type { ResolvedAsset } from '../assets/types';
import type { DesignScene } from '../design/model';
import { interpretSvg } from '../design/svgInterpreter';
import { decodeXmlBytes } from '../xml/decode';
import { parseXml } from '../xml/parser';
import { walkElements } from '../xml/query';
import { XmlParseError, type XmlStats, type XmlWarning } from '../xml/types';
import { ProjectFS, type ProjectFile, type ProjectSourceKind } from '../project/vfs';

export const MAX_XML_CHARS = 150 * 1024 * 1024;

export interface AnalysisInput {
  kind: ProjectSourceKind;
  files: ProjectFile[];
  /** Project path of the XML to analyse; null for pasted text. */
  xmlPath: string | null;
  pastedText?: string;
}

export interface FoldRange {
  start: number;
  end: number;
}

export interface ParseFailure {
  code: string;
  message: string;
  hint?: string;
  line: number;
  col: number;
}

export interface AnalysisResult {
  xmlPath: string | null;
  sourceText: string;
  encoding: string;
  byteLength: number;
  decodeWarnings: string[];
  error?: ParseFailure;
  parseWarnings: XmlWarning[];
  stats?: XmlStats;
  rootName?: string;
  folds: FoldRange[];
  format?: { id: string; name: string; variant?: string; reason: string; designConversion: boolean; alternatives: Array<{ id: string; name: string; score: number }> };
  structure?: { categories: StructureCategory[]; ignored: IgnoredElement[]; notes: string[] };
  assets: ResolvedAsset[];
  design?: DesignScene;
  designError?: string;
  timings: Record<string, number>;
}

export type ProgressFn = (stage: string, done?: number, total?: number) => void;

export async function analyze(input: AnalysisInput, progress: ProgressFn = () => {}): Promise<AnalysisResult> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const fs = new ProjectFS(input.kind, input.files);

  progress('Reading XML');
  let sourceText: string;
  let encoding = 'UTF-8';
  let byteLength: number;
  let decodeWarnings: string[] = [];
  if (input.pastedText !== undefined) {
    sourceText = input.pastedText;
    byteLength = new TextEncoder().encode(sourceText).length;
  } else {
    const bytes = input.xmlPath ? await fs.read(input.xmlPath) : undefined;
    if (!bytes) throw new Error(`File "${input.xmlPath}" is not in the project.`);
    byteLength = bytes.length;
    const decoded = decodeXmlBytes(bytes);
    sourceText = decoded.text;
    encoding = decoded.encoding;
    decodeWarnings = decoded.warnings;
  }
  const base: AnalysisResult = { xmlPath: input.xmlPath, sourceText, encoding, byteLength, decodeWarnings, parseWarnings: [], folds: [], assets: [], timings };
  if (sourceText.length > MAX_XML_CHARS) {
    return { ...base, error: { code: 'too-large', message: `This XML has ${(sourceText.length / 1e6).toFixed(0)} million characters, above the ${MAX_XML_CHARS / 1024 / 1024} MB limit for in-browser analysis.`, line: 1, col: 1 } };
  }

  progress('Parsing XML');
  let t = performance.now();
  let doc;
  try {
    doc = parseXml(sourceText);
  } catch (e) {
    timings.parse = performance.now() - t;
    if (e instanceof XmlParseError) {
      return { ...base, sourceText: sourceText.replace(/\r\n?/g, '\n'), error: { code: e.code, message: e.message, hint: e.hint, line: e.pos.line, col: e.pos.col } };
    }
    throw e;
  }
  timings.parse = performance.now() - t;
  base.sourceText = doc.source;
  base.parseWarnings = doc.warnings;
  base.stats = doc.stats;
  base.rootName = doc.root.name;
  const lineStarts: number[] = [0];
  for (let k = 0; k < doc.source.length; k++) if (doc.source.charCodeAt(k) === 10) lineStarts.push(k + 1);
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  for (const el of walkElements(doc.root)) {
    if (base.folds.length >= 100_000) break;
    const endLine = lineOf(Math.max(el.pos.offset, el.endOffset - 1));
    if (endLine > el.pos.line) base.folds.push({ start: el.pos.line, end: endLine });
  }

  progress('Detecting format');
  t = performance.now();
  const match = detectFormat(doc);
  const ctx = { doc, xmlPath: input.xmlPath, fs };
  const extracted = await match.adapter.extract(ctx);
  const isGeneric = match.adapter.id === 'generic';
  const swept = contentSweep(doc, extracted.claimed, isGeneric ? 'generic' : `${match.adapter.id}+content`, isGeneric ? 'full' : 'data-uri');
  timings.detect = performance.now() - t;
  base.format = {
    id: match.adapter.id,
    name: match.adapter.name,
    variant: match.detection.variant,
    reason: match.detection.reason,
    designConversion: match.adapter.designConversion,
    alternatives: match.alternatives,
  };
  base.structure = { categories: extracted.categories, ignored: extracted.ignored, notes: extracted.notes };

  progress('Resolving images', 0, 0);
  t = performance.now();
  base.assets = await resolveReferences([...extracted.references, ...swept], { fs, xmlPath: input.xmlPath }, (done, total) => progress('Resolving images', done, total));
  timings.resolve = performance.now() - t;

  if (match.adapter.id === 'svg') {
    progress('Reconstructing design');
    t = performance.now();
    try {
      base.design = interpretSvg(doc);
    } catch (e) {
      base.designError = `The design could not be reconstructed: ${(e as Error).message}`;
    }
    timings.design = performance.now() - t;
  }
  timings.total = performance.now() - t0;
  return base;
}
