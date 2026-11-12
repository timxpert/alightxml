import JSZip from 'jszip';
import { IMPORT_STEPS, UNTESTED_STATEMENT } from './report';
import type { AmConversion } from './writer';

export const safeFileName = (s: string) => (s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim() || 'project').slice(0, 80);

/**
 * Packages the scene XML with its media named <sig>.<ext> (the layout described for packaged projects),
 * plus the compatibility report. This is NOT an Alight link / Project Package: those only come from the app's cloud sharing.
 */
export async function buildPackage(conv: AmConversion, report: { markdown: string; json: unknown }, original?: { name: string; text: string }): Promise<Uint8Array> {
  const zip = new JSZip();
  const base = safeFileName(conv.options.title);
  zip.file(`${base}.xml`, conv.xml);
  for (const m of conv.media) zip.file(m.filename, m.bytes, { binary: true });
  zip.file('compatibility-report.md', report.markdown);
  zip.file('compatibility-report.json', JSON.stringify(report.json, null, 2));
  zip.file(
    'HOW-TO-IMPORT.txt',
    [
      `XML Canvas → Alight Motion package: ${conv.options.title}`,
      '',
      UNTESTED_STATEMENT,
      '',
      'Contents:',
      `  ${base}.xml  — Alight Motion scene XML`,
      ...conv.media.map((m) => `  ${m.filename}  — image "${m.title}" (${m.width}×${m.height}) → copy to ${m.uri.replace('file://', '').replace(/\/[^/]+$/, '/')}`),
      '  compatibility-report.md / .json  — what was converted, what was dropped, and why',
      ...(original ? [`  source/${original.name}  — the original, unmodified XML`] : []),
      '',
      'Import steps:',
      ...IMPORT_STEPS.map((s, k) => `  ${k + 1}. ${s}`),
      '',
    ].join('\n'),
  );
  if (original) zip.file(`source/${original.name}`, original.text);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
