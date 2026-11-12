import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildReport } from '../core/alight/report';
import { validateConversion, type ValidationResult } from '../core/alight/validate';
import { convertToAlightMotion } from '../core/alight/writer';
import { parseColor } from '../core/design/color';
import { findNode } from '../core/design/model';
import { formatBytes } from '../core/assets/resolver';
import type { ResolvedAsset } from '../core/assets/types';
import type { AnalysisResult } from '../core/pipeline/analyze';
import { importDataTransfer, importFileList, importPasted } from '../core/project/importer';
import { basename, rankXmlCandidates, type ProjectManifest } from '../core/project/vfs';
import { runAnalysis } from '../worker/client';
import { AlightView, type AmUiOptions } from './components/AlightView';
import { AssetsView } from './components/AssetsView';
import { CanvasView, ZOOM_MAX, ZOOM_MIN } from './components/CanvasView';
import { ImportScreen, PasteDialog, SAMPLES } from './components/ImportScreen';
import { AssetInspector, InspectorEmpty, NodeInspector } from './components/Inspector';
import { LeftPanel } from './components/LeftPanel';
import { SourceView } from './components/SourceView';
import { Badge, Button, Icon, IconButton } from './components/ui';
import { useAssets } from './useAssets';

type View = 'assets' | 'canvas' | 'source' | 'alight';
type Selection = { kind: 'asset' | 'node'; id: string } | null;

function initialTheme(): 'dark' | 'light' {
  try {
    const t = localStorage.getItem('xml-canvas-theme');
    if (t === 'light' || t === 'dark') return t;
  } catch { /* storage unavailable */ }
  return 'dark';
}

export function App() {
  const [theme, setTheme] = useState(initialTheme);
  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [activeXml, setActiveXml] = useState<string | null>(null);
  const [pasted, setPasted] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ stage: string; done?: number; total?: number } | null>(null);
  const [result, setResult] = useState<AnalysisResult | undefined>();
  const [inWorker, setInWorker] = useState<boolean | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [view, setView] = useState<View>('assets');
  const [selection, setSelection] = useState<Selection>(null);
  const [zoom, setZoom] = useState(1);
  const [fitSignal, setFitSignal] = useState(0);
  const [gotoLine, setGotoLine] = useState<{ line: number; nonce: number } | undefined>();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [amOptions, setAmOptions] = useState<AmUiOptions>({ title: 'Untitled', fps: 30, seconds: 5, transparent: true, background: '#000000' });
  const [validation, setValidation] = useState<ValidationResult | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { assets, loadRemote } = useAssets(result?.assets);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('xml-canvas-theme', theme); } catch { /* ignore */ }
  }, [theme]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const analyzeXml = useCallback(async (m: ProjectManifest, xmlPath: string | null, text?: string) => {
    setBusy(true);
    setActiveXml(xmlPath);
    setSelection(null);
    setProgress({ stage: 'Starting' });
    try {
      const { result: r, inWorker: w } = await runAnalysis({ kind: m.kind, files: m.files, xmlPath, pastedText: text }, (stage, done, total) => setProgress({ stage, done, total }));
      setResult(r);
      setInWorker(w);
      setImportError(null);
      const title = xmlPath ? basename(xmlPath).replace(/\.[^.]+$/, '') : m.name;
      setAmOptions((o) => ({ ...o, title, seconds: Math.max(5, Math.ceil((r.design?.durationMs ?? 0) / 100) / 10) }));
      setView(r.error ? 'source' : r.design ? 'canvas' : 'assets');
      setFitSignal((s) => s + 1);
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, []);

  const openManifest = useCallback(async (m: ProjectManifest, text?: string) => {
    setManifest(m);
    setResult(undefined);
    setValidation(undefined);
    setPasted(text);
    if (m.kind === 'paste') return analyzeXml(m, null, text);
    const candidates = m.kind === 'single-file' ? [m.files[0].path] : rankXmlCandidates(m.files.map((f) => f.path));
    if (!candidates.length) {
      setImportError(`No XML files were found in "${m.name}". Supported extensions include .xml, .svg and .fb2.`);
      setActiveXml(null);
      return;
    }
    setImportError(null);
    return analyzeXml(m, candidates[0]);
  }, [analyzeXml]);

  const guard = async (fn: () => Promise<ProjectManifest>) => {
    setBusy(true);
    setMenuOpen(false);
    try {
      await openManifest(await fn());
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFiles = (list: FileList | null, folder: boolean) => {
    if (!list || !list.length) return;
    const arr = Array.from(list);
    void guard(() => importFileList(arr, folder));
  };

  const loadSample = (file: string) => guard(async () => {
    const res = await fetch('samples.json');
    if (!res.ok) throw new Error(`The samples could not be loaded (HTTP ${res.status}).`);
    const bundle = (await res.json()) as Record<string, string>;
    if (!bundle[file]) throw new Error(`The sample "${file}" is missing from samples.json.`);
    const bin = atob(bundle[file]);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    return importFileList([new File([bytes], file)], false);
  });

  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDragOver(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragOver(false); };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDragOver(false);
      const dt = e.dataTransfer;
      void guard(() => importDataTransfer(dt));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  });

  // ---- Alight Motion conversion (recomputed when inputs settle) ----
  const settled = assets.every((a) => a.display !== 'pending' && a.remoteState !== 'loading');
  const convertible = !!result?.design && result.format?.id !== 'alight';
  const conv = useMemo(() => {
    if (!result?.design || !convertible || !settled) return undefined;
    const map = new Map<string, ResolvedAsset>(assets.map((a) => [a.key, a]));
    return convertToAlightMotion(result.design, map, {
      title: amOptions.title || 'Untitled',
      fps: amOptions.fps,
      totalTime: Math.round(amOptions.seconds * 1000),
      background: amOptions.transparent ? null : parseColor(amOptions.background),
      sourceName: activeXml ?? 'pasted.xml',
    });
  }, [result, assets, settled, amOptions, activeXml, convertible]);
  useEffect(() => {
    setValidation(undefined);
    if (!conv) return;
    let cancelled = false;
    validateConversion(conv).then((v) => { if (!cancelled) setValidation(v); });
    return () => { cancelled = true; };
  }, [conv]);
  const report = useMemo(() => (conv && validation && result ? buildReport(conv, validation, { sourceName: activeXml ?? 'pasted.xml', sourceFormat: result.format?.name ?? 'XML', assets, designIssues: result.design?.issues ?? [] }) : undefined), [conv, validation, result, assets, activeXml]);
  const droppedIds = useMemo(() => new Set(conv?.dropped.map((d) => d.nodeId) ?? []), [conv]);

  const showLine = (line: number) => { setView('source'); setGotoLine({ line, nonce: Date.now() }); };
  const selectNode = (id: string | undefined) => { setSelection(id ? { kind: 'node', id } : null); };
  const selectedAsset = selection?.kind === 'asset' ? assets.find((a) => a.id === selection.id) : undefined;
  const selectedNode = selection?.kind === 'node' && result?.design ? findNode(result.design.nodes, selection.id) : undefined;
  const counts = { resolved: assets.filter((a) => a.status === 'resolved').length, total: assets.length };
  const closeProject = () => { setManifest(null); setResult(undefined); setActiveXml(null); setSelection(null); setImportError(null); setValidation(undefined); };

  const views: Array<[View, string, string, boolean]> = [
    ['assets', 'Assets', 'image', true],
    ['canvas', 'Canvas', 'canvas', !!result?.design],
    ['source', 'Source', 'code', !!result],
    ['alight', 'Alight Motion', 'motion', true],
  ];

  return (
    <div className="flex h-full flex-col bg-app text-fg">
      <input ref={fileInput} type="file" hidden onChange={(e) => { onFiles(e.target.files, false); e.target.value = ''; }} accept=".xml,.svg,.fb2,.xhtml,.zip,.docx,.pptx,.xlsx,application/xml,text/xml,image/svg+xml" data-testid="file-input" />
      <input ref={folderInput} type="file" hidden multiple onChange={(e) => { onFiles(e.target.files, true); e.target.value = ''; }} {...{ webkitdirectory: '', directory: '' }} data-testid="folder-input" />
      <input ref={zipInput} type="file" hidden onChange={(e) => { onFiles(e.target.files, false); e.target.value = ''; }} accept=".zip,.docx,.pptx,.xlsx,application/zip" />

      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m7 8 4 4-4 4M13 16h5" /></svg></div>
          <span className="text-[13px] font-semibold tracking-tight">XML Canvas</span>
        </div>
        {manifest && (
          <div className="flex min-w-0 items-center gap-2 border-l border-line pl-3 text-xs">
            <span className="truncate font-medium text-fg" title={manifest.name}>{manifest.name}</span>
            {activeXml && activeXml !== manifest.name && <><span className="text-subtle">/</span><span className="truncate text-muted" title={activeXml}>{activeXml}</span></>}
          </div>
        )}
        {manifest && (
          <nav className="mx-auto flex items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5" aria-label="Views">
            {views.map(([k, label, icon, enabled]) => (
              <button key={k} disabled={!enabled} onClick={() => setView(k)} aria-current={view === k} data-view={k}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:opacity-35 ${view === k ? 'bg-panel text-fg shadow-sm ring-1 ring-line-strong dark:bg-hover' : 'text-muted hover:text-fg'}`}>
                <Icon name={icon} size={14} />{label}{k === 'assets' && counts.total > 0 && <span className="text-subtle">{counts.total}</span>}
              </button>
            ))}
          </nav>
        )}
        <div className={`flex items-center gap-1 ${manifest ? '' : 'ml-auto'}`}>
          {view === 'canvas' && result?.design && (
            <div className="mr-1 flex items-center rounded-md border border-line bg-raised">
              <IconButton icon="minus" label="Zoom out" onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z / 1.25))} />
              <button className="w-14 text-center text-xs tabular-nums text-muted hover:text-fg" title="Reset to 100%" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
              <IconButton icon="plus" label="Zoom in" onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * 1.25))} />
              <IconButton icon="fit" label="Fit to screen" onClick={() => setFitSignal((s) => s + 1)} />
            </div>
          )}
          <div className="relative" ref={menuRef}>
            <Button icon="import" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>Import</Button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-10 z-40 w-60 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-xl">
                {[['file', 'Open XML or SVG file…', () => fileInput.current?.click()], ['folder', 'Open folder…', () => folderInput.current?.click()], ['zip', 'Open ZIP / DOCX / PPTX…', () => zipInput.current?.click()], ['paste', 'Paste XML…', () => setShowPaste(true)]].map(([icon, label, fn]) => (
                  <button key={label as string} role="menuitem" onClick={() => { setMenuOpen(false); (fn as () => void)(); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-fg hover:bg-hover"><Icon name={icon as string} size={14} className="text-subtle" />{label as string}</button>
                ))}
                <div className="my-1 border-t border-line" />
                <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">Samples</div>
                {SAMPLES.map((s) => <button key={s.file} role="menuitem" onClick={() => void loadSample(s.file)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-muted hover:bg-hover hover:text-fg">{s.title}</button>)}
              </div>
            )}
          </div>
          <Button variant="primary" icon="export" disabled={!convertible} onClick={() => setView('alight')} title={convertible ? 'Convert to Alight Motion' : result?.format?.id === 'alight' ? 'This file is already an Alight Motion project' : 'Export needs an SVG design'}>Export</Button>
          <IconButton icon={theme === 'dark' ? 'sun' : 'moon'} label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
          {manifest && <IconButton icon="close" label="Close project" onClick={closeProject} />}
        </div>
      </header>

      {importError && (
        <div className="flex items-start gap-2 border-b border-err/30 bg-err/10 px-4 py-2 text-xs text-fg" role="alert">
          <Icon name="x" size={15} className="mt-px text-err" /><span className="flex-1">{importError}</span>
          <button className="text-muted hover:text-fg" onClick={() => setImportError(null)} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {!manifest ? (
          <main className="min-w-0 flex-1">
            <ImportScreen busy={busy} onPickFile={() => fileInput.current?.click()} onPickFolder={() => folderInput.current?.click()} onPickZip={() => zipInput.current?.click()} onPaste={() => setShowPaste(true)} onSample={(f) => void loadSample(f)} />
          </main>
        ) : (
          <>
            <aside className="w-64 shrink-0 border-r border-line bg-panel">
              <LeftPanel manifest={manifest} activeXml={activeXml} result={result} selectedNodeId={selection?.kind === 'node' ? selection.id : undefined}
                onOpenXml={(p) => void analyzeXml(manifest, p)} onSelectNode={(id) => { selectNode(id); if (view !== 'canvas' && view !== 'alight') setView('canvas'); }} droppedIds={droppedIds} />
            </aside>
            <main className="relative min-w-0 flex-1 bg-app">
              {busy && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-app/70 backdrop-blur-[1px]" aria-live="polite">
                  <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3 text-xs shadow-lg">
                    <Icon name="spinner" className="text-accent" />
                    <span className="text-fg">{progress?.stage ?? 'Working'}{progress?.total ? ` ${progress.done}/${progress.total}` : ''}…</span>
                  </div>
                </div>
              )}
              {!result ? (
                !busy && <div className="flex h-full items-center justify-center text-xs text-muted">Select an XML file from the Files panel.</div>
              ) : view === 'assets' ? (
                result.error ? <div className="p-6"><div className="rounded-lg border border-err/30 bg-err/10 p-4 text-sm">This file is not well-formed XML, so its images cannot be detected. <button className="font-semibold text-accent hover:underline" onClick={() => setView('source')}>See the error in the source</button>.</div></div>
                  : <AssetsView assets={assets} selectedId={selectedAsset?.id} onSelect={(id) => setSelection({ kind: 'asset', id })} onLoadRemote={() => void loadRemote()} />
              ) : view === 'canvas' && result.design ? (
                <CanvasView scene={result.design} assets={assets} zoom={zoom} onZoom={setZoom} fitSignal={fitSignal} selectedId={selection?.kind === 'node' ? selection.id : undefined} onSelect={selectNode} droppedIds={droppedIds} />
              ) : view === 'source' ? (
                <SourceView text={result.sourceText} folds={result.folds} error={result.error} warnings={result.parseWarnings} gotoLine={gotoLine} />
              ) : (
                <AlightView available={convertible} unavailableReason={result.error ? 'Fix the XML error first.' : result.format?.id === 'alight' ? 'This file is already Alight Motion scene XML. The Canvas tab shows how XML Canvas reads it, and the Assets tab shows whether its images can be found.' : `Conversion reads layout from SVG designs. This file is ${result.format?.name ?? 'not SVG'}, which XML Canvas interprets for its images only, so there is no layout to convert.`}
                  conv={conv} validation={validation} report={report} options={amOptions} onOptions={setAmOptions}
                  original={{ name: activeXml ?? 'pasted.xml', text: pasted ?? result.sourceText }} onSelectNode={(id) => { selectNode(id); setView('canvas'); }} />
              )}
            </main>
            <aside className="scroll-thin w-80 shrink-0 overflow-auto border-l border-line bg-panel" aria-label="Inspector">
              <div className="flex h-10 items-center border-b border-line px-3 text-xs font-semibold text-muted">Properties</div>
              {selectedAsset ? <AssetInspector asset={selectedAsset} onShowLine={showLine} />
                : selectedNode ? <NodeInspector node={selectedNode} assets={assets} conv={conv} onShowLine={showLine} />
                : <InspectorEmpty />}
            </aside>
          </>
        )}
        {dragOver && (
          <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent-soft backdrop-blur-sm">
            <div className="rounded-lg bg-panel px-4 py-3 text-sm font-medium shadow-lg">Drop to open the file, folder or ZIP</div>
          </div>
        )}
      </div>

      <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-3 text-[11px] text-subtle" data-testid="status-bar">
        {result ? (
          <>
            <span>{result.format?.name ?? (result.error ? 'Invalid XML' : '—')}</span>
            <span>{result.encoding}</span>
            <span>{formatBytes(result.byteLength)}</span>
            {result.stats && <span>{result.stats.elements.toLocaleString()} elements</span>}
            <span>Parsed in {Math.max(1, Math.round(result.timings.parse ?? 0))} ms{inWorker === false ? ' (main thread)' : inWorker ? ' (worker)' : ''}</span>
            {counts.total > 0 && <span className="flex items-center gap-1"><Badge tone={counts.resolved === counts.total ? 'ok' : 'warn'}>{counts.resolved}/{counts.total} images resolved</Badge></span>}
            {result.error && <Badge tone="err">Line {result.error.line}: {result.error.code}</Badge>}
          </>
        ) : <span>Local processing · nothing is uploaded</span>}
      </footer>

      {showPaste && <PasteDialog onCancel={() => setShowPaste(false)} onSubmit={(text) => { setShowPaste(false); void openManifest(importPasted(text), text); }} />}
    </div>
  );
}
