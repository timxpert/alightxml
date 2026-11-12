import type { AnalysisInput, AnalysisResult, ProgressFn } from '../core/pipeline/analyze';

let worker: Worker | null = null;
let workerBroken = false;
let seq = 0;

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('error', () => {
      workerBroken = true;
      worker = null;
    });
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

/** Runs the analysis in a Web Worker; falls back to the main thread if workers are unavailable. */
export async function runAnalysis(input: AnalysisInput, onProgress: ProgressFn): Promise<{ result: AnalysisResult; inWorker: boolean }> {
  const w = getWorker();
  if (w) {
    try {
      const result = await new Promise<AnalysisResult>((resolve, reject) => {
        const id = ++seq;
        const onMessage = (e: MessageEvent) => {
          if (e.data?.id !== id) return;
          if (e.data.type === 'progress') onProgress(e.data.stage, e.data.done, e.data.total);
          else {
            w.removeEventListener('message', onMessage);
            w.removeEventListener('error', onError);
            if (e.data.type === 'result') resolve(e.data.result);
            else reject(new Error(e.data.message));
          }
        };
        const onError = (ev: ErrorEvent) => {
          w.removeEventListener('message', onMessage);
          reject(Object.assign(new Error(ev.message || 'Worker failed to start'), { workerFailure: true }));
        };
        w.addEventListener('message', onMessage);
        w.addEventListener('error', onError);
        w.postMessage({ id, input });
      });
      return { result, inWorker: true };
    } catch (e) {
      if (!(e as { workerFailure?: boolean }).workerFailure) throw e;
      workerBroken = true;
    }
  }
  const { analyze } = await import('../core/pipeline/analyze');
  return { result: await analyze(input, onProgress), inWorker: false };
}
