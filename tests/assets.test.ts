import { describe, expect, it } from 'vitest';
import { decodeBase64, decodeDataUri } from '../src/core/assets/base64';
import { sniffImage, sniffSignature } from '../src/core/assets/sniff';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES } from './helpers';

const read = (p: string) => new Uint8Array(readFileSync(join(SAMPLES, p)));

describe('base64', () => {
  it('decodes standard, url-safe and whitespace-wrapped input', () => {
    const r = decodeBase64('SGVs\nbG8g\r\nV29y bGQ=');
    expect(r.ok && new TextDecoder().decode(r.bytes)).toBe('Hello World');
    const u = decodeBase64('-_8');
    expect(u.ok && [...u.bytes]).toEqual([0xfb, 0xff]);
  });
  it('reports malformed data precisely', () => {
    const bad = decodeBase64('SGVs*G8=');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain('position 5');
    expect(decodeBase64('A').ok).toBe(false);
    expect(decodeBase64('QQ=A').ok).toBe(false);
  });
  it('decodes percent-encoded (non-base64) data URIs', () => {
    const r = decodeDataUri('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%2220%22%2F%3E');
    expect(r.ok).toBe(true);
    if (r.ok) expect(sniffImage(r.bytes)).toMatchObject({ format: 'svg', width: 10, height: 20 });
  });
});

describe('sniffImage reads real headers', () => {
  it('PNG', () => expect(sniffImage(read('svg-poster/assets/logo.png'))).toMatchObject({ format: 'png', width: 128, height: 128 }));
  it('JPEG', () => expect(sniffImage(read('svg-poster/assets/photo.jpg'))).toMatchObject({ format: 'jpeg', width: 640, height: 400 }));
  it('WebP', () => expect(sniffImage(read('android-app/app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp'))).toMatchObject({ format: 'webp', width: 192, height: 192 }));
  it('rejects a text file named .png', () => expect(sniffImage(read('catalog/images/notreally.png'))).toBeNull());
  it('GIF and BMP synthetic headers', () => {
    expect(sniffImage(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x10, 0x00, 0x20, 0x00]))).toMatchObject({ format: 'gif', width: 16, height: 32 });
    const bmp = new Uint8Array(30);
    bmp.set([0x42, 0x4d]);
    bmp.set([7, 0, 0, 0], 18);
    bmp.set([0xfb, 0xff, 0xff, 0xff], 22);
    expect(sniffImage(bmp)).toMatchObject({ format: 'bmp', width: 7, height: 5 });
  });
  it('flags TIFF as limited browser support', () => {
    expect(sniffImage(new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]))?.browserSupport).toBe('limited');
  });
  it('SVG with viewBox only', () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?><!-- c --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"/>');
    expect(sniffSignature(svg)).toBe('svg');
    expect(sniffImage(svg)).toMatchObject({ width: 300, height: 150 });
  });
});
