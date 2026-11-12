import { analyze, type AnalysisInput } from '../core/pipeline/analyze';

type Req = { id: number; input: AnalysisInput };

self.onmessage = async (e: MessageEvent<Req>) => {
  const { id, input } = e.data;
  try {
    const result = await analyze(input, (stage, done, total) => (self as unknown as Worker).postMessage({ id, type: 'progress', stage, done, total }));
    const transfer = result.assets.map((a) => a.bytes).filter((b): b is ArrayBuffer => !!b);
    (self as unknown as Worker).postMessage({ id, type: 'result', result }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, type: 'error', message: (err as Error).message ?? String(err) });
  }
};
