import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { analyze } from '../src/core/pipeline/analyze';
import { analyzeFolder, analyzeSingle, byName, loadZip, SAMPLES } from './helpers';

describe('SVG poster (folder import)', async () => {
  const r = await analyzeFolder('svg-poster', 'poster.svg');
  it('detects SVG by namespace', () => {
    expect(r.error).toBeUndefined();
    expect(r.format?.id).toBe('svg');
    expect(r.format?.designConversion).toBe(true);
  });
  it('resolves the relative path against the XML folder', () => {
    const a = byName(r.assets, 'photo.jpg');
    expect(a).toMatchObject({ status: 'resolved', format: 'jpeg', width: 640, height: 400, filePath: 'assets/photo.jpg', confidence: 'schema' });
    expect(a.usages[0]).toMatchObject({ elementName: 'image', attribute: 'href', declaredWidth: 820 });
  });
  it('resolves xlink:href inside nested transformed groups', () => {
    expect(byName(r.assets, 'logo.png')).toMatchObject({ status: 'resolved', width: 128, height: 128 });
  });
  it('decodes the Base64 data URI', () => {
    const a = r.assets.find((x) => x.kind === 'data-uri')!;
    expect(a).toMatchObject({ status: 'resolved', format: 'png', width: 64, height: 64 });
  });
  it('resolves a case mismatch with a warning', () => {
    const a = byName(r.assets, 'Badge.PNG');
    expect(a.status).toBe('resolved');
    expect(a.warnings.join(' ')).toContain('case-sensitive');
  });
  it('matches an absolute Windows path only by its trailing name, with a warning', () => {
    const a = byName(r.assets, 'texture.png');
    expect(a.status).toBe('resolved');
    expect(a.method).toContain('trailing path');
    expect(a.warnings[0]).toContain('absolute path');
  });
  it('reports the missing file with the expected location', () => {
    const a = r.assets.find((x) => x.rawReference === 'assets/sponsor.png')!;
    expect(a.status).toBe('missing');
    expect(a.reason).toContain('"assets/sponsor.png"');
    expect(a.bytes).toBeUndefined();
  });
  it('does not contact remote servers', () => {
    const a = r.assets.find((x) => x.kind === 'url')!;
    expect(a).toMatchObject({ status: 'remote', url: 'https://example.com/images/venue-map.png' });
  });
  it('reports editor metadata from foreign namespaces instead of dropping it silently', () => {
    expect(r.structure?.ignored.some((i) => i.label.includes('metadata-note'))).toBe(true);
  });
  it('reconstructs the design', () => {
    expect(r.design?.width).toBe(1080);
    expect(r.design?.height).toBe(1350);
    expect(r.design?.durationMs).toBe(4000);
  });
});

describe('SVG poster (single file, no folder)', async () => {
  const r = await analyzeSingle('svg-poster/poster.svg');
  it('explains why relative paths cannot be resolved', () => {
    const a = r.assets.find((x) => x.rawReference === 'assets/photo.jpg')!;
    expect(a.status).toBe('missing');
    expect(a.reason).toContain('imported on its own');
  });
  it('still decodes embedded images', () => {
    expect(r.assets.find((x) => x.kind === 'data-uri')?.status).toBe('resolved');
  });
});

describe('ZIP import of the poster', async () => {
  const files = await loadZip(join(SAMPLES, '..', 'public', 'samples', 'svg-poster.zip'));
  it('resolves paths inside the archive', async () => {
    const stripped = files.map((f) => ({ ...f, path: f.path.replace(/^svg-poster\//, '') }));
    const r = await analyze({ kind: 'zip', files: stripped, xmlPath: 'poster.svg' });
    expect(byName(r.assets, 'photo.jpg').status).toBe('resolved');
  });
});

describe('FB2 book', async () => {
  const r = await analyzeSingle('fb2/lighthouse.fb2');
  it('decodes binaries referenced by #id', () => {
    expect(r.format?.id).toBe('fb2');
    expect(byName(r.assets, 'cover.jpg')).toMatchObject({ status: 'resolved', format: 'jpeg', width: 300, height: 420 });
  });
  it('trusts the bytes over a wrong content-type', () => {
    const a = byName(r.assets, 'emblem.png');
    expect(a.format).toBe('png');
    expect(a.warnings.join(' ')).toContain('declares the type "image/jpeg"');
  });
  it('reports a reference to a missing binary', () => {
    const a = r.assets.find((x) => x.rawReference === '#figure-1.png')!;
    expect(a.status).toBe('missing');
    expect(a.reason).toContain('<binary id="figure-1.png">');
  });
});

describe('Android project', async () => {
  const r = await analyzeFolder('android-app', 'app/src/main/res/layout/activity_main.xml');
  it('resolves @drawable to the highest-density bitmap', () => {
    expect(r.format?.id).toBe('android');
    const a = byName(r.assets, 'hero.png');
    expect(a).toMatchObject({ status: 'resolved', filePath: 'app/src/main/res/drawable-xxhdpi/hero.png', width: 480 });
    expect(a.warnings.join(' ')).toContain('drawable-mdpi');
  });
  it('resolves @mipmap WebP via app:srcCompat', () => {
    expect(byName(r.assets, 'ic_launcher.webp')).toMatchObject({ status: 'resolved', format: 'webp' });
  });
  it('explains XML drawables, framework resources and missing resources', () => {
    expect(r.assets.find((a) => a.rawReference === '@drawable/bg_card')?.status).toBe('unsupported');
    expect(r.assets.find((a) => a.rawReference === '@android:drawable/ic_menu_camera')?.reason).toContain('framework');
    expect(r.assets.find((a) => a.rawReference === '@drawable/promo_banner')?.status).toBe('missing');
  });
  it('does not treat android:id="@+id/imageTitle" or contentDescription as images', () => {
    expect(r.assets.length).toBe(5);
  });
});

describe('DOCX package', async () => {
  const files = await loadZip(join(SAMPLES, 'office', 'site-report.docx'));
  const r = await analyze({ kind: 'zip', files, xmlPath: 'word/document.xml' });
  it('follows relationships to word/media', () => {
    expect(r.format?.id).toBe('ooxml');
    const resolved = r.assets.filter((a) => a.status === 'resolved');
    expect(resolved.length).toBe(2);
    expect(r.assets.length).toBe(2); // <pic:cNvPr name="image.png"> is a label, not a reference
    expect(resolved.every((a) => a.filePath?.startsWith('word/media/'))).toBe(true);
  });
  it('explains missing .rels when the part is imported alone', async () => {
    const doc = files.find((f) => f.path === 'word/document.xml')!;
    const alone = await analyze({ kind: 'single-file', files: [{ ...doc, path: 'document.xml' }], xmlPath: 'document.xml' });
    expect(alone.assets.every((a) => a.status === 'missing' && a.reason!.includes('Import the whole'))).toBe(true);
  });
});

describe('Generic catalog (unknown schema)', async () => {
  const r = await analyzeFolder('catalog', 'catalog.xml');
  it('uses values, never element names, as evidence', () => {
    expect(r.format?.id).toBe('generic');
    const raws = r.assets.map((a) => a.rawReference);
    expect(raws).toContain('images/chair.jpg');
    expect(raws.some((x) => x.includes('Product image'))).toBe(false); // <imageCaption>
    expect(raws).not.toContain('2'); // <imageCount>
    expect(raws).not.toContain('docs/manual.pdf');
    expect(r.assets.every((a) => a.confidence === 'content')).toBe(true);
  });
  it('detects Base64 text by its decoded signature', () => {
    expect(r.assets.find((a) => a.kind === 'base64')).toMatchObject({ status: 'resolved', format: 'png', width: 120 });
  });
  it('detects data URIs in attributes', () => {
    expect(r.assets.find((a) => a.kind === 'data-uri')?.status).toBe('resolved');
  });
  it('rejects a file whose extension lies', () => {
    const a = byName(r.assets, 'notreally.png');
    expect(a.status).toBe('invalid');
    expect(a.reason).toContain('plain text');
  });
});

describe('Security and errors', () => {
  it('XXE sample parses without resolving entities', async () => {
    const r = await analyzeSingle('security/xxe.xml');
    expect(r.error).toBeUndefined();
    expect(r.parseWarnings.filter((w) => w.code === 'external-entity-blocked').length).toBeGreaterThanOrEqual(2);
    expect(r.sourceText).toContain('&secret;');
  });
  it('billion laughs does not expand', async () => {
    const r = await analyzeSingle('security/billion-laughs.xml');
    expect(r.error).toBeUndefined();
    expect(r.parseWarnings.some((w) => w.code === 'entity-not-expanded')).toBe(true);
  });
  it('active SVG content is reported, javascript: is refused', async () => {
    const r = await analyzeSingle('security/active-content.svg');
    expect(r.structure?.ignored.map((i) => i.label)).toEqual(expect.arrayContaining(['<script>', '<foreignObject>']));
    expect(r.assets.find((a) => a.rawReference.startsWith('javascript:'))?.status).toBe('unsupported');
  });
  it('broken XML returns a located error', async () => {
    const r = await analyzeSingle('broken/unclosed-tag.xml');
    expect(r.error).toMatchObject({ code: 'mismatched-tag', line: 8 });
    expect(r.error?.message).toContain('<image>');
    const amp = await analyzeSingle('broken/bad-ampersand.svg');
    expect(amp.error?.code).toBe('unescaped-ampersand');
    expect(amp.error?.hint).toContain('&amp;');
  });
  it('pasted XML has no folder', async () => {
    const text = readFileSync(join(SAMPLES, 'svg-poster/poster.svg'), 'utf8');
    const r = await analyze({ kind: 'paste', files: [], xmlPath: null, pastedText: text });
    expect(r.assets.find((a) => a.rawReference === 'assets/logo.png')?.reason).toContain('pasted as text');
  });
});
