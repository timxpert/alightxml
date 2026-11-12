/** 2D affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (SVG convention). */
export type Matrix = [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
export const scale = (x: number, y = x): Matrix => [x, 0, 0, y, 0, 0];
export function rotate(deg: number, cx = 0, cy = 0): Matrix {
  const r = (deg * Math.PI) / 180;
  const m: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
  return cx || cy ? multiply(multiply(translate(cx, cy), m), translate(-cx, -cy)) : m;
}
export const skewX = (deg: number): Matrix => [1, 0, Math.tan((deg * Math.PI) / 180), 1, 0, 0];
export const skewY = (deg: number): Matrix => [1, Math.tan((deg * Math.PI) / 180), 0, 1, 0, 0];

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Parses an SVG transform list. Returns null on malformed input. */
export function parseTransform(s: string | undefined): Matrix | null {
  if (!s || !s.trim()) return IDENTITY;
  let m: Matrix = IDENTITY;
  const re = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/gy;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(s))) {
    consumed = re.lastIndex;
    const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (args.some((v) => !Number.isFinite(v))) return null;
    let t: Matrix;
    switch (match[1]) {
      case 'matrix':
        if (args.length !== 6) return null;
        t = args as Matrix;
        break;
      case 'translate':
        t = translate(args[0] ?? 0, args[1] ?? 0);
        break;
      case 'scale':
        t = scale(args[0] ?? 1, args[1] ?? args[0] ?? 1);
        break;
      case 'rotate':
        t = rotate(args[0] ?? 0, args[1] ?? 0, args[2] ?? 0);
        break;
      case 'skewX':
        t = skewX(args[0] ?? 0);
        break;
      default:
        t = skewY(args[0] ?? 0);
    }
    m = multiply(m, t);
  }
  if (s.slice(consumed).trim()) return null;
  return m;
}

export interface Decomposed {
  tx: number;
  ty: number;
  scaleX: number;
  scaleY: number;
  /** Degrees, clockwise in screen coordinates (y down). */
  rotation: number;
  /** Shear factor; 0 when the matrix is a pure translate/rotate/scale. */
  skew: number;
}

export function decompose(m: Matrix): Decomposed {
  const [a, b, c, d, e, f] = m;
  const sx = Math.hypot(a, b);
  if (sx === 0) return { tx: e, ty: f, scaleX: 0, scaleY: 0, rotation: 0, skew: 0 };
  const a1 = a / sx;
  const b1 = b / sx;
  let shear = a1 * c + b1 * d;
  const c2 = c - a1 * shear;
  const d2 = d - b1 * shear;
  let sy = Math.hypot(c2, d2);
  if (a * d - b * c < 0) sy = -sy;
  shear = sy !== 0 ? shear / sy : 0;
  return { tx: e, ty: f, scaleX: sx, scaleY: sy, rotation: (Math.atan2(b, a) * 180) / Math.PI, skew: shear };
}

export const hasSkew = (m: Matrix) => Math.abs(decompose(m).skew) > 1e-6;
export const toCssMatrix = (m: Matrix) => `matrix(${m.map((v) => +v.toFixed(6)).join(' ')})`;
