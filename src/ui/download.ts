/**
 * Saves a generated file. Inside a claude.ai artifact the page cannot start downloads itself, so it asks the
 * host's `downloads` capability (the viewer confirms). Elsewhere (npm run dev / any normal host) it uses a plain link.
 */
type SaveResult = { ok: true } | { ok: false; message: string };
interface DownloadsNs { save(req: { filename: string; data: Blob }): Promise<unknown> }
interface ClaudeHost { use(name: string): Promise<unknown> }

let nsPromise: Promise<DownloadsNs | null> | null = null;
function hostDownloads(): Promise<DownloadsNs | null> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (!host || typeof host.use !== 'function') return Promise.resolve(null);
  nsPromise ??= host.use('downloads').then((d) => (d as DownloadsNs | null) ?? null, () => null);
  return nsPromise;
}

export async function saveFile(filename: string, data: BlobPart, type: string): Promise<SaveResult> {
  const blob = new Blob([data], { type });
  const ns = await hostDownloads();
  if (ns) {
    try {
      await ns.save({ filename, data: blob });
      return { ok: true };
    } catch (e) {
      const code = (e as { code?: string }).code;
      const ext = filename.split('.').pop();
      if (code === 'declined') return { ok: false, message: 'Download cancelled.' };
      if (code === 'rejected_extension' || code === 'extension_not_enabled') return { ok: false, message: `This viewer cannot save .${ext} files. Download the package (.zip) instead; it contains this file.` };
      if (code === 'rate_limited') return { ok: false, message: 'A download prompt is already open. Try again in a moment.' };
      return { ok: false, message: `The download could not be started here (${code ?? 'unavailable'}). Run XML Canvas locally to save files.` };
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { ok: true };
}
