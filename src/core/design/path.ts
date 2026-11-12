/**
 * SVG path parsing and normalisation. All paths are reduced to absolute M, L, C and Z commands
 * (quadratics are raised to cubics; arcs are converted to cubic Béziers), which every target can represent.
 */
import { apply, type Matrix } from './matrix';

export type Seg = { c: 'M' | 'L'; x: number; y: number } | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number } | { c: 'Z' };

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

function tokenize(d: string): Array<string | number> | null {
  const out: Array<string | number> = [];
  const re = /\s*(?:([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?))\s*,?/y;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(d))) {
    last = re.lastIndex;
    out.push(m[1] ?? parseFloat(m[2]));
    if (re.lastIndex >= d.length) break;
  }
  if (d.slice(last).trim()) return null;
  return out;
}

function arcToCubics(x1: number, y1: number, rx: number, ry: number, phiDeg: number, fa: number, fs: number, x2: number, y2: number): Seg[] {
  if (rx === 0 || ry === 0) return [{ c: 'L', x: x2, y: y2 }];
  if (x1 === x2 && y1 === y2) return [];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (fa === fs) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let delta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && delta > 0) delta -= 2 * Math.PI;
  if (fs && delta < 0) delta += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / n;
  const t = (4 / 3) * Math.tan(step / 4);
  const out: Seg[] = [];
  let a1 = theta1;
  const pt = (a: number): [number, number] => [cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos];
  const deriv = (a: number): [number, number] => [-rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos];
  for (let k = 0; k < n; k++) {
    const a2 = a1 + step;
    const [p1x, p1y] = pt(a1);
    const [p2x, p2y] = pt(a2);
    const [d1x, d1y] = deriv(a1);
    const [d2x, d2y] = deriv(a2);
    out.push({ c: 'C', x1: p1x + t * d1x, y1: p1y + t * d1y, x2: p2x - t * d2x, y2: p2y - t * d2y, x: p2x, y: p2y });
    a1 = a2;
  }
  const last = out[out.length - 1];
  if (last && last.c === 'C') { last.x = x2; last.y = y2; }
  return out;
}

/** Parses SVG path data into normalised absolute segments. Returns null if the data is malformed. */
export function parsePath(d: string): Seg[] | null {
  const tokens = tokenize(d);
  if (!tokens) return null;
  const segs: Seg[] = [];
  let i = 0;
  let cmd = '';
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCtrl: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;
  let prevCmd = '';
  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') cmd = tokens[i++] as string;
    else if (!cmd) return null;
    const lower = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    const need = ARGS[lower];
    if (lower === 'z') {
      segs.push({ c: 'Z' });
      cx = sx; cy = sy;
      lastCtrl = lastQuad = null;
      prevCmd = 'z';
      cmd = '';
      continue;
    }
    const args: number[] = [];
    for (let k = 0; k < need; k++) {
      const v = tokens[i++];
      if (typeof v !== 'number') return null;
      args.push(v);
    }
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    switch (lower) {
      case 'm':
        cx = args[0] + ox; cy = args[1] + oy; sx = cx; sy = cy;
        segs.push({ c: 'M', x: cx, y: cy });
        cmd = rel ? 'l' : 'L';
        lastCtrl = lastQuad = null;
        break;
      case 'l':
        cx = args[0] + ox; cy = args[1] + oy;
        segs.push({ c: 'L', x: cx, y: cy });
        lastCtrl = lastQuad = null;
        break;
      case 'h':
        cx = args[0] + (rel ? cx : 0);
        segs.push({ c: 'L', x: cx, y: cy });
        lastCtrl = lastQuad = null;
        break;
      case 'v':
        cy = args[0] + (rel ? cy : 0);
        segs.push({ c: 'L', x: cx, y: cy });
        lastCtrl = lastQuad = null;
        break;
      case 'c': {
        const s: Seg = { c: 'C', x1: args[0] + ox, y1: args[1] + oy, x2: args[2] + ox, y2: args[3] + oy, x: args[4] + ox, y: args[5] + oy };
        segs.push(s);
        lastCtrl = [s.x2, s.y2]; lastQuad = null;
        cx = s.x; cy = s.y;
        break;
      }
      case 's': {
        let rx1: number = cx;
        let ry1: number = cy;
        if (lastCtrl && (prevCmd === 'c' || prevCmd === 's')) { rx1 = 2 * cx - lastCtrl[0]; ry1 = 2 * cy - lastCtrl[1]; }
        const s: Seg = { c: 'C', x1: rx1, y1: ry1, x2: args[0] + ox, y2: args[1] + oy, x: args[2] + ox, y: args[3] + oy };
        segs.push(s);
        lastCtrl = [s.x2, s.y2]; lastQuad = null;
        cx = s.x; cy = s.y;
        break;
      }
      case 'q':
      case 't': {
        let qx: number, qy: number, x: number, y: number;
        if (lower === 'q') { qx = args[0] + ox; qy = args[1] + oy; x = args[2] + ox; y = args[3] + oy; }
        else {
          [qx, qy] = lastQuad && (prevCmd === 'q' || prevCmd === 't') ? [2 * cx - lastQuad[0], 2 * cy - lastQuad[1]] : [cx, cy];
          x = args[0] + ox; y = args[1] + oy;
        }
        segs.push({ c: 'C', x1: cx + (2 / 3) * (qx - cx), y1: cy + (2 / 3) * (qy - cy), x2: x + (2 / 3) * (qx - x), y2: y + (2 / 3) * (qy - y), x, y });
        lastQuad = [qx, qy]; lastCtrl = null;
        cx = x; cy = y;
        break;
      }
      case 'a': {
        const x = args[5] + ox;
        const y = args[6] + oy;
        segs.push(...arcToCubics(cx, cy, args[0], args[1], args[2], args[3] ? 1 : 0, args[4] ? 1 : 0, x, y));
        cx = x; cy = y;
        lastCtrl = lastQuad = null;
        break;
      }
    }
    prevCmd = lower;
  }
  if (segs.length && segs[0].c !== 'M') return null;
  return segs;
}

export function transformSegs(segs: Seg[], m: Matrix): Seg[] {
  return segs.map((s) => {
    if (s.c === 'Z') return s;
    if (s.c === 'C') {
      const [x1, y1] = apply(m, s.x1, s.y1);
      const [x2, y2] = apply(m, s.x2, s.y2);
      const [x, y] = apply(m, s.x, s.y);
      return { c: 'C', x1, y1, x2, y2, x, y };
    }
    const [x, y] = apply(m, s.x, s.y);
    return { c: s.c, x, y };
  });
}

export function segBounds(segs: Seg[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  let px = 0, py = 0;
  for (const s of segs) {
    if (s.c === 'Z') continue;
    if (s.c === 'C') {
      // Sample the curve for a tight-enough box (control points over-estimate).
      for (let t = 0.125; t < 1; t += 0.125) {
        const u = 1 - t;
        add(u * u * u * px + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * s.x, u * u * u * py + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * s.y);
      }
    }
    add(s.x, s.y);
    px = s.x; py = s.y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

const fmt = (n: number) => {
  const v = Math.round(n * 1000) / 1000;
  return Object.is(v, -0) ? '0' : String(v);
};

export function segsToD(segs: Seg[]): string {
  return segs
    .map((s) => (s.c === 'Z' ? 'Z' : s.c === 'C' ? `C${fmt(s.x1)},${fmt(s.y1)} ${fmt(s.x2)},${fmt(s.y2)} ${fmt(s.x)},${fmt(s.y)}` : `${s.c}${fmt(s.x)},${fmt(s.y)}`))
    .join(' ');
}

const K = 0.5522847498307936; // 4/3·(√2−1): cubic approximation of a quarter circle

export function ellipseSegs(cx: number, cy: number, rx: number, ry: number): Seg[] {
  return [
    { c: 'M', x: cx + rx, y: cy },
    { c: 'C', x1: cx + rx, y1: cy + K * ry, x2: cx + K * rx, y2: cy + ry, x: cx, y: cy + ry },
    { c: 'C', x1: cx - K * rx, y1: cy + ry, x2: cx - rx, y2: cy + K * ry, x: cx - rx, y: cy },
    { c: 'C', x1: cx - rx, y1: cy - K * ry, x2: cx - K * rx, y2: cy - ry, x: cx, y: cy - ry },
    { c: 'C', x1: cx + K * rx, y1: cy - ry, x2: cx + rx, y2: cy - K * ry, x: cx + rx, y: cy },
    { c: 'Z' },
  ];
}

export function rectSegs(x: number, y: number, w: number, h: number, rx = 0, ry = 0): Seg[] {
  rx = Math.min(Math.abs(rx), w / 2);
  ry = Math.min(Math.abs(ry), h / 2);
  if (!rx || !ry) return [{ c: 'M', x, y }, { c: 'L', x: x + w, y }, { c: 'L', x: x + w, y: y + h }, { c: 'L', x, y: y + h }, { c: 'Z' }];
  const kx = K * rx, ky = K * ry;
  return [
    { c: 'M', x: x + rx, y },
    { c: 'L', x: x + w - rx, y },
    { c: 'C', x1: x + w - rx + kx, y1: y, x2: x + w, y2: y + ry - ky, x: x + w, y: y + ry },
    { c: 'L', x: x + w, y: y + h - ry },
    { c: 'C', x1: x + w, y1: y + h - ry + ky, x2: x + w - rx + kx, y2: y + h, x: x + w - rx, y: y + h },
    { c: 'L', x: x + rx, y: y + h },
    { c: 'C', x1: x + rx - kx, y1: y + h, x2: x, y2: y + h - ry + ky, x, y: y + h - ry },
    { c: 'L', x, y: y + ry },
    { c: 'C', x1: x, y1: y + ry - ky, x2: x + rx - kx, y2: y, x: x + rx, y },
    { c: 'Z' },
  ];
}

export function polySegs(points: number[], close: boolean): Seg[] {
  const segs: Seg[] = [];
  for (let k = 0; k + 1 < points.length; k += 2) segs.push({ c: k === 0 ? 'M' : 'L', x: points[k], y: points[k + 1] });
  if (close && segs.length) segs.push({ c: 'Z' });
  return segs;
}
