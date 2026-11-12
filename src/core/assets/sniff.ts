/**
 * Identifies image formats from their bytes (magic numbers), never from file names, and reads intrinsic
 * dimensions from file headers without decoding pixels.
 */
import { parseXml } from '../xml/parser';

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'ico' | 'svg' | 'avif' | 'heic' | 'tiff';

export interface ImageInfo {
  format: ImageFormat;
  mime: string;
  width?: number;
  height?: number;
  /** Browsers that cannot display this format natively. */
  browserSupport: 'all' | 'limited' | 'none';
  note?: string;
}

const MIME: Record<ImageFormat, string> = {
  png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  ico: 'image/x-icon', svg: 'image/svg+xml', avif: 'image/avif', heic: 'image/heic', tiff: 'image/tiff',
};

export const EXT_FOR_FORMAT: Record<ImageFormat, string> = {
  png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', bmp: 'bmp', ico: 'ico', svg: 'svg', avif: 'avif', heic: 'heic', tiff: 'tif',
};

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const i32le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);
const ascii = (b: Uint8Array, o: number, len: number) => String.fromCharCode(...b.subarray(o, o + len));

/** Signature-only check (works on a prefix of the data). */
export function sniffSignature(b: Uint8Array): ImageFormat | null {
  if (b.length < 4) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (b[0] === 0x42 && b[1] === 0x4d && b.length >= 26) return 'bmp';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0 && b.length >= 6) return 'ico';
  if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return 'tiff';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return 'heic';
  }
  if (isSvgText(b)) return 'svg';
  return null;
}

function isSvgText(b: Uint8Array): boolean {
  const head = new TextDecoder('utf-8').decode(b.subarray(0, 4096)).replace(/^﻿/, '');
  const stripped = head.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/i, '').trimStart();
  return /^<(\w+:)?svg[\s>/]/.test(stripped);
}

/** Describes what non-image bytes look like, to explain failures. */
export function describeNonImage(b: Uint8Array): string {
  if (b.length === 0) return 'the file is empty';
  if (ascii(b, 0, 4) === '%PDF') return 'it is a PDF document';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'it is a ZIP archive';
  const head = new TextDecoder('utf-8').decode(b.subarray(0, 256)).trim();
  if (/^<!doctype html|^<html/i.test(head)) return 'it is an HTML page (often a login or "not found" page saved instead of the image)';
  if (head.startsWith('<')) return 'it is XML/markup text, not an image';
  if (/^[\x09\x0a\x0d\x20-\x7e]+$/.test(head)) return 'it is plain text';
  return 'its bytes do not match any known image format';
}

export function sniffImage(b: Uint8Array): ImageInfo | null {
  const format = sniffSignature(b);
  if (!format) return null;
  const info: ImageInfo = { format, mime: MIME[format], browserSupport: 'all' };
  try {
    switch (format) {
      case 'png':
        if (b.length >= 24 && ascii(b, 12, 4) === 'IHDR') { info.width = u32be(b, 16); info.height = u32be(b, 20); }
        break;
      case 'gif':
        if (b.length >= 10) { info.width = u16le(b, 6); info.height = u16le(b, 8); }
        break;
      case 'bmp':
        info.width = Math.abs(i32le(b, 18));
        info.height = Math.abs(i32le(b, 22));
        break;
      case 'ico':
        if (b.length >= 8) { info.width = b[6] || 256; info.height = b[7] || 256; }
        break;
      case 'webp': {
        const chunk = ascii(b, 12, 4);
        if (chunk === 'VP8 ' && b.length >= 30) { info.width = u16le(b, 26) & 0x3fff; info.height = u16le(b, 28) & 0x3fff; }
        else if (chunk === 'VP8L' && b.length >= 25) {
          const b0 = b[21], b1 = b[22], b2 = b[23], b3 = b[24];
          info.width = 1 + (((b1 & 0x3f) << 8) | b0);
          info.height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        } else if (chunk === 'VP8X' && b.length >= 30) {
          info.width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
          info.height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
        }
        break;
      }
      case 'jpeg': {
        let o = 2;
        while (o + 9 < b.length) {
          if (b[o] !== 0xff) { o++; continue; }
          const marker = b[o + 1];
          if (marker === 0xff) { o++; continue; }
          if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
          const len = u16be(b, o + 2);
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            info.height = u16be(b, o + 5);
            info.width = u16be(b, o + 7);
            break;
          }
          if (marker === 0xda) break;
          o += 2 + len;
        }
        break;
      }
      case 'svg': {
        const dims = svgDimensions(new TextDecoder('utf-8').decode(b));
        if (dims) { info.width = dims.width; info.height = dims.height; }
        if (dims?.fromViewBox) info.note = 'Dimensions taken from the SVG viewBox (no absolute width/height).';
        break;
      }
      case 'tiff':
        info.browserSupport = 'limited';
        info.note = 'TIFF is only displayed by Safari. Convert it to PNG or JPEG for other browsers.';
        break;
      case 'heic':
        info.browserSupport = 'limited';
        info.note = 'HEIC/HEIF is only displayed by Safari. Convert it to JPEG or PNG for other browsers.';
        break;
      case 'avif':
        info.note = 'AVIF needs a recent browser.';
        break;
    }
  } catch {
    /* header truncated: keep format, unknown size */
  }
  if (info.width === 0 || info.height === 0) { info.width = undefined; info.height = undefined; }
  return info;
}

function svgLength(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^\s*([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*(px|pt|mm|cm|in)?\s*$/i.exec(v);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const unit = (m[2] ?? 'px').toLowerCase();
  const f: Record<string, number> = { px: 1, pt: 4 / 3, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
  return n * f[unit];
}

export function svgDimensions(text: string): { width: number; height: number; fromViewBox: boolean } | null {
  try {
    const doc = parseXml(text);
    const root = doc.root;
    const get = (n: string) => root.attrs.find((a) => a.local === n && a.ns === '')?.value;
    const vb = get('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const w = svgLength(get('width'));
    const h = svgLength(get('height'));
    if (w && h) return { width: Math.round(w), height: Math.round(h), fromViewBox: false };
    if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      if (w) return { width: Math.round(w), height: Math.round((w * vb[3]) / vb[2]), fromViewBox: true };
      if (h) return { width: Math.round((h * vb[2]) / vb[3]), height: Math.round(h), fromViewBox: true };
      return { width: Math.round(vb[2]), height: Math.round(vb[3]), fromViewBox: true };
    }
  } catch {
    return null;
  }
  return null;
}
