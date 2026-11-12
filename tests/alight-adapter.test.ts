import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyze } from '../src/core/pipeline/analyze';
import { walkNodes } from '../src/core/design/model';
import { decompose } from '../src/core/design/matrix';
import { SAMPLES } from './helpers';

const file = (name: string) => new Uint8Array(readFileSync(`${SAMPLES}/alight/${name}`));

describe('Alight Motion project XML (real 5.0.273 export)', async () => {
  const xml = file('real-export-5.0.273.xml');
  const alone = await analyze({ kind: 'single-file', files: [{ path: 'New Project 110.xml', size: xml.length, data: xml }], xmlPath: 'New Project 110.xml' });
  it('is recognised as Alight Motion', () => {
    expect(alone.format?.id).toBe('alight');
    expect(alone.format?.reason).toContain('5.0.273');
  });
  it('reports one image (media + layer merged), explaining content:// URIs', () => {
    expect(alone.assets.length).toBe(1);
    const a = alone.assets[0];
    expect(a.status).toBe('missing');
    expect(a.reason).toContain('gallery of the phone');
    expect(a.usages[0].attribute).toBe('fillImage');
  });
  it('matches the image by its recorded file name when imported with it', async () => {
    const png = new Uint8Array(readFileSync(`${SAMPLES}/svg-poster/assets/logo.png`));
    const r = await analyze({ kind: 'files', files: [{ path: 'New Project 110.xml', size: xml.length, data: xml }, { path: 'picture-ok.png', size: png.length, data: png }], xmlPath: 'New Project 110.xml' });
    expect(r.assets[0].status).toBe('resolved');
    expect(r.assets[0].warnings[0]).toContain('same name');
  });
  it('draws the rectangle and image at their real sizes', () => {
    const nodes = [...walkNodes(alone.design!.nodes)];
    const rect = nodes.find((n) => n.name === 'Rectangle 1')!;
    const img = nodes.find((n) => n.kind === 'image')!;
    expect(rect.kind === 'rect' && [rect.width * decompose(rect.matrix).scaleX, rect.height * decompose(rect.matrix).scaleY]).toEqual([540, 960]);
    expect(img.kind === 'image' && img.width * decompose(img.matrix).scaleX).toBeCloseTo(772.5, 1);
    expect([alone.design!.width, alone.design!.height]).toEqual([1080, 1920]);
  });
});

describe('Alight Motion XML with a data: URI (tool-made)', async () => {
  const xml = file('tool-made-data-uri.xml');
  const r = await analyze({ kind: 'single-file', files: [{ path: 't.xml', size: xml.length, data: xml }], xmlPath: 't.xml' });
  it('decodes the embedded image once and does not treat filename labels as paths', () => {
    expect(r.assets.length).toBe(1);
    expect(r.assets[0]).toMatchObject({ status: 'resolved', format: 'png', width: 600, height: 600, name: 'inside-the-file.png' });
  });
});
