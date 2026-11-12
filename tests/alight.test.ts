import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { convertToAlightMotion, type AmOptions } from '../src/core/alight/writer';
import { validateConversion } from '../src/core/alight/validate';
import { buildReport } from '../src/core/alight/report';
import { buildPackage } from '../src/core/alight/package';
import { RULES } from '../src/core/alight/rules';
import type { ResolvedAsset } from '../src/core/assets/types';
import { interpretSvg } from '../src/core/design/svgInterpreter';
import { walkNodes } from '../src/core/design/model';
import { parseXml } from '../src/core/xml/parser';
import { childElements, getAttr, walkElements } from '../src/core/xml/query';
import { decompose, parseTransform } from '../src/core/design/matrix';
import { parsePath, segBounds } from '../src/core/design/path';
import { analyzeFolder } from './helpers';

const opts = (o: Partial<AmOptions> = {}): AmOptions => ({ title: 'Test', fps: 30, totalTime: 5000, background: null, sourceName: 'test.svg', ...o });
const svg = (body: string, attrs = 'width="200" height="100"') => interpretSvg(parseXml(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`));
const am = (scene: ReturnType<typeof svg>, assets = new Map<string, ResolvedAsset>(), o?: Partial<AmOptions>) => {
  const conv = convertToAlightMotion(scene, assets, opts(o));
  return { conv, doc: parseXml(conv.xml) };
};
const layerEls = (doc: ReturnType<typeof parseXml>) => [...walkElements(doc.root)].filter((e) => ['shape', 'text', 'embedScene'].includes(e.name));
const tval = (el: ReturnType<typeof layerEls>[number], prop: string) => {
  const t = childElements(el).find((c) => c.name === 'transform')!;
  const p = childElements(t).find((c) => c.name === prop);
  return p ? getAttr(p, 'value') : undefined;
};

describe('geometry helpers', () => {
  it('parses transform lists and decomposes them', () => {
    const m = parseTransform('translate(10 20) rotate(30) scale(2 3)')!;
    const d = decompose(m);
    expect(d.tx).toBeCloseTo(10);
    expect(d.rotation).toBeCloseTo(30);
    expect(d.scaleX).toBeCloseTo(2);
    expect(d.scaleY).toBeCloseTo(3);
    expect(parseTransform('rotate(oops)')).toBeNull();
  });
  it('converts arcs and relative commands to absolute cubics', () => {
    const segs = parsePath('M10 10 h20 v20 a10 10 0 0 1 -20 0 z')!;
    expect(segs.every((s) => 'MLCZ'.includes(s.c))).toBe(true);
    const b = segBounds(segs)!;
    expect(b.maxY).toBeCloseTo(40, 0);
    expect(parsePath('M 0 0 L x')).toBeNull();
  });
});

describe('SVG interpreter', () => {
  it('applies viewBox scaling, CSS classes, inheritance and opacity', () => {
    const s = svg('<style>.a{fill:#ff0000}</style><g fill="#00ff00" opacity="0.5"><rect class="a" width="10" height="10"/><rect x="20" width="10" height="10"/></g>', 'width="400" height="200" viewBox="0 0 200 100"');
    expect([s.width, s.height]).toEqual([400, 200]);
    const g = s.nodes[0];
    expect(g.kind).toBe('group');
    expect(g.opacity).toBe(0.5);
    const [a, b] = g.kind === 'group' ? g.children : [];
    expect(a.kind === 'rect' && a.fill.type === 'solid' && a.fill.color).toMatchObject({ r: 255, g: 0, b: 0 });
    expect(b.kind === 'rect' && b.fill.type === 'solid' && b.fill.color).toMatchObject({ r: 0, g: 255, b: 0 });
    expect(decompose(a.matrix).scaleX).toBeCloseTo(2);
  });
  it('reports what it cannot interpret', () => {
    const s = svg('<rect width="10" height="10" clip-path="url(#c)"/><foreignObject/><circle r="0"/>');
    const msgs = s.issues.map((i) => i.message).join('\n');
    expect(msgs).toContain('clip-path');
    expect(msgs).toContain('foreignObject');
    expect(msgs).toContain('zero radius');
  });
  it('builds text lines from tspans and resolves <use>', () => {
    const s = svg('<defs><rect id="r" width="5" height="5"/></defs><text x="3" y="40" font-size="20">Hello <tspan x="3" dy="24">world</tspan></text><use href="#r" x="50"/>');
    const t = s.nodes.find((n) => n.kind === 'text');
    expect(t?.kind === 'text' && t.lines).toEqual(['Hello', 'world']);
    expect([...walkNodes(s.nodes)].some((n) => n.kind === 'rect')).toBe(true);
  });
});

describe('Alight Motion writer', () => {
  it('writes a .rect layer with 100-unit scale at the rectangle centre', () => {
    const { doc } = am(svg('<rect x="10" y="20" width="50" height="30" fill="#336699"/>'));
    const [layer] = layerEls(doc);
    expect(layer.name).toBe('shape');
    expect(getAttr(layer, 's')).toBe('.rect');
    expect(getAttr(layer, 'fillType')).toBe('color');
    expect(tval(layer, 'location')).toBe('35.000000,35.000000,0.000000');
    expect(tval(layer, 'scale')).toBe('0.500000,0.300000');
    expect(getAttr(childElements(layer).find((c) => c.name === 'fillColor')!, 'value')).toBe('#ff336699');
    const size = childElements(layer).find((c) => c.name === 'property')!;
    expect([getAttr(size, 'name'), getAttr(size, 'type'), getAttr(size, 'value')]).toEqual(['size', 'vec2', '100.000000,100.000000']);
  });

  it('matches the structure of a real Alight Motion 5.0.273 export', async () => {
    const { readFileSync } = await import('node:fs');
    const real = parseXml(readFileSync(new URL('../samples/alight/real-export-5.0.273.xml', import.meta.url), 'utf8'));
    const shape = (doc: ReturnType<typeof parseXml>, fill: string) => [...walkElements(doc.root)].find((e) => e.name === 'shape' && getAttr(e, 'fillType') === fill)!;
    const sig = (el: ReturnType<typeof shape>) => ({
      attrs: el.attrs.map((a) => a.name).filter((n) => n !== 'fillImage'),
      children: childElements(el).map((c) => (c.name === 'property' ? `property:${getAttr(c, 'name')}:${getAttr(c, 'type')}` : c.name)),
    });
    const ours = am(svg('<rect x="0" y="0" width="540" height="960" fill="#ff5a1f"/>')).doc;
    expect(sig(shape(ours, 'color'))).toEqual(sig(shape(real, 'color')));
    const realMedia = childElements(real.root).find((c) => c.name === 'media')!;
    const pngBytes = new Uint8Array(readFileSync(new URL('../samples/svg-poster/assets/logo.png', import.meta.url)));
    const asset = { id: 'a', key: 'path:logo.png', name: 'logo.png', kind: 'path', status: 'resolved', location: 'logo.png', format: 'png', mime: 'image/png', width: 128, height: 128, byteLength: pngBytes.length, sha256: 'ab'.repeat(32), bytes: pngBytes.buffer, warnings: [], usages: [], adapter: 'svg', confidence: 'schema', evidence: '', rawReference: 'logo.png' } as ResolvedAsset;
    const withImg = am(svg('<image href="logo.png" width="128" height="128"/>'), new Map([['path:logo.png', asset]])).doc;
    const ourMedia = childElements(withImg.root).find((c) => c.name === 'media')!;
    expect(ourMedia.attrs.map((a) => a.name)).toEqual(realMedia.attrs.map((a) => a.name));
    expect(sig(shape(withImg, 'media'))).toEqual({ attrs: sig(shape(real, 'media')).attrs, children: ['transform', 'property:size:vec2'] });
  });
  it('writes the scene root like an exported project', () => {
    const { doc } = am(svg('<rect width="5" height="5"/>'), undefined, { background: { r: 0, g: 0, b: 0, a: 1 } });
    const root = doc.root;
    expect(root.name).toBe('scene');
    for (const a of ['title', 'width', 'height', 'exportWidth', 'exportHeight', 'precompose', 'bgcolor', 'totalTime', 'fps', 'modifiedTime', 'amver', 'ffver', 'am', 'amplatform']) expect(getAttr(root, a)).toBeDefined();
    expect(getAttr(root, 'bgcolor')).toBe('#ff000000');
    expect(getAttr(root, 'ffver')).toBe('106');
  });
  it('converts circles and rotated rounded rectangles to contour shapes with centred coordinates', () => {
    const { doc } = am(svg('<circle cx="50" cy="50" r="20" fill="red"/>'));
    const [layer] = layerEls(doc);
    expect(getAttr(layer, 's')).toBeUndefined();
    expect(tval(layer, 'location')).toBe('50.000000,50.000000,0.000000');
    const contour = [...walkElements(layer)].find((e) => e.name === 'contour')!;
    const b = segBounds(parsePath(getAttr(contour, 'd')!)!)!;
    expect(b.minX).toBeCloseTo(-20, 1);
    expect(b.maxX).toBeCloseTo(20, 1);
  });
  it('maps two-stop gradients and keeps first/last of multi-stop ones', () => {
    const { conv, doc } = am(svg('<linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset=".5" stop-color="#f00"/><stop offset="1" stop-color="#fff"/></linearGradient><rect width="100" height="50" fill="url(#g)"/>'));
    const [layer] = layerEls(doc);
    expect(getAttr(layer, 'fillType')).toBe('gradient');
    const g = childElements(layer).find((c) => c.name === 'gradient')!;
    expect(getAttr(g, 'startColor')).toBe('#ff000000');
    expect(getAttr(g, 'endColor')).toBe('#ffffffff');
    expect(getAttr(g, 'start')).toBe('0.000000,0.000000');
    expect(getAttr(g, 'end')).toBe('1.000000,0.000000');
    expect(conv.layers[0].notes.join(' ')).toContain('3 stops');
  });
  it('turns groups into embedScene with a full-size nested scene and globally unique ascending ids', () => {
    const { doc } = am(svg('<rect width="5" height="5"/><g opacity="0.5"><rect width="5" height="5"/><g><rect width="5" height="5"/></g></g>'));
    const layers = layerEls(doc);
    expect(layers.map((l) => l.name)).toEqual(['shape', 'embedScene', 'shape', 'embedScene', 'shape']);
    expect(layers.map((l) => Number(getAttr(l, 'id')))).toEqual([1, 2, 3, 4, 5]);
    const nested = childElements(layers[1]).find((c) => c.name === 'scene')!;
    expect(getAttr(nested, 'width')).toBe('200');
    expect(tval(layers[1], 'location')).toBe('100.000000,50.000000,0.000000');
    expect(tval(layers[1], 'opacity')).toBe('0.500000');
  });
  it('writes keyframes normalised to the layer duration, sampling rotations', () => {
    const { conv, doc } = am(svg('<rect x="0" y="0" width="10" height="10"><animateTransform attributeName="transform" type="rotate" from="0 50 50" to="90 50 50" dur="2s"/><animate attributeName="opacity" from="0" to="1" dur="1s"/></rect>'), undefined, { totalTime: 4000 });
    const [layer] = layerEls(doc);
    const t = childElements(layer).find((c) => c.name === 'transform')!;
    const rot = childElements(t).find((c) => c.name === 'rotation')!;
    const kfs = childElements(rot);
    expect(getAttr(kfs[0], 't')).toBe('0.000000');
    expect(getAttr(kfs[kfs.length - 1], 't')).toBe('0.500000');
    expect(Number(getAttr(kfs[kfs.length - 1], 'v'))).toBeCloseTo(90);
    expect(kfs.length).toBeGreaterThanOrEqual(7); // 90° in ≤15° steps
    const loc = childElements(childElements(t).find((c) => c.name === 'location')!);
    // Rotating 90° around (50,50) moves the centre (5,5) to (95,5)
    expect(getAttr(loc[loc.length - 1], 'v')).toBe('95.000000,5.000000,0.000000');
    const op = childElements(childElements(t).find((c) => c.name === 'opacity')!);
    expect(getAttr(op[1], 't')).toBe('0.250000');
    expect(conv.layers[0].animated).toBe(true);
  });
  it('drops stroke-only shapes and unresolved images with reasons', () => {
    const { conv } = am(svg('<line x1="0" y1="0" x2="10" y2="10" stroke="#000"/><image href="missing.png" width="10" height="10"/>'));
    expect(conv.layers.length).toBe(0);
    expect(conv.dropped.map((d) => d.reason).join('\n')).toMatch(/strokes are not converted[\s\S]*unknown/);
  });
});

describe('poster → Alight Motion end to end', async () => {
  const r = await analyzeFolder('svg-poster', 'poster.svg');
  const assets = new Map(r.assets.map((a) => [a.key, a]));
  const conv = convertToAlightMotion(r.design!, assets, opts({ title: 'Summer Launch', totalTime: Math.max(5000, r.design!.durationMs) }));
  const validation = await validateConversion(conv);

  it('produces valid scene XML', () => {
    expect(validation.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(validation.ok).toBe(true);
  });
  it('packages each resolved image once, named by signature', () => {
    const doc = parseXml(conv.xml);
    const media = childElements(doc.root).filter((c) => c.name === 'media');
    expect(media.length).toBe(conv.media.length);
    expect(conv.media.length).toBe(5); // photo, logo, inline badge, Badge.PNG, texture
    for (const m of conv.media) {
      expect(m.filename).toBe(`${m.sig}.${m.ext}`);
      expect(m.sha256.startsWith(m.sig)).toBe(true);
    }
    const fills = [...walkElements(doc.root)].filter((e) => getAttr(e, 'fillType') === 'media').map((e) => getAttr(e, 'fillImage'));
    expect(fills.length).toBe(5);
    expect(fills.every((f) => media.some((m) => getAttr(m, 'uri') === f))).toBe(true);
  });
  it('preserves image aspect ratio (slice keeps the image proportions)', () => {
    const hero = conv.layers.find((l) => l.label === 'Hero photo')!;
    const doc = parseXml(conv.xml);
    const el = [...walkElements(doc.root)].find((e) => getAttr(e, 'id') === String(hero.id))!;
    const size = childElements(el).find((c) => c.name === 'property' && getAttr(c, 'name') === 'size')!;
    const [sw, sh] = getAttr(size, 'value')!.split(',').map(Number);
    expect(sw / sh).toBeCloseTo(640 / 400, 3);
    expect(tval(el, 'scale')).toBeUndefined();
  });
  it('reports dropped elements: missing/remote images and the stroke-only divider', () => {
    const names = conv.dropped.map((d) => d.name);
    expect(names).toEqual(expect.arrayContaining(['Sponsor logo', 'Map', 'Divider']));
  });
  it('writes the expected layer mix', () => {
    const types = conv.layers.reduce<Record<string, number>>((a, l) => ((a[l.layerType] = (a[l.layerType] ?? 0) + 1), a), {});
    expect(types).toMatchObject({ Image: 5, Text: 4, Group: 2, Rectangle: 2 }); // Background + rotated square-cornered tag
    expect(types['Vector shape']).toBeGreaterThanOrEqual(5);
  });
  it('detects tampering with packaged media', async () => {
    const tampered = { ...conv, media: conv.media.map((m, k) => (k === 0 ? { ...m, bytes: new Uint8Array(m.bytes.length) } : m)) };
    const v = await validateConversion(tampered);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.message.includes('does not match its signature'))).toBe(true);
  });
  it('builds a report and a package that say the result is unverified', async () => {
    const report = buildReport(conv, validation, { sourceName: 'poster.svg', sourceFormat: 'SVG', assets: r.assets, designIssues: r.design!.issues });
    expect(report.json.verifiedInAlightMotion).toBe(false);
    expect(report.markdown).toContain('NOT been verified');
    expect(report.markdown).toContain('_assumed_');
    const zipBytes = await buildPackage(conv, report, { name: 'poster.svg', text: r.sourceText });
    const zip = await JSZip.loadAsync(zipBytes);
    const names = Object.keys(zip.files);
    expect(names).toContain('Summer Launch.xml');
    expect(names).toContain('source/poster.svg');
    for (const m of conv.media) expect(names).toContain(m.filename);
  });
  it('every rule used has a provenance', () => {
    for (const id of conv.rulesUsed) expect(['observed', 'documented', 'assumed']).toContain(RULES[id].provenance);
  });
});
