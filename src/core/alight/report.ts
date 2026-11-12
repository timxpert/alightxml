import type { ResolvedAsset } from '../assets/types';
import type { DesignIssue } from '../design/model';
import { RULES, TARGET } from './rules';
import type { ValidationResult } from './validate';
import type { AmConversion } from './writer';

export interface ReportContext {
  sourceName: string;
  sourceFormat: string;
  assets: ResolvedAsset[];
  designIssues: DesignIssue[];
}

export const UNTESTED_STATEMENT =
  'This project has NOT been verified by importing it into Alight Motion. The structure follows real exported projects and the community reference built from the decompiled app, but parts of the mapping are assumptions (listed below). Treat this as a test build until it has been opened in Alight Motion with every layer editable.';

export function buildReport(conv: AmConversion, validation: ValidationResult, ctx: ReportContext) {
  const byType = conv.layers.reduce<Record<string, number>>((acc, l) => ((acc[l.layerType] = (acc[l.layerType] ?? 0) + 1), acc), {});
  const assumed = conv.rulesUsed.map((id) => RULES[id]).filter((r) => r && r.provenance === 'assumed');
  const missingAssets = ctx.assets.filter((a) => a.status !== 'resolved');
  const json = {
    generator: 'XML Canvas',
    generatedAt: new Date().toISOString(),
    source: { name: ctx.sourceName, format: ctx.sourceFormat },
    target: { ...TARGET },
    verifiedInAlightMotion: false,
    statement: UNTESTED_STATEMENT,
    scene: { title: conv.options.title, width: conv.width, height: conv.height, fps: conv.options.fps, totalTimeMs: conv.options.totalTime },
    summary: { layers: conv.layers.length, byType, dropped: conv.dropped.length, media: conv.media.length, validationErrors: validation.issues.filter((i) => i.level === 'error').length, validationWarnings: validation.issues.filter((i) => i.level === 'warning').length },
    validation,
    layers: conv.layers.map((l) => ({ id: l.id, type: l.layerType, tag: l.tag, label: l.label, animated: l.animated, source: `${l.source.elementPath} (line ${l.source.line})`, rules: l.rules, notes: l.notes })),
    dropped: conv.dropped.map((d) => ({ name: d.name, source: `${d.source.elementPath} (line ${d.source.line})`, reason: d.reason })),
    media: conv.media.map((m) => ({ file: m.filename, title: m.title, type: m.mime, bytes: m.size, width: m.width, height: m.height, sha256: m.sha256 })),
    unresolvedAssets: missingAssets.map((a) => ({ name: a.name, status: a.status, reason: a.reason })),
    interpretationIssues: ctx.designIssues,
    rules: conv.rulesUsed.map((id) => RULES[id]).filter(Boolean),
  };

  const md: string[] = [];
  md.push(`# Alight Motion compatibility report`, '');
  md.push(`**Source:** ${ctx.sourceName} (${ctx.sourceFormat})  `);
  md.push(`**Target:** ${TARGET.format}, ffver ${TARGET.ffver} (reference app version ${TARGET.appVersion})  `);
  md.push(`**Generated:** ${json.generatedAt} by XML Canvas`, '');
  md.push(`> ⚠️ ${UNTESTED_STATEMENT}`, '');
  md.push('## Summary', '');
  md.push(`| | |`, `|---|---|`);
  md.push(`| Canvas | ${conv.width} × ${conv.height} px, ${conv.options.fps} fps, ${(conv.options.totalTime / 1000).toFixed(2)} s |`);
  md.push(`| Layers written | ${conv.layers.length} (${Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}) |`);
  md.push(`| Elements dropped | ${conv.dropped.length} |`);
  md.push(`| Media files packaged | ${conv.media.length} |`);
  md.push(`| Validation | ${validation.ok ? 'passed' : 'FAILED'} (${json.summary.validationErrors} errors, ${json.summary.validationWarnings} warnings) |`, '');
  md.push('## Validation checks', '');
  for (const c of validation.checks) md.push(`- ${c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'} ${c.title}`);
  if (validation.issues.length) {
    md.push('', '### Issues', '');
    for (const i of validation.issues) md.push(`- **${i.level}** (${i.check}${i.line ? `, line ${i.line}` : ''}${i.layerId ? `, layer ${i.layerId}` : ''}): ${i.message}`);
  }
  md.push('', '## Layers', '', '| id | type | label | source | notes |', '|---|---|---|---|---|');
  for (const l of conv.layers) md.push(`| ${l.id} | ${'↳ '.repeat(l.depth)}${l.layerType}${l.animated ? ' (animated)' : ''} | ${l.label.replace(/\|/g, '\\|')} | line ${l.source.line} \`${l.source.elementPath}\` | ${l.notes.join(' ').replace(/\|/g, '\\|') || '—'} |`);
  if (conv.dropped.length) {
    md.push('', '## Not converted', '');
    for (const d of conv.dropped) md.push(`- **${d.name}** (line ${d.source.line}, \`${d.source.elementPath}\`): ${d.reason}`);
  }
  if (missingAssets.length) {
    md.push('', '## Unresolved images', '');
    for (const a of missingAssets) md.push(`- **${a.name}** — ${a.status}: ${a.reason ?? ''}`);
  }
  if (ctx.designIssues.length) {
    md.push('', '## Interpretation notes', '');
    for (const i of ctx.designIssues) md.push(`- ${i.level === 'warning' ? '⚠️' : 'ℹ️'} ${i.message}${i.source ? ` (line ${i.source.line})` : ''}`);
  }
  md.push('', '## Mapping rules and their evidence', '');
  md.push('Each rule is **observed** (seen in real Alight Motion exports), **documented** (community reference from the decompiled app) or **assumed** (not confirmed — verify these first).', '');
  for (const id of conv.rulesUsed) {
    const r = RULES[id];
    if (r) md.push(`- **${r.title}** — _${r.provenance}_. ${r.description} _Evidence:_ ${r.evidence}`);
  }
  if (assumed.length) {
    md.push('', '## What to check first in Alight Motion', '');
    for (const r of assumed) md.push(`- ${r.title}: ${r.description}`);
  }
  md.push('', '## Import workflow', '');
  md.push(...IMPORT_STEPS.map((s, k) => `${k + 1}. ${s}`));
  return { json, markdown: md.join('\n') + '\n' };
}

export const IMPORT_STEPS = [
  'Copy the generated scene .xml (and, if the project has images, the image files from the package) to your phone.',
  'In Alight Motion, import the XML using the app\'s XML/project import (for example, open the .xml with "Open with → Alight Motion", or use the import option on the Projects screen). Menu names vary between app versions.',
  'If images appear as missing, the app could not use the packaged am-internal media references. Replace each missing media with the matching packaged file (listed in this report by title).',
  'Check every layer: the scene should open with each supported element as its own editable layer. Note anything that differs, especially the rules marked "assumed".',
  'XML Canvas cannot create Alight links or QR codes. Those Project Packages are produced only by Alight Motion\'s own cloud sharing (Export → Project Package), after the project is open in the app.',
];
