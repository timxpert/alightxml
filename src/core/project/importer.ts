/** Browser-side import: files, folders (input or drag-and-drop), ZIP archives and pasted text. */
import JSZip from 'jszip';
import { extname, normalizePath, type ProjectFile, type ProjectManifest } from './vfs';

export const ZIP_EXTS = new Set(['zip', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'epub', 'amproj']);
const MAX_ENTRIES = 20_000;
const MAX_TOTAL = 1024 * 1024 * 1024;
const SKIP_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|\.git)(\/|$)/;

async function isZip(file: File): Promise<boolean> {
  if (ZIP_EXTS.has(extname(file.name))) return true;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

export async function importZip(file: File): Promise<ProjectManifest> {
  const notes: string[] = [];
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (e) {
    throw new Error(`"${file.name}" could not be opened as a ZIP archive: ${(e as Error).message}`);
  }
  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (entries.length > MAX_ENTRIES) throw new Error(`The archive has ${entries.length} files; the limit is ${MAX_ENTRIES}.`);
  const files: ProjectFile[] = [];
  let total = 0;
  let unsafe = 0;
  for (const entry of entries) {
    if (SKIP_RE.test(entry.name)) continue;
    const path = normalizePath(entry.name);
    if (!path || entry.name.startsWith('/') || /^[a-zA-Z]:/.test(entry.name)) {
      unsafe++;
      continue;
    }
    const bytes = await entry.async('uint8array');
    total += bytes.length;
    if (total > MAX_TOTAL) throw new Error('The archive expands to more than 1 GB, which is too large to open in the browser.');
    files.push({ path, size: bytes.length, data: new Blob([bytes as BlobPart]) });
  }
  if (unsafe) notes.push(`${unsafe} archive entr${unsafe === 1 ? 'y was' : 'ies were'} skipped because their paths point outside the archive (possible "zip slip").`);
  // Strip a single shared top-level folder so paths read naturally.
  const tops = new Set(files.map((f) => f.path.split('/')[0]));
  if (tops.size === 1 && files.every((f) => f.path.includes('/'))) {
    const top = [...tops][0] + '/';
    for (const f of files) f.path = f.path.slice(top.length);
  }
  return { name: file.name.replace(/\.[^.]+$/, ''), kind: 'zip', files, notes };
}

export async function importFileList(list: File[], fromFolderInput: boolean): Promise<ProjectManifest> {
  if (list.length === 0) throw new Error('No files were selected.');
  if (!fromFolderInput && list.length === 1) {
    const f = list[0];
    if (await isZip(f)) return importZip(f);
    return { name: f.name.replace(/\.[^.]+$/, ''), kind: 'single-file', files: [{ path: f.name, size: f.size, data: f }], notes: [] };
  }
  const files: ProjectFile[] = [];
  let root = '';
  for (const f of list) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const path = normalizePath(rel);
    if (!path || SKIP_RE.test(path)) continue;
    files.push({ path, size: f.size, data: f });
  }
  if (fromFolderInput && files.length) {
    root = files[0].path.split('/')[0];
    if (files.every((f) => f.path.startsWith(root + '/'))) for (const f of files) f.path = f.path.slice(root.length + 1);
  }
  return { name: root || `${files.length} files`, kind: fromFolderInput ? 'folder' : 'files', files, notes: [] };
}

interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (ok: (f: File) => void, err: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, err: (e: unknown) => void) => void };
}

/** Handles drag-and-drop of files and whole folders. */
export async function importDataTransfer(dt: DataTransfer): Promise<ProjectManifest> {
  const entries: FsEntry[] = [];
  for (const item of Array.from(dt.items)) {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (!entries.length) return importFileList(Array.from(dt.files), false);
  if (entries.length === 1 && entries[0].isFile) return importFileList(Array.from(dt.files).slice(0, 1), false);
  const files: ProjectFile[] = [];
  const walk = async (entry: FsEntry): Promise<void> => {
    if (files.length > MAX_ENTRIES) throw new Error(`The dropped folder has more than ${MAX_ENTRIES} files.`);
    if (entry.isFile && entry.file) {
      const file = await new Promise<File>((ok, err) => entry.file!(ok, err));
      const path = normalizePath(entry.fullPath);
      if (path && !SKIP_RE.test(path)) files.push({ path, size: file.size, data: file });
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise<FsEntry[]>((ok, err) => reader.readEntries(ok, err));
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  };
  for (const e of entries) await walk(e);
  const single = entries.length === 1 && entries[0].isDirectory ? entries[0].name : '';
  if (single) for (const f of files) f.path = f.path.slice(single.length + 1);
  return { name: single || `${files.length} files`, kind: single ? 'folder' : 'files', files, notes: [] };
}

export function importPasted(text: string, name = 'Pasted XML'): ProjectManifest {
  const bytes = new TextEncoder().encode(text);
  return { name, kind: 'paste', files: [{ path: 'pasted.xml', size: bytes.length, data: bytes }], notes: [] };
}
