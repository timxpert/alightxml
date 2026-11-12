import { useState } from 'react';
import { buildPackage, safeFileName } from '../../core/alight/package';
import { IMPORT_STEPS, UNTESTED_STATEMENT } from '../../core/alight/report';
import { RULES, TARGET } from '../../core/alight/rules';
import type { ValidationResult } from '../../core/alight/validate';
import type { AmConversion } from '../../core/alight/writer';
import { formatBytes } from '../../core/assets/resolver';
import { parseColor, toHexRGB } from '../../core/design/color';
import { Badge, Button, Empty, Icon, SectionTitle } from './ui';
import { saveFile } from '../download';

export interface AmUiOptions {
  title: string;
  fps: number;
  seconds: number;
  transparent: boolean;
  background: string;
  phoneFolder: string;
}

interface Props {
  available: boolean;
  unavailableReason?: string;
  conv?: AmConversion;
  validation?: ValidationResult;
  report?: { markdown: string; json: unknown };
  options: AmUiOptions;
  onOptions: (o: AmUiOptions) => void;
  original: { name: string; text: string };
  onSelectNode: (id: string) => void;
}

export function AlightView({ available, unavailableReason, conv, validation, report, options, onOptions, original, onSelectNode }: Props) {
  const [busy, setBusy] = useState(false);
  const [showXml, setShowXml] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const save = async (data: BlobPart, name: string, type: string) => { setSaveMsg(null); const r = await saveFile(name, data, type); if (!r.ok) setSaveMsg(r.message); };
  if (!available) {
    return (
      <Empty icon="motion" title="Alight Motion conversion needs a design file">
        {unavailableReason}
      </Empty>
    );
  }
  const errors = validation?.issues.filter((i) => i.level === 'error') ?? [];
  const warnings = validation?.issues.filter((i) => i.level === 'warning') ?? [];
  const blocked = !validation || !validation.ok;
  const base = safeFileName(options.title);
  const assumedUsed = conv ? conv.rulesUsed.map((r) => RULES[r]).filter((r) => r?.provenance === 'assumed' || r?.provenance === 'failed') : [];
  const set = (patch: Partial<AmUiOptions>) => onOptions({ ...options, ...patch });
  const input = 'h-8 w-full rounded-md border border-line bg-raised px-2 text-xs text-fg focus:border-accent focus:outline-none';

  return (
    <div className="scroll-thin h-full overflow-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-5">
        <div className="flex items-start gap-3 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-xs leading-relaxed text-fg" role="note">
          <Icon name="alert" size={16} className="mt-0.5 text-warn" />
          <div><span className="font-semibold">Partly verified on a phone.</span> {UNTESTED_STATEMENT.replace(/^Partly verified: /, '')}</div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex flex-col gap-4">
            <section className="rounded-lg border border-line bg-panel">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <div className="text-sm font-semibold">Pre-export validation</div>
                  <div className="text-xs text-muted">{TARGET.format} · ffver {TARGET.ffver} · reference app {TARGET.appVersion}</div>
                </div>
                {!validation ? <Badge><Icon name="spinner" size={11} /> Checking</Badge> : validation.ok ? <Badge tone="ok"><Icon name="check" size={11} /> Passed{warnings.length ? ` · ${warnings.length} warnings` : ''}</Badge> : <Badge tone="err">{errors.length} errors</Badge>}
              </div>
              <ul className="grid grid-cols-1 gap-x-4 px-4 py-3 sm:grid-cols-2">
                {validation?.checks.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 py-1 text-xs">
                    <Icon name={c.status === 'pass' ? 'check' : c.status === 'warn' ? 'alert' : 'x'} size={14} className={c.status === 'pass' ? 'text-ok' : c.status === 'warn' ? 'text-warn' : 'text-err'} />
                    <span className={c.status === 'fail' ? 'text-err' : 'text-fg'}>{c.title}</span>
                  </li>
                ))}
              </ul>
              {(errors.length > 0 || warnings.length > 0) && (
                <div className="border-t border-line px-4 py-2">
                  {[...errors, ...warnings].map((i, k) => (
                    <div key={k} className="flex gap-2 py-0.5 text-xs"><span className={i.level === 'error' ? 'text-err' : 'text-warn'}>{i.level}</span><span className="text-muted">{i.message}{i.layerId ? ` (layer ${i.layerId})` : ''}</span></div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-lg border border-line bg-panel">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div className="text-sm font-semibold">Layers ({conv?.layers.length ?? 0})</div>
                <div className="text-xs text-muted">{conv?.media.length ?? 0} media file{conv?.media.length === 1 ? '' : 's'} packaged</div>
              </div>
              <div className="max-h-80 overflow-auto scroll-thin">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-panel text-subtle"><tr><th className="px-4 py-2 font-medium">ID</th><th className="py-2 font-medium">Layer</th><th className="py-2 font-medium">Type</th><th className="py-2 pr-4 font-medium">Notes</th></tr></thead>
                  <tbody>
                    {conv?.layers.map((l) => (
                      <tr key={l.id} className="cursor-pointer border-t border-line hover:bg-hover" onClick={() => onSelectNode(l.nodeId)}>
                        <td className="px-4 py-1.5 font-mono text-subtle">{l.id}</td>
                        <td className="py-1.5" style={{ paddingLeft: l.depth * 14 }}><span className="text-fg">{l.label}</span></td>
                        <td className="py-1.5"><span className="flex items-center gap-1"><Badge>{l.layerType}</Badge>{l.animated && <Badge tone="accent">Keyframed</Badge>}</span></td>
                        <td className="py-1.5 pr-4 text-muted">{l.notes.length ? <span title={l.notes.join('\n')}><Icon name="alert" size={12} className="mr-1 inline text-warn" />{l.notes[0]}{l.notes.length > 1 ? ` (+${l.notes.length - 1})` : ''}</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {conv && conv.dropped.length > 0 && (
              <section className="rounded-lg border border-line bg-panel">
                <div className="border-b border-line px-4 py-3 text-sm font-semibold">Not converted ({conv.dropped.length})</div>
                <ul className="px-4 py-2">
                  {conv.dropped.map((d) => (
                    <li key={d.nodeId} className="flex cursor-pointer gap-2 py-1 text-xs hover:text-fg" onClick={() => onSelectNode(d.nodeId)}>
                      <Icon name="x" size={13} className="mt-px text-err" /><span><span className="font-medium text-fg">{d.name}</span> <span className="text-muted">— {d.reason}</span></span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {assumedUsed.length > 0 && (
              <section className="rounded-lg border border-line bg-panel">
                <div className="border-b border-line px-4 py-3 text-sm font-semibold">Known gaps</div>
                <ul className="px-4 py-2">
                  {assumedUsed.map((r) => (
                    <li key={r.id} className="py-1.5 text-xs"><Badge tone={r.provenance === 'failed' ? 'err' : 'warn'} className="mr-1.5">{r.provenance === 'failed' ? 'Failed on device' : 'Not yet tested'}</Badge><span className="font-medium text-fg">{r.title}.</span> <span className="text-muted">{r.description}</span></li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-lg border border-line bg-panel">
              <button className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setShowXml((v) => !v)} aria-expanded={showXml}>
                <span className="text-sm font-semibold">Generated scene XML</span>
                <span className="flex items-center gap-2 text-xs text-muted">{conv ? formatBytes(new TextEncoder().encode(conv.xml).length) : ''}<Icon name={showXml ? 'chevronDown' : 'chevronRight'} size={14} /></span>
              </button>
              {showXml && conv && <pre className="scroll-thin max-h-96 overflow-auto border-t border-line bg-raised px-4 py-3 font-mono text-[11px] leading-relaxed text-fg" data-testid="am-xml">{conv.xml}</pre>}
            </section>
          </div>

          <aside className="flex flex-col gap-4">
            <section className="rounded-lg border border-line bg-panel">
              <SectionTitle>Project settings</SectionTitle>
              <div className="flex flex-col gap-3 px-3 pb-4">
                <label className="flex flex-col gap-1 text-xs text-muted">Title<input className={input} value={options.title} onChange={(e) => set({ title: e.target.value })} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-xs text-muted">Frame rate
                    <select className={input} value={options.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>{[12, 15, 24, 25, 30, 48, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}</select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-muted">Duration (s)
                    <input className={input} type="number" min={0.1} max={600} step={0.1} value={options.seconds} onChange={(e) => set({ seconds: Math.max(0.1, Math.min(600, Number(e.target.value) || 0.1)) })} />
                  </label>
                </div>
                <div className="flex flex-col gap-1.5 text-xs text-muted">Background
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-fg"><input type="checkbox" checked={options.transparent} onChange={(e) => set({ transparent: e.target.checked })} className="accent-[var(--c-accent)]" />Transparent</label>
                    <input type="color" aria-label="Background colour" disabled={options.transparent} value={toHexRGB(parseColor(options.background) ?? { r: 0, g: 0, b: 0, a: 1 })} onChange={(e) => set({ background: e.target.value })} className="ml-auto h-7 w-10 cursor-pointer rounded border border-line bg-transparent disabled:opacity-40" />
                  </div>
                </div>
                <label className="flex flex-col gap-1 text-xs text-muted">Image folder on the phone
                  <input className={`${input} font-mono`} value={options.phoneFolder} spellCheck={false} onChange={(e) => set({ phoneFolder: e.target.value })} />
                  <span className="text-[11px] text-subtle">Images are referenced from this folder. Copy the packaged images into it before importing.</span>
                </label>
                <div className="text-[11px] text-subtle">Canvas {conv?.width} × {conv?.height} px (from the source).</div>
              </div>
            </section>

            <section className="rounded-lg border border-line bg-panel p-3">
              <div className="mb-2 text-sm font-semibold">Export</div>
              <div className="flex flex-col gap-2">
                <Button variant="primary" icon={busy ? 'spinner' : 'download'} disabled={blocked || busy} data-testid="download-package"
                  onClick={async () => { if (!conv || !report) return; setBusy(true); try { await save(await buildPackage(conv, report, original) as BlobPart, `${base}.am-package.zip`, 'application/zip'); } finally { setBusy(false); } }}>
                  Download package (.zip)
                </Button>
                <Button icon="code" disabled={blocked} onClick={() => conv && void save(conv.xml, `${base}.xml`, 'application/xml')}>Download scene XML only</Button>
                <Button variant="ghost" icon="file" disabled={!report} onClick={() => report && void save(report.markdown, `${base}.compatibility-report.md`, 'text/markdown')}>Compatibility report (.md)</Button>
                {saveMsg && <div className="text-[11px] text-warn" role="status">{saveMsg}</div>}
                {blocked && validation && <div className="text-[11px] text-err">Fix the validation errors before exporting.</div>}
              </div>
            </section>

            <section className="rounded-lg border border-line bg-panel p-3">
              <div className="mb-2 text-sm font-semibold">Import into Alight Motion</div>
              <ol className="flex list-decimal flex-col gap-1.5 pl-4 text-xs leading-relaxed text-muted">
                {IMPORT_STEPS.map((s, k) => <li key={k}>{s}</li>)}
              </ol>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
