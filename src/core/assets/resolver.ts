/**
 * Turns asset references into resolved assets. Every failure carries a specific, human-readable reason;
 * nothing is ever replaced with a placeholder.
 */
import { decodeBase64, decodeDataUri } from './base64';
import { sha256Hex } from './hash';
import { describeNonImage, EXT_FOR_FORMAT, sniffImage } from './sniff';
import type { AssetReference, AssetUsage, ResolvedAsset } from './types';
import { basename, dirname, joinPath, type ProjectFile, type ProjectFS, readFileBytes } from '../project/vfs';

export interface ResolveContext {
  fs: ProjectFS;
  /** Project path of the XML being analysed; null when the XML was pasted. */
  xmlPath: string | null;
}

type Partial = Omit<ResolvedAsset, 'id' | 'key' | 'usages' | 'adapter' | 'confidence' | 'evidence' | 'rawReference' | 'name' | 'kind'> & { name?: string };

const normMime = (m: string) => m.toLowerCase().replace('image/jpg', 'image/jpeg').replace('image/x-png', 'image/png').replace('image/svg', 'image/svg+xml').replace('image/svg+xml+xml', 'image/svg+xml');

async function fromBytes(bytes: Uint8Array, base: { method: string; location: string; declaredMime?: string; filePath?: string; warnings?: string[] }): Promise<Partial> {
  const warnings = [...(base.warnings ?? [])];
  const info = sniffImage(bytes);
  if (!info) {
    return {
      status: 'invalid',
      reason: `The data was found (${formatBytes(bytes.length)}), but it is not a recognised image: ${describeNonImage(bytes)}.`,
      method: base.method,
      location: base.location,
      filePath: base.filePath,
      byteLength: bytes.length,
      warnings,
    };
  }
  if (base.declaredMime && base.declaredMime !== 'application/octet-stream' && normMime(base.declaredMime) !== info.mime) {
    warnings.push(`The XML declares the type "${base.declaredMime}", but the bytes are actually ${info.format.toUpperCase()}. The actual format is used.`);
  }
  if (info.note) warnings.push(info.note);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return {
    status: info.browserSupport === 'limited' ? 'unsupported' : 'resolved',
    reason: info.browserSupport === 'limited' ? info.note : undefined,
    method: base.method,
    location: base.location,
    filePath: base.filePath,
    format: info.format,
    mime: info.mime,
    width: info.width,
    height: info.height,
    byteLength: bytes.length,
    sha256: await sha256Hex(bytes),
    bytes: copy.buffer,
    warnings,
  };
}

async function fromFile(file: ProjectFile, method: string, warnings: string[] = []): Promise<Partial> {
  const bytes = await readFileBytes(file);
  return fromBytes(bytes, { method, location: file.path, filePath: file.path, warnings });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

const IMPORT_FOLDER_HINT = 'Import the folder that contains the XML and its images (or a ZIP of it) so XML Canvas can read them.';

async function resolvePath(ref: AssetReference, ctx: ResolveContext): Promise<Partial> {
  let raw = ref.value.trim();
  let absolute = false;
  if (/^file:/i.test(raw)) {
    raw = raw.replace(/^file:(\/\/(localhost)?)?/i, '');
    if (/^\/[a-zA-Z]:\//.test(raw)) raw = raw.slice(1);
    absolute = true;
  } else if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/')) {
    absolute = true;
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    const scheme = raw.slice(0, raw.indexOf(':')).toLowerCase();
    const why: Record<string, string> = {
      content: 'content:// URIs point into the private storage of an Android app on the device that created the file; they cannot be opened from a browser.',
      blob: 'blob: URLs only exist inside the browser tab that created them.',
      javascript: 'javascript: URLs are never executed.',
      ftp: 'Browsers no longer support FTP.',
    };
    return { status: 'unsupported', reason: why[scheme] ?? `The "${scheme}:" scheme cannot be loaded by a browser application.`, location: ref.value, warnings: [] };
  }
  let path = raw.replace(/[?#].*$/, '');
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep as written */
  }

  if (!ctx.fs.hasCompanionFiles) {
    return {
      status: 'missing',
      location: ref.value,
      warnings: [],
      reason: absolute
        ? `"${ref.value}" is an absolute path on the computer that created this XML. Browsers cannot read arbitrary locations on your disk. ${IMPORT_FOLDER_HINT}`
        : `This relative path is resolved against the XML file's folder, but the XML was ${ctx.xmlPath ? 'imported on its own' : 'pasted as text'}, so that folder isn't available. ${IMPORT_FOLDER_HINT}`,
    };
  }

  if (!absolute) {
    const target = joinPath(dirname(ctx.xmlPath ?? ''), path);
    if (target === null) {
      return { status: 'missing', location: ref.value, warnings: [], reason: `"${ref.value}" points above the top of the imported folder. Import a higher-level folder that also contains the image.` };
    }
    const exact = ctx.fs.get(target);
    if (exact) return fromFile(exact, "Relative path resolved against the XML file's folder");
    const ci = ctx.fs.getCaseInsensitive(target);
    if (ci.length === 1) {
      return fromFile(ci[0], "Relative path resolved against the XML file's folder (letter case differs)", [
        `The reference says "${target}" but the file is "${ci[0].path}". It works here, but will fail on case-sensitive systems such as Android and Linux.`,
      ]);
    }
    const sameName = ctx.fs.findBySuffix([basename(path)]).files.map((f) => f.path).slice(0, 3);
    return {
      status: 'missing',
      location: target,
      warnings: [],
      reason: `Expected the file at "${target}", but it is not in the imported files.` +
        (sameName.length ? ` A file with the same name exists at ${sameName.map((p) => `"${p}"`).join(', ')}; the XML may point at the wrong folder. It was not substituted automatically.` : ''),
    };
  }

  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const { files, matchedSegments } = ctx.fs.findBySuffix(segments);
  if (files.length === 1) {
    const tail = segments.slice(segments.length - matchedSegments).join('/');
    return fromFile(files[0], `Matched by trailing path "${tail}"`, [
      `The XML uses an absolute path ("${ref.value}") that a browser cannot open. The imported file "${files[0].path}" was used because its path ends with "${tail}". Check that it is the intended image.`,
    ]);
  }
  if (files.length > 1) {
    return { status: 'missing', location: ref.value, warnings: [], reason: `Absolute path "${ref.value}" cannot be opened directly, and ${files.length} imported files match its file name (${files.slice(0, 4).map((f) => f.path).join(', ')}). It is ambiguous, so none was chosen.` };
  }
  return { status: 'missing', location: ref.value, warnings: [], reason: `"${ref.value}" is an absolute path on the computer that created this XML, and no imported file matches its name. ${IMPORT_FOLDER_HINT}` };
}

const DENSITY_RANK: Record<string, number> = { xxxhdpi: 7, xxhdpi: 6, xhdpi: 5, hdpi: 4, tvdpi: 3.5, mdpi: 3, '': 2.5, nodpi: 2, ldpi: 1, anydpi: 0.5 };
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function resolveAndroid(ref: AssetReference, ctx: ResolveContext): Promise<Partial> {
  const m = /^@\+?(android:)?(drawable|mipmap)\/([\w.]+)$/.exec(ref.value.trim());
  if (!m) return { status: 'unsupported', location: ref.value, warnings: [], reason: `"${ref.value}" is not a drawable or mipmap resource reference.` };
  if (m[1]) return { status: 'unsupported', location: ref.value, warnings: [], reason: 'This is a built-in Android framework resource. It ships with the Android OS, not with your project, so it cannot be shown here.' };
  const [, , type, name] = m;
  if (!ctx.fs.hasCompanionFiles) {
    return { status: 'missing', location: ref.value, warnings: [], reason: `Android looks up @${type}/${name} in the app's res/${type}*/ folders. Import the project folder or a ZIP that includes the res/ directory.` };
  }
  const xml = ctx.xmlPath ?? '';
  const resIdx = xml.startsWith('res/') ? 0 : xml.indexOf('/res/');
  const resRoot = resIdx === -1 ? null : xml.slice(0, resIdx === 0 ? 3 : resIdx + 4);
  const prefix = resRoot ? `^${escapeRe(resRoot)}/` : '(?:^|/)res/';
  const re = new RegExp(`${prefix}(drawable|mipmap)(-[^/]+)?/${escapeRe(name)}(\\.9)?\\.(png|jpe?g|webp|gif|bmp|xml)$`, 'i');
  const hits = ctx.fs.paths().filter((p) => re.test(p));
  if (!hits.length) {
    return { status: 'missing', location: ref.value, warnings: [], reason: `No file named "${name}.*" was found in any ${resRoot ? `${resRoot}/` : 'res/'}${type}*/ folder of the imported files.` };
  }
  const rank = (p: string) => {
    const mm = re.exec(p)!;
    const qualifiers = (mm[2] ?? '').slice(1).split('-');
    const density = qualifiers.find((q) => q in DENSITY_RANK) ?? '';
    const isXml = mm[4].toLowerCase() === 'xml';
    return (isXml ? 0 : 100) + DENSITY_RANK[density] + (mm[1] === type ? 0.1 : 0);
  };
  hits.sort((a, b) => rank(b) - rank(a));
  const best = hits[0];
  const warnings = hits.length > 1 ? [`Other variants: ${hits.slice(1).join(', ')}. The highest-density bitmap is shown.`] : [];
  if (!resRoot) warnings.push('The XML is not inside a res/ folder, so res/ folders anywhere in the import were searched.');
  if (best.toLowerCase().endsWith('.xml')) {
    return {
      status: 'unsupported',
      location: best,
      filePath: best,
      warnings,
      reason: `Resolved to "${best}", an XML drawable (vector, shape or selector definition), not a bitmap. Open that file in XML Canvas to inspect it; converting vector drawables is not supported yet.`,
    };
  }
  return fromFile(ctx.fs.get(best)!, `Android resource @${type}/${name}`, warnings);
}

async function resolveOne(ref: AssetReference, ctx: ResolveContext): Promise<Partial> {
  switch (ref.kind) {
    case 'unresolvable':
      return { status: ref.failure!.status, reason: ref.failure!.reason, location: ref.value, warnings: [] };
    case 'data-uri': {
      const r = decodeDataUri(ref.value);
      if (!r.ok) return { status: 'invalid', reason: r.error, location: 'Embedded data URI', warnings: [] };
      return fromBytes(r.bytes, { method: 'Decoded embedded data URI', location: 'Embedded data URI', declaredMime: r.mime });
    }
    case 'base64': {
      const r = decodeBase64(ref.value);
      if (!r.ok) return { status: 'invalid', reason: r.error, location: 'Embedded Base64', warnings: [] };
      return fromBytes(r.bytes, { method: 'Decoded embedded Base64', location: 'Embedded Base64', declaredMime: ref.declaredMime });
    }
    case 'url': {
      const url = ref.value.trim().startsWith('//') ? `https:${ref.value.trim()}` : ref.value.trim();
      let host = url;
      try {
        host = new URL(url).host;
      } catch {
        return { status: 'invalid', reason: 'The URL is malformed.', location: ref.value, warnings: [] };
      }
      return {
        status: 'remote',
        url,
        location: url,
        warnings: [],
        reason: `Online image hosted on ${host}. It is not loaded until you allow remote images, because loading it contacts that server.`,
      };
    }
    case 'path':
      return resolvePath(ref, ctx);
    case 'project-path': {
      const f = ctx.fs.get(ref.value) ?? (ctx.fs.getCaseInsensitive(ref.value).length === 1 ? ctx.fs.getCaseInsensitive(ref.value)[0] : undefined);
      if (f) return fromFile(f, ref.resolveMethod ?? 'Resolved through the package relationship file', ref.resolveNote ? [ref.resolveNote] : []);
      return { status: 'missing', location: ref.value, warnings: [], reason: `The XML points to "${ref.value}", but that file is not in the imported files.` };
    }
    case 'android-resource':
      return resolveAndroid(ref, ctx);
  }
}

function assetName(ref: AssetReference, p: Partial, n: number): string {
  if (p.filePath) return basename(p.filePath);
  const ext = p.format ? EXT_FOR_FORMAT[p.format] : 'bin';
  if (ref.kind === 'data-uri') return ref.label && ref.label !== 'Embedded data URI' ? ref.label : `embedded-${n}.${ext}`;
  if (ref.kind === 'base64') return /\.\w{2,4}$/.test(ref.label) ? ref.label : `${ref.label || `embedded-${n}`}.${ext}`;
  if (ref.kind === 'url') return basename(p.url ?? ref.value) || ref.label;
  return ref.label || basename(ref.value) || `asset-${n}`;
}

export async function resolveReferences(refs: AssetReference[], ctx: ResolveContext, onProgress?: (done: number, total: number) => void): Promise<ResolvedAsset[]> {
  const groups = new Map<string, AssetReference[]>();
  for (const r of refs) {
    const g = groups.get(r.key);
    if (g) g.push(r);
    else groups.set(r.key, [r]);
  }
  const out: ResolvedAsset[] = [];
  let n = 0;
  for (const [key, group] of groups) {
    n++;
    const primary = group.find((r) => r.kind !== 'unresolvable') ?? group[0];
    let partial: Partial;
    try {
      partial = await resolveOne(primary, ctx);
    } catch (e) {
      partial = { status: 'invalid', reason: `Unexpected error while reading this asset: ${(e as Error).message}`, location: primary.value, warnings: [] };
    }
    const seen = new Set<string>();
    const usages: AssetUsage[] = [];
    for (const r of group) {
      const k = `${r.usage.line}:${r.usage.col}:${r.usage.attribute ?? ''}`;
      if (!seen.has(k)) { seen.add(k); usages.push(r.usage); }
    }
    out.push({
      ...partial,
      id: `asset-${n}`,
      key,
      name: partial.name ?? assetName(primary, partial, n),
      kind: primary.kind,
      usages,
      adapter: primary.adapter,
      confidence: primary.confidence,
      evidence: primary.evidence,
      rawReference: primary.kind === 'data-uri' || primary.kind === 'base64' ? `${primary.value.slice(0, 80)}${primary.value.length > 80 ? '…' : ''}` : primary.value,
    });
    onProgress?.(n, groups.size);
  }
  return out;
}
