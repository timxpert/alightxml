import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import type { ProjectFile, ProjectSourceKind } from '../src/core/project/vfs';
import { analyze } from '../src/core/pipeline/analyze';

export const SAMPLES = fileURLToPath(new URL('../samples', import.meta.url));

export function loadFolder(dir: string): ProjectFile[] {
  const out: ProjectFile[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const data = new Uint8Array(readFileSync(full));
        out.push({ path: relative(dir, full).split('\\').join('/'), size: data.length, data });
      }
    }
  };
  walk(dir);
  return out;
}

export async function loadZip(path: string): Promise<ProjectFile[]> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const files: ProjectFile[] = [];
  for (const f of Object.values(zip.files)) {
    if (f.dir) continue;
    const data = await f.async('uint8array');
    files.push({ path: f.name, size: data.length, data });
  }
  return files;
}

export async function analyzeFolder(dir: string, xmlPath: string, kind: ProjectSourceKind = 'folder') {
  return analyze({ kind, files: loadFolder(join(SAMPLES, dir)), xmlPath });
}

export async function analyzeSingle(relPath: string) {
  const data = new Uint8Array(readFileSync(join(SAMPLES, relPath)));
  const name = relPath.split('/').pop()!;
  return analyze({ kind: 'single-file', files: [{ path: name, size: data.length, data }], xmlPath: name });
}

export const byName = <T extends { name: string }>(list: T[], name: string) => {
  const hit = list.find((a) => a.name === name);
  if (!hit) throw new Error(`No asset named ${name}. Have: ${list.map((a) => a.name).join(', ')}`);
  return hit;
};
