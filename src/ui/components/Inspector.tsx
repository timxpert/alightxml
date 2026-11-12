import { useState } from 'react';
import { saveFile } from '../download';
import { formatBytes } from '../../core/assets/resolver';
import type { AmConversion } from '../../core/alight/writer';
import { RULES } from '../../core/alight/rules';
import { toCss, toHexRGB } from '../../core/design/color';
import { nodeBounds } from '../../core/design/bounds';
import { decompose } from '../../core/design/matrix';
import type { DesignNode, Paint } from '../../core/design/model';
import type { AssetVM } from '../useAssets';
import { Badge, Button, Empty, Icon, Row, SectionTitle, STATUS_LABEL, STATUS_TONE, type Tone } from './ui';

const n2 = (v: number) => (Math.round(v * 100) / 100).toString();

function PaintView({ paint }: { paint: Paint }) {
  if (paint.type === 'none') return <span className="text-subtle">None</span>;
  if (paint.type === 'solid') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="h-3.5 w-3.5 rounded-sm border border-line-strong" style={{ background: toCss(paint.color) }} />
        <span className="font-mono text-[11px]">{toHexRGB(paint.color)}{paint.color.a < 1 ? ` · ${Math.round(paint.color.a * 100)}%` : ''}</span>
      </span>
    );
  }
  const css = `linear-gradient(90deg, ${paint.stops.map((s) => `${toCss(s.color)} ${s.offset * 100}%`).join(', ')})`;
  return (
    <span className="flex flex-col gap-1">
      <span className="h-3.5 w-full rounded-sm border border-line-strong" style={{ background: css }} />
      <span className="text-[11px] text-muted">{paint.type === 'linear' ? 'Linear' : 'Radial'} gradient · {paint.stops.length} stops · #{paint.sourceId}</span>
    </span>
  );
}

export function AssetInspector({ asset, onShowLine }: { asset: AssetVM; onShowLine: (line: number) => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const download = async () => {
    if (!asset.bytes) return;
    setMsg(null);
    const r = await saveFile(asset.name, asset.bytes.slice(0), asset.mime ?? 'application/octet-stream');
    if (!r.ok) setMsg(r.message);
  };
  return (
    <div>
      <div className={`m-3 flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border border-line ${asset.display === 'ok' ? 'checker' : 'bg-raised'}`}>
        {asset.display === 'ok' && asset.objectUrl ? (
          <img src={asset.objectUrl} alt={asset.name} className="max-h-full max-w-full object-contain" referrerPolicy="no-referrer" />
        ) : (
          <div className="px-4 text-center text-xs text-muted">No preview: the image is {STATUS_LABEL[asset.status].toLowerCase()}.</div>
        )}
      </div>
      <div className="flex items-center gap-2 px-3">
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-fg" title={asset.name}>{asset.name}</div>
        <Badge tone={STATUS_TONE[asset.status]}>{STATUS_LABEL[asset.status]}</Badge>
      </div>
      {asset.reason && (
        <div className={`mx-3 mt-2 rounded-md border px-2.5 py-2 text-xs leading-relaxed ${asset.status === 'resolved' ? 'border-line bg-raised text-muted' : asset.status === 'remote' ? 'border-info/25 bg-info/10 text-fg' : 'border-err/25 bg-err/10 text-fg'}`}>{asset.reason}</div>
      )}
      {asset.warnings.map((w, k) => (
        <div key={k} className="mx-3 mt-2 flex gap-2 rounded-md border border-warn/25 bg-warn/10 px-2.5 py-2 text-xs leading-relaxed text-fg"><Icon name="alert" size={14} className="mt-px text-warn" />{w}</div>
      ))}
      <SectionTitle>Image</SectionTitle>
      <Row label="Dimensions">{asset.width && asset.height ? `${asset.width} × ${asset.height} px` : '—'}</Row>
      <Row label="Format">{asset.format ? `${asset.format.toUpperCase()} (${asset.mime})` : '—'}</Row>
      <Row label="Size">{asset.byteLength ? formatBytes(asset.byteLength) : '—'}</Row>
      {asset.sha256 && <Row label="SHA-256" mono>{asset.sha256.slice(0, 16)}…</Row>}
      <SectionTitle>Source</SectionTitle>
      <Row label="Location" mono>{asset.location}</Row>
      <Row label="Reference" mono>{asset.rawReference}</Row>
      {asset.method && <Row label="Resolved by">{asset.method}</Row>}
      <Row label="Detected by">
        <span className="flex flex-col gap-1">
          <Badge tone={asset.confidence === 'schema' ? 'accent' : 'neutral'} className="self-start">{asset.confidence === 'schema' ? 'Format rule' : 'Value content'}</Badge>
          <span className="text-muted">{asset.evidence}</span>
        </span>
      </Row>
      <SectionTitle>Used at ({asset.usages.length})</SectionTitle>
      <div className="flex flex-col gap-1 px-3 pb-2">
        {asset.usages.map((u, k) => (
          <button key={k} onClick={() => onShowLine(u.line)} className="flex flex-col rounded-md border border-line bg-raised px-2 py-1.5 text-left hover:border-line-strong">
            <span className="font-mono text-[11px] text-fg">Line {u.line}:{u.col}{u.attribute ? ` · ${u.attribute}` : ''}</span>
            <span className="truncate font-mono text-[11px] text-subtle" title={u.elementPath}>{u.elementPath}</span>
            {(u.declaredWidth || u.declaredHeight) && <span className="text-[11px] text-muted">Declared size {u.declaredWidth ?? '?'} × {u.declaredHeight ?? '?'}</span>}
          </button>
        ))}
      </div>
      {asset.objectUrl && asset.bytes && <div className="px-3 pb-4"><Button icon="download" size="sm" onClick={() => void download()} className="w-full">Download image</Button>{msg && <div className="mt-1.5 text-[11px] text-warn" role="status">{msg}</div>}</div>}
    </div>
  );
}

export function NodeInspector({ node, assets, conv, onShowLine }: { node: DesignNode; assets: AssetVM[]; conv?: AmConversion; onShowLine: (line: number) => void }) {
  const byKey = new Map(assets.map((a) => [a.key, a]));
  const b = nodeBounds(node, (k) => ({ w: byKey.get(k)?.width, h: byKey.get(k)?.height }));
  const d = decompose(node.matrix);
  const layer = conv?.layers.find((l) => l.nodeId === node.id);
  const dropped = conv?.dropped.find((x) => x.nodeId === node.id);
  const kindLabel: Record<DesignNode['kind'], string> = { rect: 'Rectangle', ellipse: 'Ellipse', path: 'Vector path', image: 'Image', text: 'Text', group: 'Group' };
  const asset = node.kind === 'image' ? byKey.get(node.assetKey) : undefined;
  return (
    <div className="pb-4">
      <div className="flex items-center gap-2 px-3 pt-3">
        <div className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{node.name}</div>
        <Badge>{kindLabel[node.kind]}</Badge>
      </div>
      <button onClick={() => onShowLine(node.source.line)} className="mx-3 mt-1 block truncate font-mono text-[11px] text-subtle hover:text-accent" title={node.source.elementPath}>
        line {node.source.line} · {node.source.elementPath}
      </button>
      <SectionTitle>Transform</SectionTitle>
      {b && <Row label="Position">X {n2(b.x)} · Y {n2(b.y)}</Row>}
      {b && <Row label="Size">W {n2(b.w)} · H {n2(b.h)}</Row>}
      <Row label="Rotation">{n2(d.rotation)}°</Row>
      <Row label="Scale">{n2(d.scaleX)} × {n2(d.scaleY)}{Math.abs(d.skew) > 1e-6 ? ` · skew ${n2(d.skew)}` : ''}</Row>
      <Row label="Opacity">{Math.round(node.opacity * 100)}%</Row>
      {'fill' in node && (
        <>
          <SectionTitle>Appearance</SectionTitle>
          <Row label="Fill"><PaintView paint={node.fill} /></Row>
          {'stroke' in node && node.stroke && <Row label="Stroke"><span className="flex flex-col gap-1"><PaintView paint={node.stroke.paint} /><span className="text-[11px] text-muted">{n2(node.stroke.width)} px</span></span></Row>}
        </>
      )}
      {node.kind === 'text' && (
        <>
          <SectionTitle>Font</SectionTitle>
          <Row label="Family">{node.fontFamily}</Row>
          <Row label="Size">{n2(node.fontSize)} px</Row>
          <Row label="Weight">{node.fontWeight}{node.fontStyle === 'italic' ? ' · italic' : ''}</Row>
          <Row label="Anchor">{node.anchor}</Row>
          <Row label="Content">{node.lines.join(' ⏎ ')}</Row>
        </>
      )}
      {node.kind === 'image' && (
        <>
          <SectionTitle>Image</SectionTitle>
          <Row label="Reference" mono>{node.href}</Row>
          <Row label="Asset">{asset ? <span className="flex items-center gap-1.5">{asset.name} <Badge tone={STATUS_TONE[asset.status]}>{STATUS_LABEL[asset.status]}</Badge></span> : 'Unknown'}</Row>
          {asset?.width && <Row label="Intrinsic">{asset.width} × {asset.height} px</Row>}
          <Row label="Fit">{node.preserveAspectRatio}</Row>
        </>
      )}
      {node.animations.length > 0 && (
        <>
          <SectionTitle>Animation</SectionTitle>
          {node.animations.map((a, k) => (
            <Row key={k} label={a.property}>{a.keyframes.length} keyframes · {n2(a.keyframes[0].t / 1000)}–{n2(a.keyframes[a.keyframes.length - 1].t / 1000)} s</Row>
          ))}
        </>
      )}
      <SectionTitle>Alight Motion</SectionTitle>
      {!conv ? (
        <div className="px-3 text-xs text-muted">Open the Alight Motion tab to generate the conversion.</div>
      ) : layer ? (
        <div className="flex flex-col gap-2 px-3">
          <div className="flex flex-wrap items-center gap-1.5 text-xs"><Badge tone="ok">Layer {layer.id}</Badge><Badge>{layer.layerType}</Badge><span className="font-mono text-[11px] text-subtle">&lt;{layer.tag}&gt;</span></div>
          {layer.notes.map((n, k) => <div key={k} className="flex gap-1.5 text-xs text-muted"><Icon name="alert" size={13} className="mt-px text-warn" />{n}</div>)}
          <div className="flex flex-wrap gap-1">
            {layer.rules.map((r) => {
              const rule = RULES[r];
              const tone: Tone = rule?.provenance === 'verified' ? 'ok' : rule?.provenance === 'failed' ? 'err' : rule?.provenance === 'assumed' ? 'warn' : 'info';
              return <span key={r} title={`${rule?.provenance}: ${rule?.description}`}><Badge tone={tone}>{rule?.title ?? r}</Badge></span>;
            })}
          </div>
        </div>
      ) : dropped ? (
        <div className="mx-3 rounded-md border border-err/25 bg-err/10 px-2.5 py-2 text-xs text-fg">Not exported: {dropped.reason}</div>
      ) : (
        <div className="px-3 text-xs text-muted">Not part of the export.</div>
      )}
    </div>
  );
}

export function InspectorEmpty() {
  return <Empty icon="layers" title="Nothing selected">Select an image in the gallery, or a layer on the canvas, to inspect its properties.</Empty>;
}
