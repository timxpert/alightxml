import { NS } from '../xml/types';
import { getAttr, walkElements } from '../xml/query';
import { parseXml } from '../xml/parser';
import { basename, dirname, joinPath, normalizePath } from '../project/vfs';
import { claimKey, emptyResult, type FormatAdapter } from './types';
import { referenceFromValue, usageOf } from './common';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PRES = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const SHEET_DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';

/** Office Open XML parts (word/document.xml, ppt/slides/slideN.xml, xl/drawings/drawingN.xml). */
export const ooxmlAdapter: FormatAdapter = {
  id: 'ooxml',
  name: 'Office Open XML part (Word / PowerPoint / Excel)',
  designConversion: false,
  detect(doc) {
    const ns = doc.root.ns;
    if (ns === WORD) return { score: 85, reason: 'Root element is in the WordprocessingML namespace.', variant: 'Word document part' };
    if (ns === PRES) return { score: 85, reason: 'Root element is in the PresentationML namespace.', variant: 'PowerPoint part' };
    if (ns === SHEET_DRAWING) return { score: 85, reason: 'Root element is a SpreadsheetML drawing.', variant: 'Excel drawing part' };
    for (const el of walkElements(doc.root)) if (el.ns === NS.drawingml) return { score: 70, reason: 'Contains DrawingML elements.', variant: 'DrawingML' };
    return null;
  },
  async extract({ doc, xmlPath, fs }) {
    const r = emptyResult();
    const relsPath = xmlPath ? `${dirname(xmlPath) ? dirname(xmlPath) + '/' : ''}_rels/${basename(xmlPath)}.rels` : null;
    const relsText = relsPath ? await fs.readText(relsPath) : undefined;
    const rels = new Map<string, { target: string; external: boolean; type: string }>();
    if (relsText) {
      try {
        const relDoc = parseXml(relsText);
        for (const el of walkElements(relDoc.root)) {
          if (el.local !== 'Relationship') continue;
          const id = getAttr(el, 'Id');
          const target = getAttr(el, 'Target');
          if (id && target) rels.set(id, { target, external: getAttr(el, 'TargetMode') === 'External', type: getAttr(el, 'Type') ?? '' });
        }
      } catch (e) {
        r.notes.push(`The relationship file ${relsPath} could not be parsed: ${(e as Error).message}`);
      }
    }
    let blips = 0;
    let paragraphs = 0;
    let shapes = 0;
    let vml = 0;
    for (const el of walkElements(doc.root)) {
      if (el.local === 'p' && el.ns === WORD) paragraphs++;
      if (el.local === 'sp') shapes++;
      if (el.ns === NS.vml && el.local === 'imagedata') vml++;
      if (!(el.local === 'blip' && el.ns === NS.drawingml)) continue;
      blips++;
      for (const a of el.attrs) {
        if (a.ns !== NS.officeRel || (a.local !== 'embed' && a.local !== 'link')) continue;
        r.claimed.add(claimKey(a.pos.offset, a.name));
        const base = {
          adapter: 'ooxml',
          confidence: 'schema' as const,
          evidence: `DrawingML <a:blip r:${a.local}> points to an image part through a relationship id.`,
          usage: usageOf(el, a),
        };
        const rel = rels.get(a.value);
        if (!relsText) {
          r.references.push({ ...base, kind: 'unresolvable', key: `rel:${a.value}`, value: a.value, label: a.value,
            failure: { status: 'missing', reason: `Relationship "${a.value}" is defined in ${relsPath ?? 'a .rels file'}, which is not among the imported files. Import the whole .docx/.pptx/.xlsx file (it is a ZIP) instead of this single XML part.` } });
        } else if (!rel) {
          r.references.push({ ...base, kind: 'unresolvable', key: `rel:${a.value}`, value: a.value, label: a.value,
            failure: { status: 'missing', reason: `Relationship "${a.value}" is not defined in ${relsPath}.` } });
        } else if (rel.external) {
          r.references.push(referenceFromValue(rel.target, base));
        } else {
          const target = rel.target.startsWith('/') ? normalizePath(rel.target) : joinPath(dirname(xmlPath ?? ''), rel.target);
          r.references.push({ ...base, kind: 'project-path', key: `pp:${target}`, value: target ?? rel.target, label: basename(rel.target) });
        }
      }
    }
    r.categories = [
      { key: 'images', label: 'Picture fills (a:blip)', count: blips },
      { key: 'paragraphs', label: 'Paragraphs', count: paragraphs },
      { key: 'shapes', label: 'Shapes', count: shapes },
    ];
    if (vml) r.ignored.push({ label: 'Legacy VML images (v:imagedata)', count: vml, reason: 'Legacy VML pictures are not interpreted yet.' });
    if (relsText) r.notes.push(`Relationships read from ${relsPath} (${rels.size} entries).`);
    return r;
  },
};
