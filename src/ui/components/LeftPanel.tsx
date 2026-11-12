import { useState } from 'react';
import type { AnalysisResult } from '../../core/pipeline/analyze';
import type { DesignNode } from '../../core/design/model';
import type { ProjectManifest } from '../../core/project/vfs';
import { formatBytes } from '../../core/assets/resolver';
import { extname, isLikelyXmlPath } from '../../core/project/vfs';
import { Badge, Empty, Icon, Row, SectionTitle } from './ui';

type Tab = 'files' | 'layers' | 'structure';

const KIND_ICON: Record<DesignNode['kind'], string> = { rect: 'rect', ellipse: 'circle', path: 'path', image: 'image', text: 'text', group: 'group' };
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif', 'tif', 'tiff', 'heic']);

function LayerTree({ nodes, depth, selectedId, onSelect, droppedIds }: { nodes: DesignNode[]; depth: number; selectedId?: string; onSelect: (id: string) => void; droppedIds: Set<string> }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  // Front-most first, like design tools.
  return (
    <>
      {[...nodes].reverse().map((n) => (
        <div key={n.id}>
          <div role="treeitem" aria-selected={selectedId === n.id} onClick={() => onSelect(n.id)}
            className={`group flex h-7 cursor-pointer items-center gap-1.5 pr-2 text-xs ${selectedId === n.id ? 'bg-accent-soft text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`} style={{ paddingLeft: 8 + depth * 14 }}>
            {n.kind === 'group' ? (
              <button aria-label={closed.has(n.id) ? 'Expand group' : 'Collapse group'} className="flex h-4 w-4 items-center justify-center rounded hover:bg-hover" onClick={(e) => { e.stopPropagation(); setClosed((c) => { const x = new Set(c); if (x.has(n.id)) x.delete(n.id); else x.add(n.id); return x; }); }}>
                <Icon name={closed.has(n.id) ? 'chevronRight' : 'chevronDown'} size={12} />
              </button>
            ) : <span className="w-4" />}
            <Icon name={KIND_ICON[n.kind]} size={14} className={selectedId === n.id ? 'text-accent' : 'text-subtle'} />
            <span className={`min-w-0 flex-1 truncate ${droppedIds.has(n.id) ? 'line-through decoration-err/60' : ''}`}>{n.name}</span>
            {n.animations.length > 0 && <span title="Animated"><Icon name="motion" size={11} className="text-accent" /></span>}
            {droppedIds.has(n.id) && <span title="Not exported to Alight Motion"><Icon name="x" size={12} className="text-err" /></span>}
          </div>
          {n.kind === 'group' && !closed.has(n.id) && <LayerTree nodes={n.children} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} droppedIds={droppedIds} />}
        </div>
      ))}
    </>
  );
}

export function LeftPanel({ manifest, activeXml, result, selectedNodeId, onOpenXml, onSelectNode, droppedIds }: {
  manifest: ProjectManifest;
  activeXml: string | null;
  result?: AnalysisResult;
  selectedNodeId?: string;
  onOpenXml: (path: string) => void;
  onSelectNode: (id: string) => void;
  droppedIds: Set<string>;
}) {
  const [tab, setTab] = useState<Tab>('files');
  const files = [...manifest.files].sort((a, b) => a.path.localeCompare(b.path));
  const usedPaths = new Set(result?.assets.map((a) => a.filePath).filter(Boolean));
  const tabs: Array<[Tab, string]> = [['files', 'Files'], ['layers', 'Layers'], ['structure', 'Structure']];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 border-b border-line px-2 py-1.5" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${tab === k ? 'bg-hover text-fg' : 'text-muted hover:text-fg'}`}>{label}</button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto py-1">
        {tab === 'files' && (
          manifest.kind === 'paste' ? (
            <div className="px-3 py-2 text-xs text-muted">Pasted XML has no folder, so relative image paths cannot be resolved. Import the folder or a ZIP to include images.</div>
          ) : (
            <div role="list">
              {files.map((f) => {
                const xml = isLikelyXmlPath(f.path) || manifest.kind === 'single-file';
                const active = f.path === activeXml;
                const depth = f.path.split('/').length - 1;
                const ext = extname(f.path);
                return (
                  <button key={f.path} role="listitem" disabled={!xml} onClick={() => xml && onOpenXml(f.path)} title={f.path}
                    className={`flex h-7 w-full items-center gap-1.5 pr-2 text-left text-xs ${active ? 'bg-accent-soft text-fg' : xml ? 'text-fg hover:bg-hover' : 'cursor-default text-muted'}`} style={{ paddingLeft: 10 + depth * 10 }}>
                    <Icon name={IMG_EXT.has(ext) ? 'image' : xml ? 'code' : 'file'} size={14} className={active ? 'text-accent' : 'text-subtle'} />
                    <span className="min-w-0 flex-1 truncate">{f.path.split('/').pop()}</span>
                    {usedPaths.has(f.path) && <span className="h-1.5 w-1.5 rounded-full bg-ok" title="Referenced by the open XML" />}
                    <span className="text-[10px] text-subtle">{formatBytes(f.size)}</span>
                  </button>
                );
              })}
              {manifest.notes.map((n, k) => <div key={k} className="mx-3 mt-2 rounded-md border border-warn/25 bg-warn/10 px-2 py-1.5 text-[11px] text-fg">{n}</div>)}
            </div>
          )
        )}
        {tab === 'layers' && (
          result?.design ? (
            result.design.nodes.length ? <div role="tree"><LayerTree nodes={result.design.nodes} depth={0} selectedId={selectedNodeId} onSelect={onSelectNode} droppedIds={droppedIds} /></div>
              : <Empty icon="layers" title="No visible layers">The design contains no drawable elements.</Empty>
          ) : (
            <Empty icon="layers" title="No layer reconstruction">
              {result?.format ? `${result.format.name} files are interpreted for their images only. Layer reconstruction is available for SVG.` : 'Open an XML file first.'}
            </Empty>
          )
        )}
        {tab === 'structure' && result && (
          <div>
            {result.format && (
              <div className="mx-3 mt-2 rounded-lg border border-line bg-raised p-3">
                <div className="flex items-center gap-2"><span className="text-sm font-semibold">{result.format.name}</span></div>
                {result.format.variant && <div className="mt-0.5 text-xs text-accent">{result.format.variant}</div>}
                <div className="mt-1.5 text-xs leading-relaxed text-muted">{result.format.reason}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge tone={result.format.designConversion ? 'ok' : 'neutral'}>{result.format.designConversion ? 'Design conversion' : 'Images only'}</Badge>
                  {result.format.alternatives.map((a) => <Badge key={a.id}>Also matches: {a.name}</Badge>)}
                </div>
              </div>
            )}
            {result.stats && (
              <>
                <SectionTitle>Document</SectionTitle>
                <Row label="Root">&lt;{result.rootName}&gt;</Row>
                <Row label="Elements">{result.stats.elements.toLocaleString()}</Row>
                <Row label="Attributes">{result.stats.attributes.toLocaleString()}</Row>
                <Row label="Max depth">{result.stats.maxDepth}</Row>
                <Row label="Encoding">{result.encoding}</Row>
              </>
            )}
            {result.structure && result.structure.categories.length > 0 && (
              <>
                <SectionTitle>Contents</SectionTitle>
                {result.structure.categories.map((c) => <Row key={c.key} label={c.label}>{c.count}</Row>)}
              </>
            )}
            {result.structure && result.structure.ignored.length > 0 && (
              <>
                <SectionTitle>Not interpreted</SectionTitle>
                {result.structure.ignored.map((i, k) => (
                  <div key={k} className="px-3 py-1 text-xs"><span className="font-mono text-fg">{i.label}</span> <span className="text-subtle">×{i.count}</span><div className="text-muted">{i.reason}</div></div>
                ))}
              </>
            )}
            {(result.parseWarnings.length > 0 || result.decodeWarnings.length > 0) && (
              <>
                <SectionTitle>Parser warnings</SectionTitle>
                {[...result.decodeWarnings.map((m) => ({ message: m, pos: undefined })), ...result.parseWarnings].map((w, k) => (
                  <div key={k} className="mx-3 mb-1.5 flex gap-1.5 rounded-md border border-warn/25 bg-warn/10 px-2 py-1.5 text-[11px] leading-relaxed text-fg"><Icon name="alert" size={12} className="mt-0.5 text-warn" /><span>{w.message}{w.pos ? ` (line ${w.pos.line})` : ''}</span></div>
                ))}
              </>
            )}
            {result.design && result.design.issues.length > 0 && (
              <>
                <SectionTitle>Interpretation notes</SectionTitle>
                {result.design.issues.map((i, k) => (
                  <div key={k} className="flex gap-1.5 px-3 py-1 text-[11px] leading-relaxed text-muted"><Icon name={i.level === 'warning' ? 'alert' : 'info'} size={12} className={`mt-0.5 ${i.level === 'warning' ? 'text-warn' : 'text-info'}`} /><span>{i.message}{i.source ? ` (line ${i.source.line})` : ''}</span></div>
                ))}
              </>
            )}
            {result.structure && result.structure.notes.length > 0 && (
              <>
                <SectionTitle>Notes</SectionTitle>
                {result.structure.notes.map((n, k) => <div key={k} className="px-3 py-1 text-[11px] leading-relaxed text-muted">{n}</div>)}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
