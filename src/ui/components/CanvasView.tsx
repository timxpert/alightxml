import { useCallback, useEffect, useLayoutEffect, useRef, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { nodeBounds } from '../../core/design/bounds';
import { toCss } from '../../core/design/color';
import { toCssMatrix } from '../../core/design/matrix';
import type { DesignNode, DesignScene, Paint } from '../../core/design/model';
import type { AssetVM } from '../useAssets';

interface Props {
  scene: DesignScene;
  assets: AssetVM[];
  zoom: number;
  onZoom: (z: number) => void;
  fitSignal: number;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  droppedIds: Set<string>;
}

export const ZOOM_MIN = 0.05;
export const ZOOM_MAX = 8;

function paintRef(paint: Paint, id: string, defs: ReactNode[]): string {
  if (paint.type === 'none') return 'none';
  if (paint.type === 'solid') return toCss(paint.color);
  const stops = paint.stops.map((s, k) => <stop key={k} offset={s.offset} stopColor={toCss({ ...s.color, a: 1 })} stopOpacity={s.color.a} />);
  const common = { id, gradientUnits: paint.units, gradientTransform: toCssMatrix(paint.transform) };
  defs.push(paint.type === 'linear'
    ? <linearGradient key={id} {...common} x1={paint.x1} y1={paint.y1} x2={paint.x2} y2={paint.y2}>{stops}</linearGradient>
    : <radialGradient key={id} {...common} cx={paint.cx} cy={paint.cy} r={paint.r} fx={paint.fx} fy={paint.fy}>{stops}</radialGradient>);
  return `url(#${id})`;
}

export function CanvasView({ scene, assets, zoom, onZoom, fitSignal, selectedId, onSelect, droppedIds }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const space = useRef(false);
  const byKey = new Map(assets.map((a) => [a.key, a]));
  const PAD = 64;

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const z = Math.min((el.clientWidth - PAD * 2) / scene.width, (el.clientHeight - PAD * 2) / scene.height);
    onZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)));
  }, [scene.width, scene.height, onZoom]);

  useLayoutEffect(() => { fit(); }, [fit, fitSignal]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) space.current = true; };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      onZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * Math.exp(-e.deltaY * 0.0015))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, onZoom]);

  const defs: ReactNode[] = [];
  const render = (node: DesignNode): ReactNode => {
    const select = (e: RMouseEvent) => { e.stopPropagation(); onSelect(node.id); };
    const common = { 'data-node': node.id, onClick: select, opacity: node.opacity < 1 ? node.opacity : undefined, style: { cursor: 'pointer' } } as const;
    const tf = toCssMatrix(node.matrix);
    const stroke = 'stroke' in node && node.stroke ? { stroke: paintRef(node.stroke.paint, `s-${node.id}`, defs), strokeWidth: node.stroke.width } : {};
    switch (node.kind) {
      case 'group':
        return <g key={node.id} data-node={node.id} opacity={node.opacity < 1 ? node.opacity : undefined}>{node.children.map(render)}</g>;
      case 'rect':
        return <rect key={node.id} {...common} transform={tf} x={node.x} y={node.y} width={node.width} height={node.height} rx={node.rx || undefined} ry={node.ry || undefined} fill={paintRef(node.fill, `f-${node.id}`, defs)} {...stroke} />;
      case 'ellipse':
        return <ellipse key={node.id} {...common} transform={tf} cx={node.cx} cy={node.cy} rx={node.rx} ry={node.ry} fill={paintRef(node.fill, `f-${node.id}`, defs)} {...stroke} />;
      case 'path':
        return <path key={node.id} {...common} transform={tf} d={node.d} fillRule={node.fillRule} fill={paintRef(node.fill, `f-${node.id}`, defs)} {...stroke} />;
      case 'text':
        return (
          <text key={node.id} {...common} transform={tf} x={node.x} y={node.y} fontFamily={`${node.fontFamily}, ui-sans-serif, system-ui, sans-serif`} fontSize={node.fontSize} fontWeight={node.fontWeight} fontStyle={node.fontStyle} textAnchor={node.anchor} fill={paintRef(node.fill, `f-${node.id}`, defs)}>
            {node.lines.map((l, k) => <tspan key={k} x={node.x} dy={k ? node.fontSize * 1.2 : 0}>{l}</tspan>)}
          </text>
        );
      case 'image': {
        const a = byKey.get(node.assetKey);
        const w = node.width || a?.width || 0;
        const h = node.height || a?.height || 0;
        if (a?.display === 'ok' && a.objectUrl) {
          return <image key={node.id} {...common} transform={tf} href={a.objectUrl} x={node.x} y={node.y} width={w} height={h} preserveAspectRatio={node.preserveAspectRatio} />;
        }
        const label = a ? `${a.status === 'remote' ? 'Remote, not loaded' : a.status === 'resolved' ? 'Loading' : 'Missing'}: ${a.name}` : 'Unresolved image';
        return (
          <g key={node.id} {...common} transform={tf}>
            <rect x={node.x} y={node.y} width={w || 120} height={h || 80} fill="rgba(248,113,113,0.08)" stroke="#f87171" strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
            <text x={node.x + 8} y={node.y + 18} fontSize={Math.max(10, Math.min(16, (h || 80) / 4))} fill="#f87171" fontFamily="ui-sans-serif, system-ui">{label}</text>
          </g>
        );
      }
    }
  };
  const content = scene.nodes.map(render);
  const sel = selectedId ? findNode(scene.nodes, selectedId) : undefined;
  const box = sel ? nodeBounds(sel, (k) => ({ w: byKey.get(k)?.width, h: byKey.get(k)?.height })) : null;

  const onPointerDown = (e: RPointerEvent) => {
    if (e.button === 1 || space.current) {
      e.preventDefault();
      pan.current = { x: e.clientX, y: e.clientY, sl: wrap.current!.scrollLeft, st: wrap.current!.scrollTop };
      (e.target as Element).setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: RPointerEvent) => {
    if (!pan.current || !wrap.current) return;
    wrap.current.scrollLeft = pan.current.sl - (e.clientX - pan.current.x);
    wrap.current.scrollTop = pan.current.st - (e.clientY - pan.current.y);
  };

  return (
    <div ref={wrap} className="scroll-thin relative h-full w-full overflow-auto bg-app" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => (pan.current = null)} onClick={() => onSelect(undefined)}>
      <div className="flex min-h-full min-w-full items-center justify-center" style={{ padding: PAD, width: 'max-content' }}>
        <div className="checker relative shadow-[0_0_0_1px_var(--c-line-strong),0_12px_40px_rgba(0,0,0,0.35)]" style={{ width: scene.width * zoom, height: scene.height * zoom }}>
          <svg width={scene.width * zoom} height={scene.height * zoom} viewBox={`0 0 ${scene.width} ${scene.height}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Reconstructed design" data-testid="design-canvas">
            <defs>{defs}</defs>
            {content}
            {box && (
              <rect x={box.x} y={box.y} width={Math.max(box.w, 0.5)} height={Math.max(box.h, 0.5)} fill="none" stroke="var(--c-accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            )}
          </svg>
          {sel && droppedIds.has(sel.id) && box && (
            <div className="pointer-events-none absolute rounded bg-err px-1.5 py-0.5 text-[10px] font-medium text-white" style={{ left: box.x * zoom, top: Math.max(0, box.y * zoom - 20) }}>Not exported</div>
          )}
        </div>
      </div>
    </div>
  );
}

function findNode(nodes: DesignNode[], id: string): DesignNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.kind === 'group') {
      const hit = findNode(n.children, id);
      if (hit) return hit;
    }
  }
  return undefined;
}
