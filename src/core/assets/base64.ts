const LOOKUP = (() => {
  const t = new Int16Array(128).fill(-1);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let k = 0; k < chars.length; k++) t[chars.charCodeAt(k)] = k;
  t['-'.charCodeAt(0)] = 62; // base64url
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

export type Base64Result = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/** Strict Base64 decoder (standard or URL-safe alphabet; whitespace ignored; padding optional). */
export function decodeBase64(input: string): Base64Result {
  let clean = '';
  for (let k = 0; k < input.length; k++) {
    const c = input.charCodeAt(k);
    if (c === 32 || c === 9 || c === 10 || c === 13) continue;
    clean += input[k];
  }
  const firstPad = clean.indexOf('=');
  let body = clean;
  if (firstPad !== -1) {
    const pad = clean.slice(firstPad);
    if (!/^={1,2}$/.test(pad)) return { ok: false, error: `Base64 data has misplaced "=" padding at character ${firstPad + 1}.` };
    body = clean.slice(0, firstPad);
  }
  if (body.length === 0) return { ok: false, error: 'Base64 data is empty.' };
  if (body.length % 4 === 1) return { ok: false, error: 'Base64 data has an impossible length (it is probably truncated).' };
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let k = 0; k < body.length; k++) {
    const c = body.charCodeAt(k);
    const v = c < 128 ? LOOKUP[c] : -1;
    if (v < 0) return { ok: false, error: `Base64 data contains an invalid character "${body[k]}" at position ${k + 1}.` };
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return { ok: true, bytes: out.subarray(0, o) };
}

export function looksLikeBase64(s: string, minLength = 64): boolean {
  if (s.length < minLength) return false;
  return /^[A-Za-z0-9+/\-_\s]+={0,2}\s*$/.test(s);
}

export interface DataUri {
  mime: string;
  isBase64: boolean;
  data: string;
}

export function parseDataUri(uri: string): DataUri | null {
  const m = /^data:([^,]*?),(.*)$/s.exec(uri.trim());
  if (!m) return null;
  const meta = m[1].split(';').map((s) => s.trim());
  const isBase64 = meta.some((s) => s.toLowerCase() === 'base64');
  const mime = (meta[0] && meta[0].includes('/') ? meta[0] : 'text/plain').toLowerCase();
  return { mime, isBase64, data: m[2] };
}

export function decodeDataUri(uri: string): ({ ok: true; bytes: Uint8Array; mime: string }) | ({ ok: false; error: string }) {
  const parsed = parseDataUri(uri);
  if (!parsed) return { ok: false, error: 'Malformed data URI (expected "data:<type>[;base64],<data>").' };
  if (parsed.isBase64) {
    const r = decodeBase64(parsed.data);
    return r.ok ? { ok: true, bytes: r.bytes, mime: parsed.mime } : r;
  }
  try {
    return { ok: true, bytes: new TextEncoder().encode(decodeURIComponent(parsed.data)), mime: parsed.mime };
  } catch {
    return { ok: false, error: 'Data URI contains invalid percent-encoding.' };
  }
}

export function encodeBase64(bytes: Uint8Array): string {
  let s = '';
  for (let k = 0; k < bytes.length; k += 0x8000) s += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
  return btoa(s);
}
