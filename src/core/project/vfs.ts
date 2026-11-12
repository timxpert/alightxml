/**
 * Virtual project file system. Files come from a single upload, a folder, a ZIP archive or pasted text.
 * Paths are '/'-separated, relative to the project root, with no leading slash.
 */
export type ProjectSourceKind = 'paste' | 'single-file' | 'files' | 'folder' | 'zip';

export interface ProjectFile {
  path: string;
  size: number;
  /** Blob in the browser; Uint8Array in tests / when already in memory. */
  data: Blob | Uint8Array;
}

export interface ProjectManifest {
  name: string;
  kind: ProjectSourceKind;
  files: ProjectFile[];
  /** Notes produced during import (skipped entries, limits hit, …). */
  notes: string[];
}

export async function readFileBytes(file: ProjectFile): Promise<Uint8Array> {
  if (file.data instanceof Uint8Array) return file.data;
  return new Uint8Array(await file.data.arrayBuffer());
}

export function normalizePath(p: string): string | null {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null; // escapes the project root
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

export function dirname(p: string): string {
  const k = p.lastIndexOf('/');
  return k === -1 ? '' : p.slice(0, k);
}

export function basename(p: string): string {
  const clean = p.replace(/[?#].*$/, '').replace(/\\/g, '/');
  return clean.slice(clean.lastIndexOf('/') + 1);
}

export function extname(p: string): string {
  const b = basename(p);
  const k = b.lastIndexOf('.');
  return k <= 0 ? '' : b.slice(k + 1).toLowerCase();
}

export function joinPath(dir: string, rel: string): string | null {
  return normalizePath(dir ? `${dir}/${rel}` : rel);
}

export class ProjectFS {
  readonly kind: ProjectSourceKind;
  private readonly byPath = new Map<string, ProjectFile>();
  private readonly byLower = new Map<string, ProjectFile[]>();

  constructor(kind: ProjectSourceKind, files: ProjectFile[]) {
    this.kind = kind;
    for (const f of files) {
      this.byPath.set(f.path, f);
      const low = f.path.toLowerCase();
      const list = this.byLower.get(low) ?? [];
      list.push(f);
      this.byLower.set(low, list);
    }
  }

  /** True when the XML arrived with its surrounding files (folder, ZIP or several files). */
  get hasCompanionFiles(): boolean {
    return this.byPath.size > 1;
  }

  get size(): number {
    return this.byPath.size;
  }

  paths(): string[] {
    return [...this.byPath.keys()];
  }

  get(path: string): ProjectFile | undefined {
    return this.byPath.get(path);
  }

  getCaseInsensitive(path: string): ProjectFile[] {
    return this.byLower.get(path.toLowerCase()) ?? [];
  }

  /** Files whose path ends with the given trailing segments (longest match wins). */
  findBySuffix(segments: string[]): { files: ProjectFile[]; matchedSegments: number } {
    for (let take = segments.length; take >= 1; take--) {
      const suffix = segments.slice(segments.length - take).join('/').toLowerCase();
      const hits = [...this.byPath.values()].filter((f) => {
        const low = f.path.toLowerCase();
        return low === suffix || low.endsWith('/' + suffix);
      });
      if (hits.length) return { files: hits, matchedSegments: take };
    }
    return { files: [], matchedSegments: 0 };
  }

  async read(path: string): Promise<Uint8Array | undefined> {
    const f = this.byPath.get(path);
    return f ? readFileBytes(f) : undefined;
  }

  async readText(path: string): Promise<string | undefined> {
    const b = await this.read(path);
    return b ? new TextDecoder('utf-8').decode(b) : undefined;
  }
}

const XML_EXTS = new Set(['xml', 'svg', 'fb2', 'xhtml', 'rels', 'vml', 'kml', 'gpx', 'xaml', 'plist', 'drawio']);

export function isLikelyXmlPath(p: string): boolean {
  return XML_EXTS.has(extname(p));
}

/** XML files worth analysing, best candidates first. */
export function rankXmlCandidates(paths: string[]): string[] {
  const score = (p: string) => {
    const ext = extname(p);
    const b = basename(p).toLowerCase();
    if (ext === 'rels' || b === '[content_types].xml') return -1;
    if (!XML_EXTS.has(ext)) return -1;
    let s = 10;
    if (ext === 'svg' || ext === 'fb2') s += 5;
    if (/^(word\/document\.xml|ppt\/slides\/slide1\.xml|xl\/drawings\/drawing1\.xml)$/.test(p)) s += 20;
    if (/^(docProps|customXml)\//.test(p) || /\/(theme|fontTable|settings|styles|webSettings|app|core)\d*\.xml$/.test(p)) s -= 8;
    if (/(^|\/)res\/layout[^/]*\//.test(p)) s += 4;
    s -= p.split('/').length * 0.1;
    return s;
  };
  return paths
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.p.localeCompare(b.p))
    .map((x) => x.p);
}
