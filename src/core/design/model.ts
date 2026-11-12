/** Format-independent design model that the canvas preview and every exporter read from. */
import type { RGBA } from './color';
import type { Matrix } from './matrix';

export interface GradientStop {
  offset: number;
  color: RGBA;
}

export type Paint =
  | { type: 'none' }
  | { type: 'solid'; color: RGBA }
  | {
      type: 'linear';
      x1: number; y1: number; x2: number; y2: number;
      units: 'objectBoundingBox' | 'userSpaceOnUse';
      transform: Matrix;
      stops: GradientStop[];
      sourceId: string;
    }
  | {
      type: 'radial';
      cx: number; cy: number; r: number; fx: number; fy: number;
      units: 'objectBoundingBox' | 'userSpaceOnUse';
      transform: Matrix;
      stops: GradientStop[];
      sourceId: string;
    };

export interface SourceRef {
  line: number;
  col: number;
  elementPath: string;
  elementName: string;
  id?: string;
}

export interface Keyframe {
  /** Milliseconds from the start of the scene. */
  t: number;
  v: number[];
}

export interface Animation {
  property: 'opacity' | 'translate' | 'rotate' | 'scale';
  keyframes: Keyframe[];
  /** Rotation centre for 'rotate', in the node's local coordinates. */
  center?: [number, number];
  source: SourceRef;
}

interface NodeBase {
  id: string;
  name: string;
  /** Local → canvas matrix (all ancestor transforms applied). */
  matrix: Matrix;
  opacity: number;
  source: SourceRef;
  animations: Animation[];
}

export interface Stroke {
  paint: Paint;
  width: number;
}

export interface RectNode extends NodeBase { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number; ry: number; fill: Paint; stroke?: Stroke }
export interface EllipseNode extends NodeBase { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: Paint; stroke?: Stroke }
export interface PathNode extends NodeBase { kind: 'path'; d: string; fill: Paint; fillRule: 'nonzero' | 'evenodd'; stroke?: Stroke; shapeTag: string }
export interface ImageNode extends NodeBase { kind: 'image'; x: number; y: number; width: number; height: number; assetKey: string; href: string; preserveAspectRatio: string }
export interface TextNode extends NodeBase {
  kind: 'text';
  x: number;
  y: number;
  lines: string[];
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  anchor: 'start' | 'middle' | 'end';
  fill: Paint;
}
export interface GroupNode extends NodeBase { kind: 'group'; children: DesignNode[] }

export type DesignNode = RectNode | EllipseNode | PathNode | ImageNode | TextNode | GroupNode;

export interface DesignIssue {
  level: 'info' | 'warning';
  message: string;
  source?: SourceRef;
}

export interface DesignScene {
  width: number;
  height: number;
  /** Duration implied by animations (ms); 0 when static. */
  durationMs: number;
  nodes: DesignNode[];
  issues: DesignIssue[];
  sourceFormat: string;
}

export function* walkNodes(nodes: DesignNode[]): Generator<DesignNode> {
  for (const n of nodes) {
    yield n;
    if (n.kind === 'group') yield* walkNodes(n.children);
  }
}

export function findNode(nodes: DesignNode[], id: string): DesignNode | undefined {
  for (const n of walkNodes(nodes)) if (n.id === id) return n;
  return undefined;
}
