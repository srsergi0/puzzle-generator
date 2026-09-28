import { planGrid } from "./grid.ts";

export type Point = readonly [number, number];
export type Seg =
  | { t: "L"; p: Point }
  | { t: "C"; c1: Point; c2: Point; p: Point };

export type Rng = () => number;

/** PRNG determinista: la misma semilla da siempre el mismo puzzle. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const num = (v: number): string => String(round2(v));
const pt = (p: Point): string => `${num(p[0])} ${num(p[1])}`;

/** Paso (mm) de muestreo del borde cuando la lámina se deforma al final. */
const BORDER_STEP = 3.5;

/** Tramo de path: un punto inicial más segmentos L/C. */
export class SubPath {
  constructor(
    public readonly start: Point,
    public readonly segs: Seg[],
  ) {}

  static of(start: Point): SubPath {
    return new SubPath(start, []);
  }

  get end(): Point {
    const last = this.segs.at(-1);
    if (!last) return this.start;
    return last.p;
  }

  reversed(): SubPath {
    if (this.segs.length === 0) return new SubPath(this.start, []);
    const starts: Point[] = [this.start];
    for (let i = 0; i < this.segs.length - 1; i++) starts.push(this.segs[i]!.p);
    const segs: Seg[] = [];
    for (let i = this.segs.length - 1; i >= 0; i--) {
      const seg = this.segs[i]!;
      const p = starts[i]!;
      segs.push(seg.t === "L" ? { t: "L", p } : { t: "C", c1: seg.c2, c2: seg.c1, p });
    }
    return new SubPath(this.end, segs);
  }

  toD(): string {
    const parts = [`M ${pt(this.start)}`];
    for (const seg of this.segs) {
      if (seg.t === "L") parts.push(`L ${pt(seg.p)}`);
      else parts.push(`C ${pt(seg.c1)} ${pt(seg.c2)} ${pt(seg.p)}`);
    }
    return parts.join(" ");
  }
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Catmull-Rom -> cúbicas, para que la pestaña salga redonda. */
export function smooth(points: Point[]): Seg[] {
  const n = points.length;
  if (n < 2) return [];
  const segs: Seg[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(i + 2, n - 1)]!;
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    segs.push({ t: "C", c1, c2, p: p2 });
  }
  return segs;
}

export type Warp = (p: Point) => Point;

/**
 * Campo de desplazamiento global (turbulencia suave): un par de ondas
 * senoidales continuas sobre toda la lámina. Al depender solo de (x, y), dos
 * bordes que comparten un punto reciben el mismo desplazamiento y las piezas
 * siguen encajando perfectamente. El envelope apaga la ondulación en el borde
 * para que el rectángulo exterior y el tamaño de impresión queden intactos.
 */
function makeWarp(
  amount: number,
  width: number,
  height: number,
  cellW: number,
  cellH: number,
  cols: number,
  rows: number,
  rng: Rng,
): Warp {
  // Amplitud hasta ~1/3 de celda: se nota el flujo pero no hay plegados.
  const amp = amount * 0.32 * Math.min(cellW, cellH);
  const marginX = 0.06 * width;
  const marginY = 0.06 * height;
  // Longitud de onda ~ 3 celdas -> el flujo se lee a escala de pieza.
  const fx = Math.max(0.6, cols / 3.2) * (0.85 + rng() * 0.3);
  const fy = Math.max(0.6, rows / 3.2) * (0.85 + rng() * 0.3);
  const ph1 = rng() * Math.PI * 2;
  const ph2 = rng() * Math.PI * 2;

  const step = (t: number): number => {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
  };
  const env = (x: number, y: number): number =>
    step(Math.min(x, width - x) / marginX) * step(Math.min(y, height - y) / marginY);

  return (p: Point): Point => {
    const e = env(p[0], p[1]);
    if (e <= 0) return p;
    const u = p[0] / width;
    const v = p[1] / height;
    const dx =
      (Math.sin(2 * Math.PI * (fx * u + 0.35 * v) + ph1) +
        0.5 * Math.sin(2 * Math.PI * (0.6 * fx * u - fy * v) + ph2)) /
      1.5;
    const dy =
      (Math.sin(2 * Math.PI * (fy * v + 0.35 * u) + ph2) +
        0.5 * Math.sin(2 * Math.PI * (fx * u - 0.6 * fy * v) + ph1)) /
      1.5;
    return [
      Math.max(0, Math.min(width, p[0] + amp * e * dx)),
      Math.max(0, Math.min(height, p[1] + amp * e * dy)),
    ];
  };
}

export interface EdgeContext {
  rng: Rng;
  tabRate: number;
  warp: Warp | null;
  sheetW: number;
  sheetH: number;
  /** Profundidad dentro de la forma (distancia al borde). Negativa = fuera. */
  depth?: (p: Point) => number;
}

/** Distancia con signo al borde de un polígono convexo (positiva = dentro). */
function convexDepth(p: Point, poly: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const cross = (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / len;
    if (cross < best) best = cross;
  }
  return best;
}

/** Recorta anclas y puntos de control a la lámina (una Bézier nunca sale de
 * su envolvente, así la curva tampoco se sale del rectángulo). */
function clampSubPath(path: SubPath, width: number, height: number): SubPath {
  const cl = (p: Point): Point => [
    Math.max(0, Math.min(width, p[0])),
    Math.max(0, Math.min(height, p[1])),
  ];
  const segs = path.segs.map((s): Seg =>
    s.t === "L" ? { t: "L", p: cl(s.p) } : { t: "C", c1: cl(s.c1), c2: cl(s.c2), p: cl(s.p) },
  );
  return new SubPath(cl(path.start), segs);
}

/**
 * Borde canónico p0 -> p1 con (quizá) una pestaña hacia normal*sign.
 * `perp` es el lado de la celda perpendicular al borde: topa la altura de la
 * pestaña para que nunca invada la pieza vecina.
 * Con `ctx.warp` primero se ondula la línea base (campo global) y luego se
 * monta la pestaña sobre su normal local, así queda nítida y las dos piezas
 * vecinas comparten exactamente la misma curva.
 */
function edge(
  p0: Point,
  p1: Point,
  normal: Point,
  sign: number,
  perp: number,
  ctx: EdgeContext,
): SubPath {
  const { rng, tabRate, warp } = ctx;
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const length = Math.hypot(dx, dy);
  if (length <= 0) return SubPath.of(p0);

  const ux = dx / length;
  const uy = dy / length;

  // Pestañas al borde de la forma: solo se crean si la cabeza queda con un
  // margen dentro (si no, ese lado iría muy finito y se rompería). Si el
  // sentido original no cabe, se intenta el contrario; si tampoco, va recto.
  let dir = sign;
  const keepTab = (head: number, tall: number): boolean => {
    const depth = ctx.depth;
    if (!depth) return true;
    const map = ctx.warp ?? ((p: Point): Point => p);
    const cx = (p0[0] + p1[0]) / 2;
    const cy = (p0[1] + p1[1]) / 2;
    const clearance = (s: number): number => {
      const nx = normal[0] * s;
      const ny = normal[1] * s;
      return Math.min(
        depth(map([cx + nx * 1.06 * tall, cy + ny * 1.06 * tall])),
        depth(map([cx + ux * head * 0.6 + nx * 0.95 * tall, cy + uy * head * 0.6 + ny * 0.95 * tall])),
        depth(map([cx - ux * head * 0.6 + nx * 0.95 * tall, cy - uy * head * 0.6 + ny * 0.95 * tall])),
      );
    };
    const margin = Math.max(0.9 * tall, 0.32 * perp);
    if (clearance(sign) >= margin) return true;
    if (clearance(-sign) >= margin) {
      dir = -sign;
      return true;
    }
    return false;
  };

  // --- sin ondulación: puzzle clásico (idéntico al de siempre) ---
  const classic = (): SubPath => {
    if (rng() > tabRate) return new SubPath(p0, [{ t: "L", p: p1 }]);
    // Proporciones tipo puzzle clásico: cuello estrecho y cabeza bulbosa que se
    // ensancha (undercut), topada por el lado perpendicular de la celda.
    const head = Math.min(0.16 * length * lerp(0.95, 1.05, rng()), 0.28 * perp);
    const tall = Math.min(0.26 * length * lerp(0.92, 1.08, rng()), 0.36 * perp);
    if (head <= 1e-6 || tall <= 1e-6) return new SubPath(p0, [{ t: "L", p: p1 }]);
    if (!keepTab(head, tall)) return new SubPath(p0, [{ t: "L", p: p1 }]);
    const neck = 0.55 * head;
    const toWorld = (uv: number, vv: number): Point => {
      const v = vv * dir;
      return [p0[0] + ux * uv + normal[0] * v, p0[1] + uy * uv + normal[1] * v];
    };
    const cx = length / 2;
    const local: [number, number][] = [
      [0, 0],
      [cx - neck * 1.02, 0.06 * tall],
      [cx - neck * 1.06, 0.34 * tall],
      [cx - head * 0.99, 0.66 * tall],
      [cx - head * 0.62, 0.95 * tall],
      [cx, 1.06 * tall],
      [cx + head * 0.62, 0.95 * tall],
      [cx + head * 0.99, 0.66 * tall],
      [cx + neck * 1.06, 0.34 * tall],
      [cx + neck * 1.02, 0.06 * tall],
      [length, 0],
    ];
    const points = local.map(([uv, vv]) => toWorld(uv, vv));
    points[0] = p0;
    points[points.length - 1] = p1;
    return new SubPath(p0, smooth(points));
  };

  if (!warp) return classic();

  // --- con ondulación global ---
  // 1) línea base ondulada: el campo es global, así que las dos piezas vecinas
  //    obtienen exactamente la misma curva.
  const N = 20;
  const base: Point[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    base.push(warp([p0[0] + dx * t, p0[1] + dy * t]));
  }
  const cum = [0];
  for (let i = 1; i <= N; i++) {
    cum.push(cum[i - 1]! + Math.hypot(base[i]![0] - base[i - 1]![0], base[i]![1] - base[i - 1]![1]));
  }
  const total = cum[N]! || 1;
  const posAt = (f: number): Point => {
    const target = Math.max(0, Math.min(1, f)) * total;
    let i = 1;
    while (i < N && cum[i]! < target) i++;
    const seg = cum[i]! - cum[i - 1]!;
    const r = seg > 0 ? (target - cum[i - 1]!) / seg : 0;
    const a = base[i - 1]!;
    const b = base[i]!;
    return [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r];
  };
  const eps = 1 / (4 * N);
  // 2) la pestaña se apoya en la normal local de la línea base: queda nítida.
  const at = (u: number, v: number): Point => {
    const f = length > 0 ? u / length : 0;
    const P = posAt(f);
    const a = posAt(f - eps);
    const b = posAt(f + eps);
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    let nx = -ty;
    let ny = tx;
    if (nx * normal[0] + ny * normal[1] < 0) {
      nx = -nx;
      ny = -ny;
    }
    const off = v * dir;
    return [
      Math.max(0, Math.min(ctx.sheetW, P[0] + nx * off)),
      Math.max(0, Math.min(ctx.sheetH, P[1] + ny * off)),
    ];
  };

  if (rng() > tabRate) {
    return clampSubPath(new SubPath(base[0]!, smooth(base)), ctx.sheetW, ctx.sheetH);
  }

  const head = Math.min(0.16 * length * lerp(0.95, 1.05, rng()), 0.28 * perp);
  const tall = Math.min(0.26 * length * lerp(0.92, 1.08, rng()), 0.36 * perp);
  if (head <= 1e-6 || tall <= 1e-6 || !keepTab(head, tall)) {
    return clampSubPath(new SubPath(base[0]!, smooth(base)), ctx.sheetW, ctx.sheetH);
  }

  const neck = 0.55 * head;
  const cx = length / 2;
  const anchors: [number, number][] = [];
  const fill = (from: number, to: number): void => {
    const count = Math.max(1, Math.round((to - from) / (0.09 * length)));
    for (let i = 1; i <= count; i++) {
      anchors.push([from + ((to - from) * i) / (count + 1), 0]);
    }
  };
  fill(0, cx - neck * 1.02);
  anchors.push(
    [cx - neck * 1.02, 0.06 * tall],
    [cx - neck * 1.06, 0.34 * tall],
    [cx - head * 0.99, 0.66 * tall],
    [cx - head * 0.62, 0.95 * tall],
    [cx, 1.06 * tall],
    [cx + head * 0.62, 0.95 * tall],
    [cx + head * 0.99, 0.66 * tall],
    [cx + neck * 1.06, 0.34 * tall],
    [cx + neck * 1.02, 0.06 * tall],
  );
  fill(cx + neck * 1.02, length);
  const pts = anchors.map(([u, v]) => at(u, v));
  pts[0] = base[0]!;
  pts[pts.length - 1] = base[N]!;
  return clampSubPath(new SubPath(base[0]!, smooth(pts)), ctx.sheetW, ctx.sheetH);
}

/** Muestrea un path a un polígono denso (para recortar contra una forma). */
export function samplePolygon(path: SubPath, perSeg: number): Point[] {
  const pts: Point[] = [path.start];
  let cur = path.start;
  for (const seg of path.segs) {
    if (seg.t === "L") {
      const [x0, y0] = cur;
      const [x1, y1] = seg.p;
      for (let i = 1; i <= perSeg; i++) {
        const t = i / perSeg;
        pts.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      }
    } else {
      const [x0, y0] = cur;
      const { c1, c2, p } = seg;
      for (let i = 1; i <= perSeg; i++) {
        const t = i / perSeg;
        const mt = 1 - t;
        const a = mt * mt * mt;
        const b = 3 * mt * mt * t;
        const c = 3 * mt * t * t;
        const d = t * t * t;
        pts.push([
          a * x0 + b * c1[0] + c * c2[0] + d * p[0],
          a * y0 + b * c1[1] + c * c2[1] + d * p[1],
        ]);
      }
    }
    cur = seg.p;
  }
  return pts;
}

/** Área con signo (positiva = sentido horario en pantalla, y hacia abajo). */
export function polygonArea(
  poly: Point[],
): number {
  return Math.abs(signedArea(poly));
}

function signedArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

function polygonCentroid(poly: Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const f = p[0] * q[1] - q[0] * p[1];
    area += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(area) < 1e-9) return poly[0]!;
  return [cx / (3 * area), cy / (3 * area)];
}

/** Punto dentro de un polígono convexo en sentido horario. */
function insideConvex(p: Point, poly: Point[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) return false;
  }
  return true;
}

function lineIntersect(p: Point, q: Point, a: Point, b: Point): Point {
  const rx = q[0] - p[0];
  const ry = q[1] - p[1];
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return q;
  const t = ((a[0] - p[0]) * sy - (a[1] - p[1]) * sx) / denom;
  return [p[0] + t * rx, p[1] + t * ry];
}

/** Recorta un polígono contra otro convexo (Sutherland-Hodgman). */
function clipConvex(subject: Point[], clip: Point[]): Point[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const cw = signedArea(clip) >= 0 ? clip : [...clip].reverse();
  let output = subject;
  for (let i = 0; i < cw.length; i++) {
    const a = cw[i]!;
    const b = cw[(i + 1) % cw.length]!;
    const input = output;
    output = [];
    const inside = (p: Point): boolean =>
      (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
    for (let j = 0; j < input.length; j++) {
      const cur = input[j]!;
      const prev = input[(j - 1 + input.length) % input.length]!;
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) output.push(lineIntersect(prev, cur, a, b));
        output.push(cur);
      } else if (prevIn) {
        output.push(lineIntersect(prev, cur, a, b));
      }
    }
    if (output.length === 0) return [];
  }
  return output;
}

/**
 * Recorta una línea ABIERTA contra un polígono convexo y devuelve los tramos
 * que quedan dentro, también abiertos y con el extremo exacto sobre el borde.
 * Nunca se cierra: cerrarla añadiría una recta de corte que con las ondas no
 * coincide con la línea base y se ve como una línea de guía sobre las muescas.
 */
function clipOpenPath(path: SubPath, clip: Point[], perSeg: number): SubPath[] {
  const pts = samplePolygon(path, perSeg);
  if (pts.length < 2) return [];
  const inside = (p: Point): boolean => insideConvex(p, clip);
  /** Punto exacto de cruce, siempre devuelto por el lado de dentro. */
  const crossing = (inP: Point, outP: Point): Point => {
    let lo = outP;
    let hi = inP;
    for (let i = 0; i < 20; i++) {
      const m: Point = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
      if (inside(m)) hi = m;
      else lo = m;
    }
    return hi;
  };
  const runs: Point[][] = [];
  let run: Point[] | null = inside(pts[0]!) ? [pts[0]!] : null;
  let prevIn = run !== null;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    const pin = inside(p);
    if (pin && !prevIn) run = [crossing(p, pts[i - 1]!), p];
    else if (!pin && prevIn && run) {
      run.push(crossing(pts[i - 1]!, p));
      runs.push(run);
      run = null;
    } else if (pin && run) run.push(p);
    prevIn = pin;
  }
  if (run) runs.push(run);
  return runs
    .filter((r) => {
      if (r.length < 2) return false;
      let len = 0;
      for (let i = 1; i < r.length; i++) {
        len += Math.hypot(r[i]![0] - r[i - 1]![0], r[i]![1] - r[i - 1]![1]);
        if (len > 0.8) return true;
      }
      return false;
    })
    .map((r) => new SubPath(r[0]!, r.slice(1).map((q): Seg => ({ t: "L", p: q }))));
}

/** Polígono -> SubPath cerrado (para dibujar la pieza ya recortada). */
function polygonPath(poly: Point[]): SubPath {
  if (poly.length === 0) return SubPath.of([0, 0]);
  const segs: Seg[] = poly.slice(1).map((p): Seg => ({ t: "L", p }));
  segs.push({ t: "L", p: poly[0]! });
  return new SubPath(poly[0]!, segs);
}

/** Perímetro del rectángulo muestreado (sentido horario), para ondularlo. */
function rectBorder(width: number, height: number): Point[] {
  const pts: Point[] = [];
  const side = (ax: number, ay: number, bx: number, by: number): void => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / BORDER_STEP));
    for (let i = 0; i < n; i++) {
      pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
    }
  };
  side(0, 0, width, 0);
  side(width, 0, width, height);
  side(width, height, 0, height);
  side(0, height, 0, 0);
  return pts;
}

/** ¿La caja del polígono cae entera dentro del recorte? (atajo sin recortar) */
function bboxInside(poly: Point[], clip: Point[], margin: number): boolean {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return (
    insideConvex([x0 - margin, y0 - margin], clip) &&
    insideConvex([x1 + margin, y0 - margin], clip) &&
    insideConvex([x1 + margin, y1 + margin], clip) &&
    insideConvex([x0 - margin, y1 + margin], clip)
  );
}

export interface Shape {
  id: string;
  label: string;
  /** Fracción del rectángulo que cubre la forma (para calcular la cuadrícula). */
  coverage(width: number, height: number): number;
  /** Polígono convexo de recorte, en mm y en sentido horario. */
  clip(width: number, height: number): Point[];
  /**
   * Deformación final (opcional): se aplica a todos los puntos del puzzle
   * después de construirlo, una sola vez por punto. Permite contornos no
   * convexos (p. ej. la lámina "orgánica") sin tocar el recorte convexo:
   * la geometría se calcula dentro del rectángulo y solo al final se ondula.
   * Debe ser un homeomorfismo suave para que las piezas sigan encajando.
   */
  postWarp?(width: number, height: number, seed: number): ((p: Point) => Point) | undefined;
}

const CIRCLE_STEPS = 72;

export const SHAPES: Record<string, Shape> = {
  rect: {
    id: "rect",
    label: "Rectángulo",
    coverage: () => 1,
    clip: (width, height) => [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ],
  },
  circle: {
    id: "circle",
    label: "Círculo",
    coverage: () => Math.PI / 4,
    clip: (width, height) => {
      const r = Math.min(width, height) / 2;
      const cx = width / 2;
      const cy = height / 2;
      return Array.from({ length: CIRCLE_STEPS }, (_, i) => {
        const a = (i / CIRCLE_STEPS) * Math.PI * 2;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Point;
      });
    },
  },
};

/** Permite añadir formas nuevas (p. ej. cargadas de un SVG) sin tocar el core. */
export function registerShape(shape: Shape): void {
  SHAPES[shape.id] = shape;
}

export function getShape(id: string | undefined): Shape {
  return (id && SHAPES[id]) || SHAPES.rect!;
}

/**
 * Estilo de corte: cómo se dibuja el borde entre dos celdas. El path que
 * devuelve lo comparten las dos piezas vecinas, así que encajan siempre.
 */
export interface CutStyle {
  id: string;
  label: string;
  edge(p0: Point, p1: Point, normal: Point, sign: number, perp: number, ctx: EdgeContext): SubPath;
}

export const CUT_STYLES: Record<string, CutStyle> = {};

/** Permite añadir estilos de corte (p. ej. el serpiente) sin tocar el core. */
export function registerCutStyle(style: CutStyle): void {
  CUT_STYLES[style.id] = style;
}

export function getCutStyle(id: string | undefined): CutStyle | undefined {
  return id ? CUT_STYLES[id] : undefined;
}

export interface Piece {
  index: number;
  row: number;
  col: number;
  path: SubPath;
  center: Point;
}
export interface Puzzle {
  widthCm: number;
  heightCm: number;
  rows: number;
  cols: number;
  seed: number;
  pieces: Piece[];
  /** Líneas de corte, cada tramo una sola vez (apto para corte por láser). */
  cuts: SubPath[];
  /** Piezas por debajo del área mínima que no se pudieron fusionar. */
  dropped: number;
}

export interface GenerateOptions {
  seed?: number;
  tabRate?: number;
  wave?: number;
  shape?: string;
  style?: string;
  minArea?: number;
  maxArea?: number;
}

/** Construye el puzzle: una pestaña/ranura aleatoria por borde interno. */
export function generate(
  widthCm: number,
  heightCm: number,
  rows: number,
  cols: number,
  opts: GenerateOptions = {},
): Puzzle {
  if (rows < 1 || cols < 1) throw new Error("rows y cols deben ser >= 1");
  const seed = opts.seed === undefined ? Math.floor(Math.random() * 1e9) : Math.trunc(opts.seed);
  const tabRate = opts.tabRate ?? 0.88;
  const wave = Math.max(0, Math.min(1, opts.wave ?? 0));
  const rng = mulberry32(seed);

  const width = widthCm * 10; // milímetros, para que el SVG imprima a escala
  const height = heightCm * 10;
  const xs = Array.from({ length: cols + 1 }, (_, i) => (i * width) / cols);
  const ys = Array.from({ length: rows + 1 }, (_, i) => (i * height) / rows);
  const cellW = width / cols;
  const cellH = height / rows;

  const warp =
    wave > 1e-6 ? makeWarp(wave, width, height, cellW, cellH, cols, rows, rng) : null;

  const W = (p: Point): Point => (warp ? warp(p) : p);

  const shape = getShape(opts.shape);
  const minArea = Math.max(0, Math.min(1, opts.minArea ?? 0.75));
  const maxArea = Math.max(minArea, opts.maxArea ?? 4);
  const cellArea = cellW * cellH;
  const cellCount = rows * cols;
  const clip = shape.id === "rect" ? null : shape.clip(width, height);
  const depth = clip ? (p: Point): number => convexDepth(p, clip) : undefined;
  const postWarp = shape.postWarp?.(width, height, seed);

  const ctx: EdgeContext = { rng, tabRate, warp, sheetW: width, sheetH: height, depth };
  const style = getCutStyle(opts.style);
  const buildEdge = (
    a: Point,
    b: Point,
    n: Point,
    s: number,
    p: number,
  ): SubPath => (style ? style.edge(a, b, n, s, p, ctx) : edge(a, b, n, s, p, ctx));
  const hKey = (r: number, c: number): string => `${r},${c}`;
  const hedges = new Map<string, SubPath>();
  for (let r = 1; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sign = rng() < 0.5 ? 1 : -1;
      hedges.set(
        hKey(r, c),
        buildEdge([xs[c]!, ys[r]!], [xs[c + 1]!, ys[r]!], [0, 1], sign, cellH),
      );
    }
  }

  const vedges = new Map<string, SubPath>();
  for (let c = 1; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const sign = rng() < 0.5 ? 1 : -1;
      vedges.set(
        hKey(r, c),
        buildEdge([xs[c]!, ys[r]!], [xs[c]!, ys[r + 1]!], [1, 0], sign, cellW),
      );
    }
  }

  // Borde de la lámina. Si la forma se deforma al final (postWarp), el borde
  // se muestrea denso para que, tras ondularse, siga la curva del contorno.
  const dense = (a: Point, b: Point): Seg[] => {
    if (!postWarp) return [{ t: "L", p: b }];
    const n = Math.max(
      1,
      Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / BORDER_STEP),
    );
    const segs: Seg[] = [];
    for (let i = 1; i <= n; i++) {
      segs.push({ t: "L", p: [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] });
    }
    return segs;
  };

  const cornerW = (r: number, c: number): Point => W([xs[c]!, ys[r]!]);
  const hEdge = (r: number, c: number): SubPath => {
    if (r !== 0 && r !== rows) return hedges.get(hKey(r, c))!;
    const a = cornerW(r, c);
    const b = cornerW(r, c + 1);
    return new SubPath(a, dense(a, b));
  };
  const vEdge = (r: number, c: number): SubPath => {
    if (c !== 0 && c !== cols) return vedges.get(hKey(r, c))!;
    const a = cornerW(r, c);
    const b = cornerW(r + 1, c);
    return new SubPath(a, dense(a, b));
  };

  // Contorno de una región: las caras que dan a otra región (o al exterior) se
  // incluyen; las interiores (fusionadas) desaparecen.
  const regionPath = (cells: number[]): SubPath => {
    const members = new Set(cells);
    type Dir = { from: number; to: number; start: Point; segs: Seg[] };
    const edges: Dir[] = [];
    const key = (r: number, c: number): number => r * (cols + 1) + c;
    for (const idx of cells) {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      const has = (rr: number, cc: number): boolean =>
        rr >= 0 && rr < rows && cc >= 0 && cc < cols && members.has(rr * cols + cc);
      if (!has(r - 1, c)) {
        const p = hEdge(r, c);
        edges.push({ from: key(r, c), to: key(r, c + 1), start: p.start, segs: p.segs });
      }
      if (!has(r, c + 1)) {
        const p = vEdge(r, c + 1);
        edges.push({ from: key(r, c + 1), to: key(r + 1, c + 1), start: p.start, segs: p.segs });
      }
      if (!has(r + 1, c)) {
        const p = hEdge(r + 1, c).reversed();
        edges.push({ from: key(r + 1, c + 1), to: key(r + 1, c), start: p.start, segs: p.segs });
      }
      if (!has(r, c - 1)) {
        const p = vEdge(r, c).reversed();
        edges.push({ from: key(r + 1, c), to: key(r, c), start: p.start, segs: p.segs });
      }
    }
    const byFrom = new Map<number, Dir[]>();
    for (const e of edges) {
      const list = byFrom.get(e.from);
      if (list) list.push(e);
      else byFrom.set(e.from, [e]);
    }
    const first = edges[0]!;
    const startKey = first.from;
    const segs: Seg[] = [];
    let cur = first;
    for (let guard = 0; guard <= edges.length; guard++) {
      for (const s of cur.segs) segs.push(s);
      if (cur.to === startKey) break;
      const next = byFrom.get(cur.to)?.pop();
      if (!next) break;
      cur = next;
    }
    return new SubPath(first.start, segs);
  };

  const regionOf = new Int32Array(cellCount).fill(-1);

  if (clip) {
    // Área real de cada celda (su contorno con pestañas) recortada por la
    // forma. Al fusionar, las pestañas/ranuras internas se cancelan, así que
    // la suma de estas áreas es una buena estimación de la región fusionada.
    const measured = new Float64Array(cellCount);
    for (let i = 0; i < cellCount; i++) {
      const poly = samplePolygon(regionPath([i]), 4);
      const clipped = bboxInside(poly, clip, 0.3) ? poly : clipConvex(poly, clip);
      measured[i] = clipped.length < 3 ? 0 : Math.abs(signedArea(clipped));
    }

    const parent = new Int32Array(cellCount);
    const regArea = new Float64Array(cellCount);
    for (let i = 0; i < cellCount; i++) {
      parent[i] = i;
      regArea[i] = measured[i]!;
    }
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]!]!;
        i = parent[i]!;
      }
      return i;
    };
    const mergeInto = (src: number, dst: number): void => {
      const rs = find(src);
      const rd = find(dst);
      if (rs === rd) return;
      parent[rs] = rd;
      regArea[rd] = regArea[rd]! + regArea[rs]!;
    };

    const need = minArea * cellArea;
    const cap = maxArea * cellArea;
    const stuck = new Set<number>();
    for (let iter = 0; iter < cellCount * 2; iter++) {
      let target = -1;
      let targetArea = Infinity;
      for (let i = 0; i < cellCount; i++) {
        if (parent[i] !== i || regArea[i]! <= 0 || stuck.has(i)) continue;
        if (regArea[i]! < need && regArea[i]! < targetArea) {
          target = i;
          targetArea = regArea[i]!;
        }
      }
      if (target < 0) break;
      const r = Math.floor(target / cols);
      const c = target % cols;
      // Preferimos la vecina que deja la fusión por debajo del área máxima;
      // si no hay, la más grande (el mínimo manda).
      let capped = -1;
      let cappedArea = -1;
      let any = -1;
      let anyArea = -1;
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const j = rr * cols + cc;
        const rj = find(j);
        if (rj === find(target) || measured[j]! <= 0) continue;
        if (measured[j]! > anyArea) {
          anyArea = measured[j]!;
          any = j;
        }
        if (regArea[rj]! + regArea[find(target)]! <= cap && measured[j]! > cappedArea) {
          cappedArea = measured[j]!;
          capped = j;
        }
      }
      const dst = capped >= 0 ? capped : any;
      if (dst < 0) {
        stuck.add(find(target));
        continue;
      }
      mergeInto(target, dst);
    }

    // Pasada de verificación con el área real (la estimación de la suma puede
    // desviarse en regiones fusionadas): fusiona lo que siga por debajo.
    const regionPrecise = (cells: number[]): number => {
      const poly = samplePolygon(regionPath(cells), 4);
      const clipped = bboxInside(poly, clip, 0.3) ? poly : clipConvex(poly, clip);
      return clipped.length < 3 ? 0 : Math.abs(signedArea(clipped));
    };
    const dirs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const;
    for (let pass = 0; pass < 6; pass++) {
      const info = new Map<number, { cells: number[]; area: number }>();
      for (let i = 0; i < cellCount; i++) {
        if (measured[i]! <= 0) continue;
        const root = find(i);
        const entry = info.get(root);
        if (entry) entry.cells.push(i);
        else info.set(root, { cells: [i], area: 0 });
      }
      for (const entry of info.values()) entry.area = regionPrecise(entry.cells);

      let worstRoot = -1;
      let worstArea = Infinity;
      for (const [root, entry] of info) {
        if (entry.area < minArea * cellArea && entry.area < worstArea) {
          worstArea = entry.area;
          worstRoot = root;
        }
      }
      if (worstRoot < 0) break;

      const entry = info.get(worstRoot)!;
      let cappedJ = -1;
      let cappedArea = -1;
      let anyJ = -1;
      let anyArea = -1;
      for (const idx of entry.cells) {
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        for (const [dr, dc] of dirs) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
          const j = rr * cols + cc;
          const rj = find(j);
          if (rj === worstRoot || measured[j]! <= 0) continue;
          const other = info.get(rj);
          if (!other) continue;
          if (entry.area + other.area <= cap && other.area > cappedArea) {
            cappedArea = other.area;
            cappedJ = j;
          }
          if (other.area > anyArea) {
            anyArea = other.area;
            anyJ = j;
          }
        }
      }
      const j = cappedJ >= 0 ? cappedJ : anyJ;
      if (j < 0) break;
      mergeInto(worstRoot, j);
    }

    for (let i = 0; i < cellCount; i++) {
      if (measured[i]! > 0) regionOf[i] = find(i);
    }
  } else {
    for (let i = 0; i < cellCount; i++) regionOf[i] = i;
  }

  // Agrupar celdas por región y ordenarlas en orden de lectura.
  const grouped = new Map<number, number[]>();
  for (let i = 0; i < cellCount; i++) {
    const root = regionOf[i]!;
    if (root < 0) continue;
    const list = grouped.get(root);
    if (list) list.push(i);
    else grouped.set(root, [i]);
  }
  const regions = [...grouped.values()].sort((a, b) => (a[0]! as number) - (b[0]! as number));

  // Piezas (relleno) y líneas de corte (cada tramo una sola vez).
  const pieces: Piece[] = [];
  const cutsById = new Map<string, SubPath>();
  let dropped = 0;
  for (const cells of regions) {
    const firstCell = cells[0]!;
    const row = Math.floor(firstCell / cols);
    const col = firstCell % cols;

    // Aristas de corte: solo las que separan dos regiones reales. Las que dan
    // a celdas fuera de la forma no son frontera (el contorno ya las cubre),
    // así que no se dibujan (evita las líneas fantasma).
    const regionAt = (rr: number, cc: number): number =>
      rr >= 0 && rr < rows && cc >= 0 && cc < cols ? regionOf[rr * cols + cc]! : -1;
    const root = regionOf[firstCell]!;
    const cut = (id: string, path: SubPath, nr: number, nc: number, borderOk: boolean): void => {
      if (cutsById.has(id)) return;
      const nReg = regionAt(nr, nc);
      if (nReg < 0) {
        if (borderOk) cutsById.set(id, path);
        return;
      }
      if (nReg !== root) cutsById.set(id, path);
    };
    for (const idx of cells) {
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      cut(`h:${r}:${c}`, hEdge(r, c), r - 1, c, !clip);
      cut(`v:${r}:${c + 1}`, vEdge(r, c + 1), r, c + 1, !clip);
      cut(`h:${r + 1}:${c}`, hEdge(r + 1, c), r + 1, c, !clip);
      cut(`v:${r}:${c}`, vEdge(r, c), r, c - 1, !clip);
    }

    const path = regionPath(cells);
    if (!clip) {
      pieces.push({
        index: pieces.length + 1,
        row,
        col,
        path,
        center: [(xs[col]! + xs[col + 1]!) / 2, (ys[row]! + ys[row + 1]!) / 2],
      });
      continue;
    }
    const poly = samplePolygon(path, 4);
    const clipped = bboxInside(poly, clip, 0.3) ? poly : clipConvex(poly, clip);
    if (clipped.length < 3) continue;
    if (Math.abs(signedArea(clipped)) < minArea * cellArea) {
      dropped++;
      continue;
    }
    pieces.push({
      index: 0,
      row,
      col,
      path: polygonPath(clipped),
      center: polygonCentroid(clipped),
    });
  }
  pieces.forEach((piece, i) => {
    piece.index = i + 1;
  });

  // Recortamos cada línea de corte a la forma y añadimos el contorno (una vez).
  const cuts: SubPath[] = [];
  const seen = new Set<string>();
  const pushCut = (path: SubPath): void => {
    const key = path.toD();
    if (seen.has(key)) return; // evita líneas repetidas tras redondear
    seen.add(key);
    cuts.push(path);
  };
  for (const path of cutsById.values()) {
    if (!clip) {
      pushCut(path);
      continue;
    }
    const poly = samplePolygon(path, 6);
    if (bboxInside(poly, clip, 0.3)) {
      pushCut(path); // entera: se conserva tal cual (con sus curvas)
      continue;
    }
    for (const run of clipOpenPath(path, clip, 6)) pushCut(run);
  }

  // Deformación final (contorno orgánico): se aplica una sola vez por punto y
  // por segmento originales, así las piezas y sus cortes comparten la misma
  // geometría deformada y siguen encajando sin huecos.
  if (postWarp) {
    const pCache = new Map<Point, Point>();
    const sCache = new Map<Seg, Seg>();
    const wp = (p: Point): Point => {
      let q = pCache.get(p);
      if (!q) {
        q = postWarp(p);
        pCache.set(p, q);
      }
      return q;
    };
    const ws = (s: Seg): Seg => {
      let q = sCache.get(s);
      if (!q) {
        q = s.t === "L"
          ? { t: "L", p: wp(s.p) }
          : { t: "C", c1: wp(s.c1), c2: wp(s.c2), p: wp(s.p) };
        sCache.set(s, q);
      }
      return q;
    };
    const wpath = (path: SubPath): SubPath => new SubPath(wp(path.start), path.segs.map(ws));
    for (const piece of pieces) {
      piece.path = wpath(piece.path);
      piece.center = wp(piece.center);
    }
    for (let i = 0; i < cuts.length; i++) cuts[i] = wpath(cuts[i]!);
  }

  if (clip) {
    // Contorno: si la lámina se deforma, se muestrea el rectángulo denso y se
    // ondula con el mismo campo que las piezas (coincide con sus bordes).
    const outline = postWarp
      ? rectBorder(width, height).map((p) => postWarp(p))
      : clip;
    pushCut(polygonPath(outline));
  }

  return { widthCm, heightCm, rows, cols, seed, pieces, cuts, dropped };
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  const table: [number, number, number][] = [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ];
  return table[i % 6]!;
}

export function palette(count: number): string[] {
  const hex = (x: number): string => Math.round(x * 255).toString(16).padStart(2, "0");
  return Array.from({ length: count }, (_, i) => {
    const hue = (i * 0.618033988749895) % 1;
    const [r, g, b] = hsvToRgb(hue, 0.42, 0.96);
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  });
}

export interface SvgOptions {
  color?: boolean;
  numbers?: boolean;
  stroke?: string;
  strokeWidth?: number;
}

export function toSvg(puzzle: Puzzle, opts: SvgOptions = {}): string {
  const { color = false, numbers = false, stroke = "#111111", strokeWidth = 0.3 } = opts;
  const width = puzzle.widthCm * 10;
  const height = puzzle.heightCm * 10;
  const fills = color ? palette(puzzle.pieces.length) : null;
  const font = Math.min(width / puzzle.cols, height / puzzle.rows) * 0.28;

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(puzzle.widthCm)}cm"` +
      ` height="${num(puzzle.heightCm)}cm" viewBox="0 0 ${num(width)} ${num(height)}">`,
    `<rect x="0" y="0" width="${num(width)}" height="${num(height)}" fill="#ffffff"/>`,
    // Rellenos sin trazo: evita líneas dobles en las caras compartidas.
    `<g fill-rule="nonzero" stroke="none">`,
  ];
  puzzle.pieces.forEach((piece, i) => {
    const fill = fills ? fills[i]! : "#ffffff";
    out.push(`<path d="${piece.path.toD()}" fill="${fill}"/>`);
  });
  out.push("</g>");
  // Cortes: cada tramo exactamente una vez (para láser / impresión).
  out.push(`<g fill="none" stroke="${stroke}" stroke-width="${num(strokeWidth)}" stroke-linejoin="round">`);
  for (const cut of puzzle.cuts) {
    out.push(`<path d="${cut.toD()}"/>`);
  }
  out.push("</g>");
  if (numbers) {
    out.push(
      `<g fill="#333333" font-family="sans-serif" font-size="${num(font)}"` +
        ` text-anchor="middle" dominant-baseline="central">`,
    );
    for (const piece of puzzle.pieces) {
      out.push(`<text x="${num(piece.center[0])}" y="${num(piece.center[1])}">${piece.index}</text>`);
    }
    out.push("</g>");
  }
  out.push("</svg>");
  return out.join("\n");
}

/** Atajo: reparte las piezas y construye el puzzle listo para dibujar. */
export function buildPuzzle(
  widthCm: number,
  heightCm: number,
  targetPieces: number,
  opts: GenerateOptions = {},
): Puzzle {
  // La forma puede cubrir menos que el rectángulo (el círculo ~78%) y las
  // celdas pequeñas se fusionan con su vecina: se ajusta la cuadrícula un par
  // de veces para que el número final de piezas se acerque al objetivo.
  const shape = getShape(opts.shape);
  const coverage = Math.max(0.05, shape.coverage(widthCm, heightCm));
  const aspect = widthCm / heightCm;

  let scale = 1;
  let best: Puzzle | null = null;
  let bestErr = Infinity;
  for (let i = 0; i < 4; i++) {
    const { rows, cols } = planGrid((targetPieces / coverage) * scale, aspect);
    const puzzle = generate(widthCm, heightCm, rows, cols, opts);
    const err = Math.abs(puzzle.pieces.length - targetPieces);
    if (err < bestErr) {
      bestErr = err;
      best = puzzle;
    }
    if (puzzle.pieces.length === 0 || err <= Math.max(2, targetPieces * 0.12)) return puzzle;
    scale *= targetPieces / puzzle.pieces.length;
    if (!Number.isFinite(scale) || scale <= 0) break;
  }
  return best!;
}
