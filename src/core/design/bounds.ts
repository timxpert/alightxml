import { apply } from './matrix';
import type { DesignNode } from './model';
import { ellipseSegs, parsePath, segBounds, transformSegs } from './path';

export interface Box { x: number; y: number; w: number; h: number }

/** Canvas-space bounding box of a node (text is estimated from font metrics). */
export function nodeBounds(node: DesignNode, intrinsic?: (key: string) => { w?: number; h?: number } | undefined): Box | null {
  const box = (pts: Array<[number, number]>): Box => {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  const corners = (x: number, y: number, w: number, h: number) => box([apply(node.matrix, x, y), apply(node.matrix, x + w, y), apply(node.matrix, x, y + h), apply(node.matrix, x + w, y + h)]);
  switch (node.kind) {
    case 'rect':
      return corners(node.x, node.y, node.width, node.height);
    case 'image': {
      const dims = intrinsic?.(node.assetKey);
      return corners(node.x, node.y, node.width || dims?.w || 0, node.height || dims?.h || 0);
    }
    case 'ellipse': {
      const b = segBounds(transformSegs(ellipseSegs(node.cx, node.cy, node.rx, node.ry), node.matrix));
      return b && { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
    }
    case 'path': {
      const segs = parsePath(node.d);
      const b = segs && segBounds(transformSegs(segs, node.matrix));
      return b && { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
    }
    case 'text': {
      const w = Math.max(...node.lines.map((l) => l.length)) * node.fontSize * 0.55;
      const h = node.lines.length * node.fontSize * 1.2;
      const x0 = node.anchor === 'middle' ? node.x - w / 2 : node.anchor === 'end' ? node.x - w : node.x;
      return corners(x0, node.y - node.fontSize * 0.85, w, h);
    }
    case 'group': {
      const boxes = node.children.map((c) => nodeBounds(c, intrinsic)).filter((b): b is Box => !!b);
      if (!boxes.length) return null;
      const x = Math.min(...boxes.map((b) => b.x));
      const y = Math.min(...boxes.map((b) => b.y));
      return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
    }
  }
}
