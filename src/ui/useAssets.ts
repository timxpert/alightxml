import { useCallback, useEffect, useRef, useState } from 'react';
import type { ResolvedAsset } from '../core/assets/types';
import { sha256Hex } from '../core/assets/hash';
import { sniffImage } from '../core/assets/sniff';

export interface AssetVM extends ResolvedAsset {
  objectUrl?: string;
  thumbUrl?: string;
  /** Browser decode check: 'pending' until verified. */
  display: 'none' | 'pending' | 'ok';
  remoteState?: 'idle' | 'loading' | 'done';
}

const THUMB = 320;

async function makeThumb(blob: Blob, w?: number, h?: number): Promise<string | undefined> {
  if (!w || !h || (Math.max(w, h) <= THUMB * 2 && blob.size < 400_000)) return undefined;
  try {
    const scale = THUMB / Math.max(w, h);
    const bmp = await createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(w * scale)), resizeHeight: Math.max(1, Math.round(h * scale)), resizeQuality: 'high' });
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const out = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
    return out ? URL.createObjectURL(out) : undefined;
  } catch {
    return undefined;
  }
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('decode'));
    img.src = src;
  });
}

/** Holds the main-thread view of assets: blob URLs, decode verification, thumbnails and opt-in remote loading. */
export function useAssets(source: ResolvedAsset[] | undefined) {
  const [assets, setAssets] = useState<AssetVM[]>([]);
  const urls = useRef<string[]>([]);

  const revokeAll = () => {
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current = [];
  };

  useEffect(() => {
    revokeAll();
    if (!source) { setAssets([]); return; }
    let cancelled = false;
    const initial: AssetVM[] = source.map((a) => {
      if (a.bytes && a.status === 'resolved' && a.mime) {
        const url = URL.createObjectURL(new Blob([a.bytes], { type: a.mime }));
        urls.current.push(url);
        return { ...a, objectUrl: url, display: 'pending' };
      }
      return { ...a, display: 'none', remoteState: a.status === 'remote' ? 'idle' : undefined };
    });
    setAssets(initial);
    (async () => {
      for (const a of initial) {
        if (!a.objectUrl || cancelled) continue;
        let patch: Partial<AssetVM>;
        try {
          const img = await loadImg(a.objectUrl);
          const width = a.width ?? (img.naturalWidth || undefined);
          const height = a.height ?? (img.naturalHeight || undefined);
          const thumbUrl = await makeThumb(new Blob([a.bytes!], { type: a.mime }), width, height);
          if (thumbUrl) urls.current.push(thumbUrl);
          patch = { display: 'ok', width, height, thumbUrl };
        } catch {
          patch = { display: 'none', status: 'invalid', reason: `The file has a valid ${a.format?.toUpperCase()} header, but this browser could not decode it (it may be truncated or corrupt).` };
        }
        if (cancelled) return;
        setAssets((list) => list.map((x) => (x.id === a.id ? { ...x, ...patch } : x)));
      }
    })();
    return () => { cancelled = true; };
  }, [source]);

  useEffect(() => () => revokeAll(), []);

  /** Loads remote images only after explicit user consent. */
  const loadRemote = useCallback(async () => {
    const targets = assets.filter((a) => a.status === 'remote' && a.remoteState === 'idle' && a.url);
    setAssets((list) => list.map((x) => (targets.some((t) => t.id === x.id) ? { ...x, remoteState: 'loading' } : x)));
    for (const a of targets) {
      let patch: Partial<AssetVM>;
      const host = (() => { try { return new URL(a.url!).host; } catch { return a.url!; } })();
      try {
        const res = await fetch(a.url!, { mode: 'cors', referrerPolicy: 'no-referrer', credentials: 'omit' });
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { http: res.status });
        const bytes = new Uint8Array(await res.arrayBuffer());
        const info = sniffImage(bytes);
        if (!info) {
          patch = { status: 'invalid', remoteState: 'done', reason: `${host} answered, but the response is not an image.`, byteLength: bytes.length };
        } else {
          const url = URL.createObjectURL(new Blob([bytes], { type: info.mime }));
          urls.current.push(url);
          patch = { status: 'resolved', remoteState: 'done', display: 'ok', objectUrl: url, bytes: bytes.buffer, format: info.format, mime: info.mime, width: info.width, height: info.height, byteLength: bytes.length, sha256: await sha256Hex(bytes), method: `Downloaded from ${host}`, reason: undefined };
        }
      } catch (e) {
        const http = (e as { http?: number }).http;
        try {
          const img = await loadImg(a.url!);
          patch = {
            status: 'resolved', remoteState: 'done', display: 'ok', objectUrl: a.url, width: img.naturalWidth, height: img.naturalHeight, method: `Displayed from ${host}`, reason: undefined,
            warnings: [...a.warnings, `${host} lets the image be displayed but not downloaded by other sites (CORS), so it cannot be packaged for export. Download it yourself and import the folder.`],
          };
        } catch {
          patch = { status: 'missing', remoteState: 'done', reason: http ? `${host} responded with HTTP ${http}.` : `The image could not be loaded from ${host}: the server refused, the address does not exist, or you are offline. Browsers do not reveal which.` };
        }
      }
      setAssets((list) => list.map((x) => (x.id === a.id ? { ...x, ...patch } : x)));
    }
  }, [assets]);

  return { assets, loadRemote };
}
